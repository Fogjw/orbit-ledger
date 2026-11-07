# AGENTS.md · 开发规范

> 本文件约束所有在本仓库工作的 Agent（以及人类贡献者）。
> 分支、测试、发布以本文件为准；产品与架构细节见 [docs/architecture.md](docs/architecture.md)，界面口径见 [docs/frontend-rendering.md](docs/frontend-rendering.md)。

## 0. 动手之前

- 先读本文件、目标模块入口和 `docs/architecture.md` 的相关章节；**不要**为了「建立全局观」通读整个仓库。
- 需求含糊、验收标准不清、或改动会明显伤体验时，先说明并确认，不要猜着实现。
- 默认最小改动：能改一个函数就不重构一个模块；不顺手改无关代码。
- 金额一律用整数分；账本隔离、事务、迁移、导入导出属于正确性敏感区，改动必须按第 4 节配测试。

## 1. 仓库速览

| 目录 | 职责 |
|---|---|
| `core/` | 共享业务层：业务规则 + SQL（纯 JS）。**服务端与纯前端版共用同一份**，改这里两边都会受影响 |
| `server/` | 本地服务：Express REST + MCP + `node:sqlite`，引用 `core/` |
| `web/` | 界面：天象仪（WebGL2，降级 Canvas），数据源由注入的 `OrbitAPI` 决定 |
| `webapp/` | 纯前端版：浏览器内 SQLite（sql.js）+ 本地存储，构建成静态站点 |
| `electron/` | 桌面壳层：内嵌本地服务、窗口、安装包 |
| `docs/` | 架构、前端渲染约定、截图 |

```bash
# 一次性安装（根依赖用于 webapp 构建/测试，server 依赖用于服务与回归）
npm ci
cd server && npm ci

# 本地开发（浏览器直连本地服务）
cd server && npm run dev          # http://localhost:5310

# 全量回归（后端 + web + webapp，node:test）
cd server && npm test

# 纯前端版
npm run build:web

# 桌面端 / 端到端（需要 GUI，不在 CI 跑）
npm start
npm run verify:web
```

CI 使用 Node 24；`server/package.json` 要求 Node >= 22.5。

## 2. 分支模型（强制）

```
main      ──●────────────────●──────────────●──   生产，只接收来自 develop 的合并；每次推送即 CD
              \              /              /
develop        ●──●──●──●───●──●──●──●────●──     集成分支 / 开发默认分支；只接收短分支的不快进合并
                   \    /       \    /
feat/xxx            ●──●         ●──●              短分支：从 develop 拉出，合回 develop 后删除
```

### 2.1 三条硬规则

1. **`main` 是生产代码**：只接受 `develop` 的 `--no-ff` 合并（紧急修复见 2.4），**禁止直接提交**。每次 `main` 收到推送，`release.yml` 都会打 tag 并发布新版本，`pages.yml` 会部署网页版。
2. **`develop` 是开发默认分支**：所有开发分支从最新的 `develop` 拉出；**禁止直接提交**，只接受短分支的 `--no-ff` 合并。
3. **短分支必须 CI 通过才能合入 `develop`**：分支推上去后等 `CI 通过` 这个聚合检查变绿；配置分支保护后，PR 场景下它就是必需检查。红了就修，禁止绕过、跳过或弱化测试。

### 2.2 日常开发流程

```bash
# 1) 同步 develop（始终从最新 develop 起步）
git fetch origin
git switch develop
git pull --ff-only

# 2) 拉短分支；命名：feat/ fix/ test/ chore/ docs/ + 简短英文 slug
git switch -c feat/xxx

# 3) 开发 + 同分支补测试（见第 4 节）
#    ...
cd server && npm test

# 4) 提交并推送，等这一条短分支的 CI 变绿
git add <files>
git commit -m "feat(web): ..."
git push -u origin feat/xxx

# 5) 不快进合入 develop；合并后再跑一次全量回归
git switch develop
git pull --ff-only
git merge --no-ff feat/xxx -m "merge: feat/xxx ..."
cd server && npm test
git push origin develop

# 6) 删除已合入的短分支，再从新 develop 拉下一条
git branch -d feat/xxx
git push origin --delete feat/xxx
git switch -c fix/yyy
```

- 合并**一律 `--no-ff`**，不用 fast-forward、不用 squash：保留「一条分支做过什么」的边界。
- 已推送的 `main` / `develop` 禁止 `rebase`、禁止 `push --force`。
- 短分支生命周期要短；合入后立即删除，不复用旧分支继续开发。
- 需要长期并行的实验，先说明，不要悄悄把 `develop` 当个人工作区分叉。

### 2.3 发布到生产（develop → main）

