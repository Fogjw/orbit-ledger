---
name: orbit-release
description: >-
  Orbit 星账的发版与 CD：在 develop 升版本、--no-ff 同步到 main、由 GitHub Actions 打包 Windows 与 Linux
  并创建 tag/Release，以及生产 hotfix 后回灌 develop。用于发版、改版本号、发布失败排查或紧急修复时。
---

# 发版与 CD

## 前提

- `main` 推送即 CD：每次从 `develop` 同步都必须带一个**新版本号**。
- 版本号写在仓库根 `package.json`；用 `npm version` 让它与 `package-lock.json` 同步。
- 已发布的版本不能重发；`release.yml` 发现同名 tag 或 Release 会直接失败。
- **不要手工推 tag**；tag 由 `gh release create --target` 在发布时创建。

## 正常发版

```bash
git switch develop && git pull --ff-only origin develop

# 版本号只改在短分支上，通过正常流程合入 develop
git switch -c chore/release-x.y.z
npm version x.y.z --no-git-tag-version
cd server && npm test
git add package.json package-lock.json
git commit -m "chore(release): x.y.z"

git switch develop
git merge --no-ff chore/release-x.y.z -m "merge: chore/release-x.y.z"
git push origin develop
# 等 develop 的 CI 通过

git switch main
git pull --ff-only origin main
git merge --no-ff develop -m "release: x.y.z"
git push origin main
```

- 发版短分支同样**保留**，不删除。
- push `main` 后看 Actions：Release 会校验版本 → 跑全量回归 → **同时**打包 Windows NSIS 与 Linux AppImage/deb → 创建 `vX.Y.Z` 与 GitHub Release；Pages 会部署网页版。
- 发布产物应包含 `Orbit-Setup-<version>.exe`、`Orbit-<version>-x86_64.AppImage`、`Orbit-<version>-amd64.deb`，以及 Windows 的 `latest.yml`/blockmap 和 Linux 的 `latest-linux.yml`。
- 发版前用 `gh release list --limit 1` 确认最新已发布版本；新版本必须高于它。例如最新是 `v1.1.11`，下一次至少是 `1.1.12`。
- 发版分支合入 `develop` 后、合入 `main` 前，必须确认 `develop` 的 CI 为绿。

## 生产 hotfix

```bash
git switch main && git pull --ff-only origin main
git switch -c hotfix/xxx
# 修 + 测试 + 升版本
git switch main
git merge --no-ff hotfix/xxx -m "release: x.y.z"
git push origin main
# 等 CD 成功后，必须回灌 develop
git switch develop
git merge --no-ff main -m "merge: main 回灌 hotfix/xxx"
git push origin develop
```

- hotfix 分支也保留。
- 不回灌会导致修复在下个版本丢失。
- 除 hotfix 外，任何分支都不得从 `main` 拉出。

## 规则

- 不在 `main` 上改版本、补测试或直接提交。
- 不手工打 tag、不手工创建 Release、不手工改 Release 附件。
- 版本号没升就合 `main`，Release 会失败——这是预期的保护，不要绕过。
- 发布失败但 tag 已创建时，先确认是否有人已经下载；一般应升新的 patch 版本重发，而不是删除/移动已发布 tag。

## 排查

| 现象 | 先查 |
|---|---|
| Release 在「读取版本并检查是否已发布」失败 | 版本是否已发布；是否忘了 `npm version` |
| `tag ... 已存在但没有对应 Release` | 是否有人手工推过 tag；确认后升新版本 |
| 打包失败 | 先看全量回归是否通过；再看 Electron/NSIS/AppImage/fpm 下载与网络镜像 |
| Linux 产物缺失 | 看 `npm run dist:linux` 是否同时产出 AppImage 与 deb；检查 `assets/icon.png` 与 `linux` 配置 |
| Pages 没更新 | `pages.yml` 只在 `main` push 且路径命中时触发；看 Actions 日志 |
