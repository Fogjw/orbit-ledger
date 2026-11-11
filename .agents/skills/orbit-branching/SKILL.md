---
name: orbit-branching
description: >-
  Orbit 星账的日常 Git 流程：从 develop 拉短分支、推送等 CI、以 --no-ff 合入 develop 并保留分支。
  用于开分支、提交、合并、处理 CI 门禁，或不确定该从哪个分支起步时。
---

# Orbit 日常分支流程

## 三个角色

- `main`：生产。只接受 `develop` 的 `--no-ff` 合并（hotfix 例外）；push 即 CD；**禁止直接提交**。
- `develop`：开发默认分支。只接受短分支的 `--no-ff` 合并；**禁止直接提交**。
- 短分支：`feat/`、`fix/`、`test/`、`chore/`、`docs/` + 简短 slug。从最新 `develop` 拉出，合入后**保留**。

## 开工

```bash
git fetch origin
git switch develop
git pull --ff-only
git switch -c feat/xxx
```

- 本地还没有 `develop` 时：`git switch -c develop origin/develop`。
- 不要从 `main` 或旧短分支拉新分支。
- 分支名不复用；合入后保留，历史可追溯。

## 提交并等 CI

```bash
git add <files>
git commit -m "feat(web): ..."
git push -u origin feat/xxx
```

- CI 在任意分支 push 时触发；指向 `develop` / `main` 的 PR 也会触发。
- 等这条短分支的聚合检查 **`CI 通过`** 变绿。
- 红了就在同一分支修，再推；不要跳过测试、放宽断言或靠反复重跑掩盖。
- PR 场景下 `CI 通过` 是合入前的必需检查；没有配置分支保护时，也必须人工确认它为绿。

## 合入 develop（不快进）

```bash
git switch develop
git pull --ff-only origin develop
git merge --no-ff feat/xxx -m "merge: feat/xxx ..."
cd server && npm test
git push origin develop
```

- 合并后必须再跑一次全量回归：两条分支各自绿，不代表合并后语义仍绿。
- **不删除短分支**：不执行 `git branch -d/-D feat/xxx`，也不执行 `git push origin --delete feat/xxx`。
- 本地和远程都保留分支；分支越积越多是预期行为，不要为了「清爽」清理已合入分支。
- 合入后不要在该分支上继续开发；下一条从新 `develop` 拉出：

```bash
git switch -c fix/yyy
```

## 禁止

- 在 `main` / `develop` 上直接提交，或绕过短分支直接 push。
- 用 fast-forward、squash、rebase 代替 `--no-ff` 合并。
- 删除已合入的短分支（本地或远程）。
- 在已合入的分支上追加新需求，或复用旧分支名。
- 在 CI 未绿时合并。
- 对 `main` / `develop` 执行 `push --force` 或改写已推送历史。

## 检查清单

- [ ] 从最新 `develop` 拉出
- [ ] 分支名符合 `feat/`、`fix/` 等约定
- [ ] 该分支 `CI 通过` 为绿
- [ ] 以 `--no-ff` 合入 `develop`
- [ ] 合并后 `cd server && npm test` 仍绿
- [ ] 已 push `develop`
- [ ] 短分支保留，未删除