**每次同步到 `main` 都必须是一个新版本号**；版本没升，CD 会明确失败，避免重复发布同一个版本。

```bash
git switch develop && git pull --ff-only

# 版本号只改在短分支上，通过正常流程合入 develop
git switch -c chore/release-x.y.z
npm version x.y.z --no-git-tag-version   # 同步 package.json 与 package-lock.json
cd server && npm test
git add package.json package-lock.json
git commit -m "chore(release): x.y.z"

git switch develop
git merge --no-ff chore/release-x.y.z -m "merge: chore/release-x.y.z"
git push origin develop
# 等 develop 的 CI 绿

git switch main
git pull --ff-only origin main
git merge --no-ff develop -m "release: x.y.z"
git push origin main
```

`main` 推送后由 workflow 完成：校验版本未被发布过 → 打包 Windows 安装包 → 创建 `vX.Y.Z` tag 与 GitHub Release。**不要手工推 tag**，否则会和 CD 抢同一个版本。

### 2.4 生产紧急修复（例外通道）

```bash
git switch main && git pull --ff-only
git switch -c hotfix/xxx
# 修 + 测试 + 升版本
git switch main
git merge --no-ff hotfix/xxx -m "release: x.y.z"
git push origin main          # 走同一条 CD

# 必须回灌 develop，避免修复在下个版本丢失
git switch develop
git merge --no-ff main -m "merge: main 回灌 hotfix/xxx"
git push origin develop
```

除 `hotfix/*` 外，任何分支都不得从 `main` 拉出。`main` 只作为发布终点接收 `develop` 的合并；唯一例外是 hotfix 发布后把 `main` 回灌到 `develop`。

## 3. CI / CD

| 工作流 | 触发 | 作用 |
|---|---|---|
| `.github/workflows/ci.yml` | 任意分支 push；指向 `develop` / `main` 的 PR | 后端全量回归、前端/壳层语法检查、webapp 构建；聚合为 `CI 通过` |
| `.github/workflows/release.yml` | push 到 `main` | 校验版本 → 打包 NSIS → 创建 tag 与 Release |
| `.github/workflows/pages.yml` | push 到 `main` | 构建纯前端版并部署 GitHub Pages |

- 合入 `develop` 前，短分支的 `CI 通过` 必须是绿色。没有绿色就合并，视为破坏流程。
- `main` 只做发布验证，不在这里补测试、不在这里改版本。
- 如果 CI 因环境/网络偶发失败，先确认失败原因；不要用重复重跑掩盖真实红。
- 修改 workflow 时，保持「短分支必须绿」和「`main` 推送即发布」这两条语义不变。

## 4. 测试规范（重点）

### 4.1 测试与代码同分支交付

- **开发功能/修 bug 必须同步加测试**，和代码在同一个短分支、同一轮提交里完成，不允许「先合再补」。
- **模块完成 = 模块测试完成**：模块对外可用时，必须有经过公开边界的模块级测试，而不是只有内部函数单测。
- 修 bug 先写出能复现的失败用例，再修到通过；没有复现用例的修复不算完成。

### 4.2 黑盒优先：测行为和契约，不测实现

测试应通过**公开入口**验证：

- REST API（真实 `listen` + `fetch`）、MCP 协议、`OrbitAPI`、导出的 JSON 备份、页面可观察行为；
- 真实的数据库（`node:sqlite` 内存库 / 浏览器 SQLite），而不是 mock 掉被测对象；
- 对纯规则（金额取整、日期、tag 解析）可以单测纯函数，但断言的是输入→输出规则，不是内部字段。

**禁止**把实现细节写进断言：

- 不读源码正则来「证明」函数存在、方法表同形、字符串常量没变；
- 不断言私有字段名、内部调用次数、日志文案、SQL 文本、对象 key 顺序；
- 不为通过测试而 mock 掉真正要验证的那一层。

> `web/test/contract.test.js` 中有一部分通过读源码正则锁定格式常量，属于历史遗留的白盒做法。修改相关模块时应把它逐步换成公开接口/产物断言；**不要新增同类测试**。

### 4.3 需求导向，避免「自己出卷自己批」

先从需求、文档和用户故事推导验收用例，再写实现。断言「用户能观察到什么」，而不是「代码恰好输出了什么」：

- 断言不变量与业务结果，例如：
  - 记一笔后，该维度合计 = 总额，「未分类」也计入；
  - 导入备份成为一本**新账本**，原账本不变，金额/日期/标签关系一致；
  - A 账本的 tag 用于 B 账本记账会被拒，且不落库；
  - 事务中途失败后，账目、tag、关联全部回滚。
