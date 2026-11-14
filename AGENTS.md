# AGENTS.md · Orbit 星账

> 仓库级硬约束，所有 Agent 与贡献者都遵守。
> 具体任务的做法拆在项目技能里，按需加载：`.agents/skills/orbit-branching/`、`orbit-release/`、`orbit-testing/`。
> 产品/架构见 [docs/architecture.md](docs/architecture.md)，界面口径见 [docs/frontend-rendering.md](docs/frontend-rendering.md)。

## 1. 开始之前

- 先读本文件、目标模块入口和对应技能；不要为了「建立全局观」通读整个仓库。
- 需求/验收标准不清、或改动会明显伤体验时，先问，不要猜着实现。
- 默认最小改动：能改一个函数就不重构一个模块，不顺手改无关代码。
- 金额一律整数分；账本隔离、事务、迁移、导入导出是正确性敏感区。
- `core/` 由服务端和纯前端版共用，改这里要同时考虑两边。

## 2. 不可协商的规则

1. **`main` 是生产**：只接受 `develop` 的 `--no-ff` 合并（hotfix 例外）；每次推送即 CD 发布；禁止直接提交。
2. **`develop` 是开发默认分支**：短分支从最新 `develop` 拉出，`--no-ff` 合回；禁止直接提交。
3. **短分支合入后保留**：不删除本地分支，也不删除远程分支；但不要在已合入分支上继续开发，新任务从 `develop` 拉新分支。
4. **短分支的 `CI 通过` 必须为绿**才能合入 `develop`；红了就修，禁止跳过、弱化测试或靠重跑掩盖。
5. **测试与代码同分支交付**：功能/修复必须同步补测试；模块完成必须有模块测试；黑盒优先，测需求而非实现。
6. **每次 `develop → main` 必须升版本**；版本没升 CD 会明确失败，避免重复发布。

## 3. 按任务加载技能

| 任务 | 技能 |
|---|---|
| 开分支、提交、合并、CI 门禁 | [orbit-branching](.agents/skills/orbit-branching/SKILL.md) |
| 发版、版本号、CD、hotfix | [orbit-release](.agents/skills/orbit-release/SKILL.md) |
| 写/改测试、验收、测试评审 | [orbit-testing](.agents/skills/orbit-testing/SKILL.md) |

DSH 会自动索引 `.agents/skills/`；如果当前会话的技能列表里没有，直接读对应的 `SKILL.md`。

## 4. 常用命令

```bash
# 一次性安装
npm ci
cd server && npm ci

# 本地开发（浏览器直连本地服务）
cd server && npm run dev          # http://localhost:5310

# 全量回归（后端 + web + webapp）
cd server && npm test

# 纯前端版
npm run build:web

# 桌面端 / 端到端（需要 GUI，不在 CI 跑）
npm start
npm run verify:web

# Android（需要 JDK 21 + Android SDK；CI 也会跑）
npm ci --prefix mobile
cd mobile && npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

CI 使用 Node 24；`server/package.json` 要求 Node >= 22.5。

## 5. 代码与提交

- 依赖只向下：api → services → repos → db；业务规则不放路由、不放 repo。
- 注释写意图（输入/输出/为什么这样设计），不复述代码字面。
- schema 迁移只增不改；改 REST/MCP 契约时同步 `docs/architecture.md`、测试和 `web/`、`webapp/` 调用方。
- 跨平台：路径用 `app.getPath`/`path.join`，不要写死 `%APPDATA%` 或盘符；Linux 托盘不可用时必须把关窗降级为退出，不能留下无入口的后台进程。
- 提交用 Conventional Commits + scope，主题中文：`feat(web): ...`、`fix(server): ...`、`test(core): ...`、`chore(ci): ...`、`merge: ...`、`release: x.y.z`。
- 一个提交只做一件事；测试与对应实现放在同一分支。
- **禁止提交**：`node_modules/`、`release/`、`webapp/dist/`、`server/data/`、`*.db`、`PLAN.md` / `HANDOFF.md` / 临时脚本、密钥与个人数据。

## 6. 完成定义

- [ ] 从最新 `develop` 拉出短分支，分支名符合约定；
- [ ] 需求对应的行为已实现，没有顺手改无关代码；
- [ ] 同分支补了测试，含失败路径与边界；
- [ ] `cd server && npm test` 全绿；涉及 `web/`、`webapp/` 时 `npm run build:web` 通过；
- [ ] 涉及 Android/`mobile/` 时，Android CI（debug APK + Emulator E2E）通过；签名发布用 `android-release.yml`；
- [ ] 涉及桌面壳层/打包时，对应平台安装包构建通过（Linux: `npm run dist:linux` + `npm run verify:linux`）；
- [ ] 该短分支的 `CI 通过` 为绿；
- [ ] 以 `--no-ff` 合入 `develop`，合并后回归仍绿，`develop` 已推送；
- [ ] **短分支保留**，下一条分支从新 `develop` 拉出；
- [ ] 契约/迁移/文档有变化时已同步；发版时版本已升。
