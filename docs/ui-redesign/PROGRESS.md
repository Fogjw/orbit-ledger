# UI 重构进度

> 长期设计资产，不是临时计划。每个界面合入 `develop` 后更新本表；跨会话以本表为准。

- 基线 commit：`b2f2ae0`（Linux 支持合入后的 develop）
- 当前分支：`ui/topbar`
- 当前阶段：阶段 2.1 · 顶栏（实现完成，待用户确认）
- 下一步：用户确认顶栏后合入，再开阶段 2.2 左侧仪表盘。
- 约束：账单图谱逻辑冻结；信息量不减少；一界面一分支一合入；合入后保留短分支。

## 阶段

| 阶段 | 内容 | 分支 | 状态 | 用户确认 |
|---|---|---|---|---|
| 0 | 清单 / 图谱快照 / E2E / 基线截图 | `chore/ui-baseline` | 完成，合入 develop | 已确认 |
| 1 | 中式星图方向、PRODUCT.md / DESIGN.md、style tile | `docs/ui-direction` | 完成，合入 develop | 已选 B |
| 2.1 | 顶栏 | `ui/topbar` | 实现完成，待确认 | 待确认 |
| 2.2 | 左侧仪表盘 | 待开 | 未开始 | - |
| 2.3 | 底部星轨 | 待开 | 未开始 | - |
| 2.4 | 右侧粒度轨 | 待开 | 未开始 | - |
| 2.5 | 左下缩放条 | 待开 | 未开始 | - |
| 2.6 | 记一笔浮层 | 待开 | 未开始 | - |
| 2.7 | 下钻二部图（只改视觉） | 待开 | 未开始 | - |
| 2.8 | 账本菜单 + 标签管理 | 待开 | 未开始 | - |
| 2.9 | 花销明细 + 账单详情/编辑 + 命名/取色 | 待开 | 未开始 | - |
| 2.10 | 全局收尾、旧玻璃/渐变清理、README 截图 | 待开 | 未开始 | - |

## 阶段 0 交付

- [x] `docs/ui-redesign/INVENTORY.md`：信息/功能不阉割合同
- [x] `docs/ui-redesign/PROGRESS.md`：本文件
- [x] `window.OrbitDebug.graph()`：只读图谱拓扑快照
- [x] `verify-webapp.js`：主 tag → 下钻 → 返回、二部图拓扑、共享线（真实点击由 `verify:graph` 覆盖）
- [x] `verify-graph.js`：真实坐标点击主 tag，验证 8 副 tag / 14 账单 / 27 归属线 / 9 共享线
- [x] 可复现 review 截图脚本（目标 1440×900；当前环境实际 1229×684）
- [x] 当前提交的基线截图（6 张）
- [x] 用户确认基线

## 阶段 0 验证记录（2026-11-08）

- `cd server && npm test`：通过。
- `npm run build:web`：通过。
- `env -u ELECTRON_RUN_AS_NODE npm run verify:graph`：通过。
  - 演示库「餐饮」：副 tag 8、账单 14、主 tag 节点 0、归属线 27、共享线 9，返回 L1 正常。
- `env -u ELECTRON_RUN_AS_NODE npm run verify:web`：通过。
  - 补了下钻拓扑断言：2 副 tag / 1 账单 / 2 归属线 / 1 共享线，返回 L1 正常。
  - 顺带修了两处只与测试环境有关的问题：每次用独立 Electron profile（避免只读 `~/.config` 的 storage 报错）；测试库只有一个月时跳过无意义的「拖到限位/点节点复位」用例。
- `env -u ELECTRON_RUN_AS_NODE npm run shots:ui`：产出 6 张基线图到 `docs/ui-redesign/review/`。
  - 当前显示器工作区 1229×684，不是 1440×900；截图记录的是真实可见尺寸。大屏环境可重跑脚本补 1440/1920。
- 已知：`docs/ui-redesign/review/` 不入库；`webapp/verify-shot.png`、`verify-year.png` 也不入库。