- 只有当契约明确要求时才断言精确值：HTTP 状态码、错误码、schema 版本、备份格式、金额精确到分。
- 不把「当前实现的实际输出」直接抄成期望值；期望值必须能独立推导（手算、文档、不变量、另一条路径）。

提交前用这组问题自检：

1. 如果实现写错了，这个测试还会通过吗？
2. 它验证的是需求，还是我刚写的实现？
3. 期望值有没有独立来源，而不是从运行结果复制？
4. 失败路径、边界（空数据、跨账本、重复导入、金额 0/1 分、跨月/跨年）覆盖了吗？
5. 测试走的是公开入口吗？换一种内部实现，它还成立吗？

### 4.4 测试层次

| 层次 | 放哪里 | 重点 |
|---|---|---|
| 单元 | 模块内纯规则 | 取整、日期、tag 解析、排序等边界 |
| 模块/集成 | `server/test/`、`webapp/test/` | 服务 + 真实 DB、REST/MCP 全流程、导入导出往返 |
| 端到端 | `web/test/`（行为级）、`verify:web` | 记账→刷新→统计、备份恢复、关键 UI 路径 |

必须持续守住的既有不变量：每维 Σ = 总额、账本隔离、单事务回滚、迁移可重放、导入导出往返、REST 与 MCP 契约。

### 4.5 测试位置与运行

- 后端：`server/test/*.test.js`（`node:test`，串行）。
- 前端行为：`web/test/*.test.js`。
- 纯前端版：`webapp/test/*.test.js`。
- 全量入口是 `cd server && npm test`；它按固定顺序串行执行。**新增测试文件必须同步加进 `server/package.json` 的 `test` 脚本**，否则 CI 不会跑到。
- 测试数据用临时目录/内存库，确定性、可重复；涉及「今天」的用例固定时钟或注入日期，不依赖运行当天。
- 不提交真实个人账本数据；不为了让测试通过而删除、跳过或放宽既有测试。

## 5. 代码约定

- 最简实现、最小改动；先问「有没有更好的做法」，再动手。
- 低耦合、模块化：依赖只向下（api → services → repos → db），业务规则不放路由、不放 repo。
- 注释写意图（输入/输出/为什么这样设计），不复述代码字面。
- 金额用整数分，禁止浮点累加；日期用 `YYYY-MM-DD`；写账必须走事务。
- `core/` 被服务端和纯前端版共用：改 `core/` 要同时考虑两边，跑 `npm test` 和 `npm run build:web`。
- schema 迁移只增不改：已发布的迁移版本不得编辑；新变更追加新版本，并保证旧库可升级。
- 改 REST/MCP 契约时，同步更新 `docs/architecture.md`、契约测试和 `web/`、`webapp/` 的调用方；错误码保持稳定。
- 不引入新依赖除非确有必要；引入时说明理由，并确认 CI 能安装。

## 6. 提交与 PR

- 提交信息用 Conventional Commits + scope，主题用中文，与仓库现有风格一致：
  `feat(web): ...`、`fix(server): ...`、`test(core): ...`、`chore(ci): ...`、`docs: ...`、`merge: ...`、`release: x.y.z`。
- 一个提交只做一件事；测试与对应实现放在同一分支（可以分提交）。
- **禁止提交**：`node_modules/`、`release/`、`webapp/dist/`、`server/data/`、`*.db`、`PLAN.md` / `HANDOFF.md` / 临时脚本、密钥与个人数据。
- PR 的目标分支是 `develop`（发布同步才指向 `main`）；描述写清：需求/验收标准、测试证据、风险与回滚方式。
- 不把无关格式化、重命名混进功能提交。

## 7. 完成定义（DoD）

一条短分支算完成，必须同时满足：

- [ ] 从最新 `develop` 拉出，分支名符合约定；
- [ ] 需求对应的行为已实现，且没有顺手改无关代码；
- [ ] 同步补了单测/模块测试，包含失败路径与边界；
- [ ] `cd server && npm test` 全绿；涉及 `webapp`/`web` 时 `npm run build:web` 通过；
- [ ] 该短分支的 `CI 通过` 为绿；
- [ ] 以 `--no-ff` 合入 `develop`，合并后回归仍绿，develop 已推送；
- [ ] 短分支已删除，下一条分支从新 `develop` 拉出；
- [ ] 契约/文档/迁移有变化时已同步更新。

发布到 `main` 额外满足：

- [ ] 版本号已通过短分支合入 `develop`（`package.json` 与 `package-lock.json` 一致）；
- [ ] `main` 只做 `--no-ff` 合并，推送后 CD 成功，Release 与 tag 对应新版本；
- [ ] 若走 `hotfix`，修复已回灌 `develop`。
