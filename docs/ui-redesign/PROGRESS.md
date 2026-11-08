# UI 重构进度

> 长期设计资产，不是临时计划。每个界面合入 `develop` 后更新本表；跨会话以本表为准。

- 基线 commit：`b2f2ae0`（Linux 支持合入后的 develop）
- 当前分支：`ui/star-track`
- 当前阶段：阶段 2.3 · 底部星轨（实现完成，待用户确认）
- 下一步：用户确认后合入，再开阶段 2.4 右侧粒度轨。
- 约束：账单图谱逻辑冻结；信息量不减少；一界面一分支一合入；合入后保留短分支。

## 阶段

| 阶段 | 内容 | 分支 | 状态 | 用户确认 |
|---|---|---|---|---|
| 0 | 清单 / 图谱快照 / E2E / 基线截图 | `chore/ui-baseline` | 完成，合入 develop | 已确认 |
| 1 | 中式星图方向、PRODUCT.md / DESIGN.md、style tile | `docs/ui-direction` | 完成，合入 develop | 已选 B |
| 2.1 | 顶栏 | `ui/topbar` | 完成，合入 develop | 已确认 |
| 2.2 | 左侧仪表盘 | `ui/panel` | 完成，合入 develop | 已确认 |
| 2.3 | 底部星轨 | `ui/star-track` | 实现完成，待确认 | 待确认 |
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

## 阶段 2.1 交付（完成）

- [x] 顶栏从悬浮毛玻璃胶囊改为贯穿全宽的仪器横梁：直角、石墨底、黄铜双线、宋体品牌、等宽金额。
- [x] 保留全部入口：品牌 / 账本切换 / 品类·情境 / 回到今天 / 返回主视图 / 期间·笔数·总额 / 记一笔。
- [x] 不动 `app.js` 逻辑；所有 ID 与事件处理器不变。
- [x] `npm test` 通过；`npm run build:web` 通过；`npm run verify:web` 通过。
- [x] 改后截图：`docs/ui-redesign/review/01-overview.png`；改前参考：`docs/screenshots/overview.png`（旧悬浮玻璃顶栏）。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.1 设计点

- 顶栏高度 64px 全宽，底部 1px 黄铜线 + 内嵌 4px 发丝线；不是圆角卡片。
- 品牌区独立，右侧竖分隔；logo 改成黄铜方框，不发光。
- 段控/按钮/账本块全部直角；hover 只换边框/底色，不做 glow。
- 金额/期间用等宽数字；品牌用宋体；其余中文 UI 用无衬线。
- `回到今天` 去掉 Unicode 图标，换成 1px 黄铜圆点。

## 阶段 2.2 交付（完成）

- [x] 左面板从玻璃卡片改为竖向仪器读数：无圆角、无 blur、右缘黄铜线、实底。
- [x] 保留全部信息：期间、结余、支出、收入、环比、记录天数/日均、TOP5、交叉洞察。
- [x] TOP 行保留 hover 联动与点击下钻；色点/细刻度/等宽金额。
- [x] 结余负数改为朱砂系红；支出/收入/标签对齐；去掉发光与渐变条。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过（E2E 更新了负结余色断言）。
- [x] 截图：`docs/ui-redesign/review/01-overview.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.2 设计点

- 面板 `top:64px`、`bottom:190px`、宽 268px；当前旧星轨还浮在底部，所以先留 190px 避让；阶段 2.3 改星轨后再对齐。
- 结余用等宽数字 32px；支出/收入/环比为紧凑读数行；TOP 行两行网格（名称/刻度/金额）。
- 「交叉洞察」保留，不再用蓝色圆角底；只留发丝上边线。
- 面板宽度 268px 与顶栏品牌区对齐；星图从 268px 之后开始。

## 阶段 2.3 交付（待确认）

- [x] 星轨从悬浮玻璃卡片改为贯穿全宽的 150px 刻度长轨；无圆角、无 blur。
- [x] 面板底边对齐到 150px；旧星轨的 190px 避让取消。
- [x] Canvas 重绘：黄铜基线 + 疏密刻度、金额读数柱、实心星珠、黄铜连线、今天游标；去掉发光/渐变面积图。
- [x] 三档（日/月/年）都是同一条直轨；节点/标签/今天标记/选中/hover 逻辑保留。
- [x] 星轨全部数据与交互保留：日/月/年节点、点击、拖拽、滚轮、右轨同步、tooltip。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/01-overview.png`、`06-detail.png`。
- [ ] 用户确认
- [ ] 合入 `develop`

### 阶段 2.3 设计点

- 星轨 `position:fixed; left:0; right:0; bottom:0; height:150px`；顶部 1px 黄铜线；面板 `bottom:150px` 对齐。
- 基线在 canvas 46% 高度；节点全部落在同一条线上；刻度每 18px 一个，90px 一个长刻度。
- 金额不再用面积图，改成每颗星下方的 1px 黄铜读数柱；星点大小仍按金额。
- 今天是一根黄铜游标 + 双环；选中是星白细环；hover 是更亮细环，不再呼吸发光。
- 左下缩放条/右侧粒度轨仍是旧样式；阶段 2.5 / 2.4 再处理。

## 合入记录

| 日期 | 界面 | 分支 | commit | 确认 | 备注 |
|---|---|---|---|---|---|
| 2026-11-08 | 阶段 0 基线 | `chore/ui-baseline` | 7c890fa | 已确认 | 只改测试/文档/只读调试接口，无生产 UI 改动 |
| 2026-11-08 | 阶段 1 方向 | `docs/ui-direction` | 3ea86d5 | 已选 B | B 为结构基线；A/C 留作后续皮肤 |
| 2026-11-08 | 阶段 2.1 顶栏 | `ui/topbar` | d6acd6a | 已确认 | 全宽仪器横梁；未改 app.js |
| 2026-11-08 | 阶段 2.2 左侧仪表盘 | `ui/panel` | 21b361a | 已确认 | 仪器读数；E2E 负结余色断言更新 |

## 备注

- `docs/ui-redesign/review/` 只放本地 review 截图，不入库。
- 现有 `docs/screenshots/` 只在阶段 2.10 全局收尾时更新。
- `.dsh/`（Impeccable 安装）保持本地未跟踪，不随 UI 提交。
- 阶段 0 只动测试/文档/只读调试接口，不改任何生产 UI。
- Linux 打包已改为 deb + rpm，CI 用系统 fpm + Electron 镜像（`ccba250`），不再依赖 electron-builder 的 GitHub 资产。