## 阶段 1 交付（完成）

- [x] `PRODUCT.md`：产品事实、约束与原则
- [x] `docs/ui-redesign/DIRECTIONS.md`：参考母题、A/B/C 三方向、选择标准
- [x] `docs/ui-redesign/direction/app.html`：三套视觉（`?theme=silk|brass|rubbing`）
- [x] `docs/ui-redesign/direction/app.html?...&entry=1`：记一笔账笺状态
- [x] `docs/ui-redesign/direction/index.html`：方向入口
- [x] `electron/scripts/make-direction-shots.js` + `shots:direction`：6 张 review 图
- [x] 用户选择：B · 浑仪铜鉴
- [x] 按选择写 `DESIGN.md`
- [x] 合入 `develop`

### 方向

| 代号 | 名称 | 关键词 | 状态 |
|---|---|---|---|
| B | 浑仪铜鉴 | 石墨、旧铜、双线刻度、环、冷 | **结构基线** |
| A | 绢本星图 | 宋体、朱砂、蛤白、细线、页边注记 | 后续主题皮肤候选 |
| C | 碑拓星图 | 炭黑、刻线、浅色拓纸账笺、最重 | 后续主题皮肤候选 |

### 阶段 1 验证记录（2026-11-08）

- `npm run shots:direction`：产出 6 张 review 图（三套主视图 + 三套账笺），1229×684。
- 用户反馈：三张差异主要是配色/材质，骨架相同。
- 决定：B 作为**结构基线**；A/C 不再当作三个并列世界，保留为后续 token 级主题皮肤；先改结构，后加皮肤切换。
- `DESIGN.md`：按 B 写定 tokens、字体、布局、材质、星形语法、组件与禁区。
- 下一步：阶段 2.1 顶栏，必须做出结构性变化（仪器横梁/题签），不是换色。

## 阶段 2.1 交付（待确认）

- [x] 顶栏从悬浮毛玻璃胶囊改为贯穿全宽的仪器横梁：直角、石墨底、黄铜双线、宋体品牌、等宽金额。
- [x] 保留全部入口：品牌 / 账本切换 / 品类·情境 / 回到今天 / 返回主视图 / 期间·笔数·总额 / 记一笔。
- [x] 不动 `app.js` 逻辑；所有 ID 与事件处理器不变。
- [x] `npm test` 通过；`npm run build:web` 通过；`npm run verify:web` 通过。
- [x] 改后截图：`docs/ui-redesign/review/01-overview.png`；改前参考：`docs/screenshots/overview.png`（旧悬浮玻璃顶栏）。
- [ ] 用户确认
- [ ] 合入 `develop`

### 阶段 2.1 设计点

- 顶栏高度 64px 全宽，底部 1px 黄铜线 + 内嵌 4px 发丝线；不是圆角卡片。
- 品牌区独立，右侧竖分隔；logo 改成黄铜方框，不发光。
- 段控/按钮/账本块全部直角；hover 只换边框/底色，不做 glow。
- 金额/期间用等宽数字；品牌用宋体；其余中文 UI 用无衬线。
- `回到今天` 去掉 Unicode 图标，换成 1px 黄铜圆点。

## 合入记录

| 日期 | 界面 | 分支 | commit | 确认 | 备注 |
|---|---|---|---|---|---|
| 2026-11-08 | 阶段 0 基线 | `chore/ui-baseline` | 7c890fa | 已确认 | 只改测试/文档/只读调试接口，无生产 UI 改动 |
| 2026-11-08 | 阶段 1 方向 | `docs/ui-direction` | 3ea86d5 | 已选 B | B 为结构基线；A/C 留作后续皮肤 |

## 备注

- `docs/ui-redesign/review/` 只放本地 review 截图，不入库。
- 现有 `docs/screenshots/` 只在阶段 2.10 全局收尾时更新。
- `.dsh/`（Impeccable 安装）保持本地未跟踪，不随 UI 提交。
- 阶段 0 只动测试/文档/只读调试接口，不改任何生产 UI。
