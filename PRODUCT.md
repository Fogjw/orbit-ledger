# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

现有 Electron 主进程 + 原生 HTML/CSS/Canvas 前端 + Express/SQLite 本地服务；纯前端版共用同一份 `web/`。本次不改技术栈。

## Users

- 主要用户：使用 Windows / Linux 桌面端的个人记账者，中文语境，重视本地数据与隐私。
- 使用场景：日常快速记一笔；月末/年末回看钱花在哪、哪些分类和情境一起出现；偶尔把账本交给支持 MCP 的 Agent 查询或记账。
- 他们不需要云端账号、团队协作或移动端；需要的是「打开就能看懂自己的账」。

## Product Purpose

把账本画成一片可以探索的夜空：支出是星，分类是引力井/星官，时间是星轨；让「钱花在哪」不只是一张表，而是一眼能读出的结构。同时保留精确到分的记账、筛选、编辑、备份与 MCP 能力。

## Positioning

本地优先 + 图谱化记账：桌面端内嵌同一个本地服务，浏览器直连与桌面窗口共享同一份数据、同一套 REST/MCP；账本数据不离开用户设备。界面把金额、维度、时间组织成可下钻的星图，而不是通用 KPI 仪表盘。

## Operating Context

- 桌面宽屏（当前设计基准 1440×900，向下兼容到约 1100/760 的现有断点）。
- 日/月/年/全部四档时间窗；主视图看主 tag 星座，点击主 tag 进入「副 tag × 账单」二部图下钻。
- 快速记账是高频动作；月度回看和分类整理是中频；导入/导出/标签管理是低频但必须可用。
- 数据是本地的、长期积累的；一次误删/误改比一次不好看更严重。

## Capabilities and Constraints

- 五表数据模型：ledger / dimension / tag / expense / expense_tag_links；金额以整数分存储。
- 每笔账每维恰好一个 primary，统计按维度 Σ = 总额；账本之间严格隔离；写账单事务。
- 主 tag 两类层级：主 tag 与副 tag（最多两级）；副 tag 必须挂在本笔主 tag 下。
- 收入是同一 tag 体系里的「收入·」前缀类目，星图里使用独立形状，不混入支出轨迹。
- 时间轴只含有记账的格子；「今天」只认真实今天，今天没记账时没有今天标记。
- 备份是 JSON 快照；导入成为新账本，不覆盖、不合并。
- 不新增数据字段、不改 REST/MCP 契约、不减少现有功能或信息。

## Brand Commitments

- 产品名：Orbit 星账；核心隐喻：夜空、星轨、星图、可探索的账本。
- 本地优先、隐私、不注册、不上传。
- 用户明确要求「中式星辰美学」：参考中国传统星图与浑仪，而不是国潮贴皮或通用深色玻璃仪表盘。

## Evidence on Hand

- `README.md`、`docs/architecture.md`、`docs/frontend-rendering.md`。
- `docs/screenshots/` 与 `docs/ui-redesign/review/` 中的真实渲染截图。
- `web/` 的现有实现与 `web/test/`、`electron/scripts/verify-webapp.js`、`verify-graph.js` 的验收链路。
- 演示数据 `server/scripts/seed-demo.mjs` 可复现 2718 笔、23 个月、含多副 tag 账单。

## Product Principles

1. 账本正确性优先于视觉表达：金额、隔离、事务、迁移、导入导出不可退让。
2. 信息不缩水：改版可以重排、重排、再分层，但不能删字段、藏入口、减少默认可见信息。
3. 图谱逻辑冻结：主 tag 相连、点击主 tag 下钻到「副 tag × 账单」二部图、共享线、返回与 hover/pin 语义不变。
4. 本地优先：不为了视觉效果引入云端依赖、联网字体或不可控资源。
5. 一次只改一个界面：每项独立分支、独立确认、独立合入，避免大爆炸式重构。

## Accessibility & Inclusion

- 桌面键盘用户：DOM 控件保留可见焦点与可用标签。
- 正文与说明文字满足 WCAG AA 对比度；颜色不是唯一的信息载体（金额、标签、纹理同时存在）。
- 现有窄屏断点不额外隐藏信息；若改版调整断点，必须提供等价入口。
- Canvas 交互保持现有指针语义；不新增必须依赖精确悬停才能完成的任务。

## Open Decisions

- 视觉方向在三张 direction style tile 中由用户选择；选择前不改生产界面。
- 第二个 skill 未提供；本阶段以 Impeccable 与用户给的「中式星图 × 浑仪」约束为准。

<!-- 以上产品事实来自 README/AGENTS、现有代码与本次对话；阶段 1 评审时请确认或纠正推断项。 -->
