# UI 重构进度

> 长期设计资产，不是临时计划。每个界面合入 `develop` 后更新本表；跨会话以本表为准。

- 基线 commit：`b2f2ae0`（Linux 支持合入后的 develop）
- 当前分支：`feat/mobile-m2-android`
- 当前阶段：M2a/M2b · debug APK + Android 模拟器 WebView E2E（完成，合入 develop）
- 下一步：M2c 返回键/图标/真机；release 签名需用户 keystore。
- 约束：账单图谱逻辑冻结；信息量不减少；一界面一分支一合入；合入后保留短分支。

## 阶段

| 阶段 | 内容 | 分支 | 状态 | 用户确认 |
|---|---|---|---|---|
| 0 | 清单 / 图谱快照 / E2E / 基线截图 | `chore/ui-baseline` | 完成，合入 develop | 已确认 |
| 1 | 中式星图方向、PRODUCT.md / DESIGN.md、style tile | `docs/ui-direction` | 完成，合入 develop | 已选 B |
| 2.1 | 顶栏 | `ui/topbar` | 完成，合入 develop | 已确认 |
| 2.2 | 左侧仪表盘 | `ui/panel` | 完成，合入 develop | 已确认 |
| 2.3 | 底部星轨 | `ui/star-track` | 完成，合入 develop | 已确认 |
| 2.4 | 右侧粒度轨 | `ui/rail` | 完成，合入 develop | 已确认 |
| 2.5 | 左下缩放条 | `ui/zoom` | 完成，合入 develop | 已确认 |
| 2.6 | 记一笔浮层 | `ui/entry` | 完成，合入 develop | 已确认 |
| 2.7 | 下钻二部图（只改视觉） | `ui/graph` | 完成，合入 develop | 已确认 |
| 2.8 | 账本菜单 + 标签管理 | `ui/menus` | 完成，合入 develop | 已确认 |
| 2.9 | 花销明细 + 账单详情/编辑 + 命名/取色 | `ui/details` | 完成，合入 develop | 已确认 |
| 2.10 | 全局收尾、旧玻璃/渐变清理、README 截图 | `ui/polish` | 完成，合入 develop | 已确认 |
| 2.11 | 左/右/底栏可拖拽；左栏可收起 | `ui/resizable` | 完成，合入 develop | 已确认 |
| M0 | 移动端布局与触控原型 | `feat/mobile-m0` | 完成，合入 develop | 已确认 |
| G1 | 网页版首次存储选择页 | `feat/webapp-gate` | 完成，合入 develop | 已确认 |
| M1a | 移动端生产骨架：主视图 / 读数 / 记一笔 | `feat/mobile-m1` | 完成，合入 develop | 已确认 |
| M1b | 顶栏紧凑化 / 安全区 / 浮层收口 | `feat/mobile-m1b` | 完成，合入 develop | 已确认 |
| M1c | 软键盘视口 / 横屏回退 | `feat/mobile-m1c` | 完成，合入 develop | 已确认 |
| M2a/b | Capacitor APK + Android 模拟器 WebView E2E | `feat/mobile-m2-android` | 完成，合入 develop | 已确认 |
| M2c | Android 硬件返回键 | `feat/mobile-m2c` | 完成，合入 develop | 已确认 |

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

## 阶段 2.3 交付（完成）

- [x] 星轨从悬浮玻璃卡片改为贯穿全宽的 150px 刻度长轨；无圆角、无 blur。
- [x] 面板底边对齐到 150px；旧星轨的 190px 避让取消。
- [x] Canvas 重绘：黄铜基线 + 疏密刻度、金额读数柱、实心星珠、黄铜连线、今天游标；去掉发光/渐变面积图。
- [x] 三档（日/月/年）都是同一条直轨；节点/标签/今天标记/选中/hover 逻辑保留。
- [x] 星轨全部数据与交互保留：日/月/年节点、点击、拖拽、滚轮、右轨同步、tooltip。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/01-overview.png`、`06-detail.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.3 设计点

- 星轨 `position:fixed; left:0; right:0; bottom:0; height:150px`；顶部 1px 黄铜线；面板 `bottom:150px` 对齐。
- 基线在 canvas 46% 高度；节点全部落在同一条线上；刻度每 18px 一个，90px 一个长刻度。
- 金额不再用面积图，改成每颗星下方的 1px 黄铜读数柱；星点大小仍按金额。
- 今天是一根黄铜游标 + 双环；选中是星白细环；hover 是更亮细环，不再呼吸发光。
- 阶段 2.4 已改右轨，阶段 2.5 已改缩放条。

## 阶段 2.4 交付（完成）

- [x] 右轨从悬浮玻璃滑杆改为贯穿上下的垂直校准尺：无圆角、无发光、无渐变。
- [x] 位置 `right:0; top:64px; bottom:150px`，宽 52px，左边 1px 黄铜线，实底。
- [x] 四级标签「日 / 月 / 年 / 全部」；刻度横跨轨宽：1px 中心线、12px 小刻度、60px 大刻度；黄铜游标 30×10px。
- [x] 保留 `#rail` / `#railHandle` 与全部交互：拖动、滚轮、松手吸附、与星轨/右轨同步。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/01-overview.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.4 设计点

- 右轨是「仪器校准尺」，不是滚动条：日/月/年/全部四级刻度，中段连续；标签用无衬线小字距。
- 刻度用 CSS repeating-linear-gradient，不引入渐变发光；游标是一块黄铜横条，中心有星白细线。
- 右轨高度随视口；面板/星轨底边对齐 150px，右轨也在 150px 结束。
- 阶段 2.5 已改缩放条。

## 阶段 2.5 交付（完成）

- [x] 左下缩放条从悬浮玻璃胶囊改为 28px 高的校准尺：直角、实底、黄铜边框。
- [x] 保留 `－ / + / 滑杆 / 百分比` 四个元素；`#zoomRange` / `#zoomOut` / `#zoomIn` / `#zoomVal` 全部保留。
- [x] 滑杆 104px，轨道是 12px 小刻度 + 中央横线；游标是 3×18px 黄铜细线。
- [x] 去掉渐变、圆角、发光；hover 只换底色/字色。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/01-overview.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.5 设计点

- 缩放条是二级控件，28px 高、不抢星图；位置仍在面板右侧、星轨上方。
- 刻度是 CSS repeating-linear-gradient；滑杆游标是一条黄铜竖线，不是发光圆球。
- 百分比用等宽数字；−/+ 是直角刻度块，不是圆形按钮。
- 宽度 <1100px 时面板隐藏，缩放条回到左边 16px。

## 阶段 2.6 交付（完成）

- [x] 记一笔从居中玻璃弹窗改为右侧 440px 账笺（side sheet），从顶部到底部。
- [x] 去掉 blur/圆角/蓝紫渐变；遮罩只压暗，不再模糊。
- [x] 保留全部字段：支出/收入、金额、品类主 tag + 细分、情境主 tag + 细分、日期、账本、备注、取消/保存。
- [x] 保留所有 ID 与交互：`#mAmount` / `#mCats` / `#mCtx` / `#mNote` / `#modalSave` 等不变。
- [x] 品类/情境 chip、日期/账本输入、备注、保存按钮全部直角化；tag 颜色仍是 chip 内色点。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/entry-2.6.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.6 设计点

- 账笺 `position:fixed; top:0; right:0; bottom:0; width:min(440px,100vw)`；左缘 1px 黄铜线。
- 标题/支出收入 tab/关闭在同一行；金额区左对齐，等宽大数字；字段按品类→情境→日期/账本→备注→footer 排列。
- 主 tag 选中后，细分区在原位展开；切换主 tag 仍会清空细分，原有逻辑不动。
- chip 只保留 tag 色点和文字，不再用圆角高亮药丸；选中用黄铜描边 + 14% 底。

## 阶段 2.7 交付（完成）

- [x] 星图从蓝色发光星体改为石墨星图：环 + 细十字星芒 + 星白核心，无 glow / 无渐变 / 无 lighter。
- [x] 主 tag 用双环，副 tag 用单环 + 四芒，账单用细环，收入用斜置方环（菱形），共享边虚线。
- [x] 连线改成 1px 黄铜刻线；去掉沿线移动的发光粒子。
- [x] 背景改成石墨底 + 稀疏暖白星点 + 极淡浑仪底环；删除流星。
- [x] 标签用宋体，金额用等宽数字；暗色描边保证在星点上可读。
- [x] **图谱逻辑未改**：`buildGraph` 拓扑、点击下钻、hover/pin、平移/缩放、返回、共享线判定都不动。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过；下钻拓扑断言：副 tag 2 / 账单 1 / 归属线 2 / 共享线 1 / 主 tag 0。
- [x] 截图：`docs/ui-redesign/review/graph-2.7.png`、`detail-2.7.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.7 设计点

- 只改 `drawBg` / `drawStar` / `drawIncomeStar` / `label` / 连线绘制；`buildGraph`、`orbitHit`、事件处理不改。
- 主星是双环，不是发光球；收入是斜置方环；账单是细环；节点大小仍按金额。
- 连线只用黄铜色和透明度表达层级；共享关系用 2/5 虚线；hover 关联时线变星白。
- 标签名用宋体、金额用等宽；花销节点仍只在 hover 关联时显示金额，避免几十笔糊成一片。

## 阶段 2.8 交付（完成）

- [x] 账本下拉从玻璃浮层改为直角仪器菜单：1px 黄铜边框、实底、无 blur。
- [x] 保留全部入口：账本切换、新建、重命名、标签管理、导出/导入备份、删除。
- [x] 标签管理从玻璃卡片改为居中仪器登记板：无圆角、无 blur、黄铜边框。
- [x] 保留全部功能：品类/情境切换、↑↓ 排序、重命名、删除、完成/关闭。
- [x] 标签行改成发丝分隔行；主/副层级、未命名弱化、禁用态、滚动条都保留。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/menu-2.8.png`、`tags-2.8.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.8 设计点

- 菜单和登记板都用「黄铜边框 + 实底 + 发丝分隔」；去掉圆角卡片、玻璃、蓝色 hover。
- 账本菜单保留 ✦ 当前账本标记、彩色账本点、危险操作朱砂色。
- 标签管理使用居中 480px 登记板；列表独立滚动，滚动条改深色细轨；完成按钮在底部。
- 所有 DOM ID / 类名 / 事件处理不变，只改样式与呈现。

## 阶段 2.9 交付（完成）

- [x] 花销明细、账单详情、命名/取色三块浮层全部去掉玻璃、圆角、蓝紫渐变。
- [x] 花销明细：500px 登记板，细分分布 + 逐笔列表 + 删除 tag/完成；列表深色细滚动条。
- [x] 账单详情：460px 登记板，金额/日期/账本/类型/关联标签/备注/删除/关闭/编辑全部保留。
- [x] 命名/取色：360px 登记板，名称、色板、自定义颜色、自动、取消/创建全部保留。
- [x] 色板从圆形发光点改成 18px 方形色块；选中用星白描边，不用 glow。
- [x] 账单编辑仍走 2.6 的右侧账笺（不新增编辑面板），字段与保存逻辑不变。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/list-2.9.png`、`view-2.9.png`、`name-2.9.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.9 设计点

- 三块浮层共用「黄铜边框 + 实底 + 发丝分隔 + 直角按钮」的登记板语言；遮罩只压暗。
- 明细列表是发丝分隔行，不是一张张小卡片；金额/日期用等宽数字。
- 详情标签是直角小片，主标签黄铜描边，未命名虚线弱化。
- 取色板是方形色块；自定义颜色输入保留；不再有圆点缩放/白色光晕。
- `make-ui-shots.js` 增加 `07-view-detail` 与 `08-name` 两个 review 状态，方便以后回归。

## 阶段 2.10 交付（完成）

- [x] 删除背景的紫蓝 nebula 光斑、径向暗角、玻璃类与相关动画。
- [x] 全局 tokens 换成 B：石墨底、黄铜、氧化铜绿、暖白、宋体/无衬线/等宽三层字体。
- [x] tooltip / toast / modal 基础层去掉 blur、圆角、渐变和蓝色 glow。
- [x] 面板背景改实底；按钮、段控、危险按钮统一成直角黄铜/朱砂。
- [x] 更新 `docs/screenshots/overview.png` / `entry.png` / `ledger-menu.png` / `detail.png`。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` / `npm run verify:graph` 通过。
- [x] 截图：`docs/ui-redesign/review/polish-2.10.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.10 设计点

- 这次只做全局底座与残留清理，不再改单个界面的结构。
- 颜色/字体走 `:root` tokens；剩余旧组件不再有紫蓝渐变/玻璃。
- README 主截图换成当前 B 方向；其它 docs/screenshots 同步。
- 如果后续要 A/C 皮肤，只需换 token，不再重复结构。

## 阶段 2.11 交付（完成）

- [x] 左栏右缘可拖拽：默认 268px，范围 200–380px；宽度持久化。
- [x] 左栏右上角方形按钮可收起为 34px 窄条，箭头改为向右；再点展开，状态持久化。
- [x] 右轨左缘可拖拽：范围 44–80px；刻度/游标随宽度保持。
- [x] 星轨上缘可拖拽：范围 110–240px；Canvas 高度、面板/右轨底边、缩放条同步。
- [x] 图谱边界改为读取布局值，栏宽/高度变化后在松手时重排；默认值与旧版一致。
- [x] 拖高星轨时每次 pointermove 同步 Canvas 缓冲区，节点不会被纵向拉伸；极限高度也保持正圆。
- [x] 所有手柄有 1px 黄铜提示线、hover 加亮；触摸用 pointer capture。
- [x] 小屏（<1100px）仍隐藏左栏/右轨，不破坏现有响应式。
- [x] `npm test` / `npm run build:web` / `npm run verify:web` 通过。
- [x] 截图：`docs/ui-redesign/review/resize-2.11.png`、`collapsed-2.11.png`、`wide-2.11.png`、`narrow-2.11.png`、`timeline-tall-2.11.png`。
- [x] 用户确认
- [x] 合入 `develop`

### 阶段 2.11 设计点

- 左栏是「可收起的读数柱」：展开是仪器面板，收起是 34px 窄条，只留展开按钮。
- 右轨是「可调宽的校准尺」；星轨是「可调高的刻度长轨」。
- 拖动期间只改 CSS 变量，松手后调用 `resize()` 重排图谱/Canvas；避免拖拽过程反复重建账图。
- 布局写入 `localStorage`（`orbit.ui.layout.v1`）：panelW / railW / timelineH / panelCollapsed。

## 移动端 M0 交付（完成）

- [x] 390×844 / 412×915 移动布局原型：顶栏、结余条、星图、星轨、底部导航。
- [x] 洞察账笺：结余/支出/收入/环比/记录/TOP5/交叉洞察全在，74% 高可滚动。
- [x] 记一笔账笺：金额/品类/情境/日期/账本/备注/保存，94% 高；字段与桌面一致。
- [x] 触控目标：顶栏/关闭 44px，chip 44px，底部导航 48px，星轨节点 44×48px。
- [x] 安全区、软键盘、Android 返回键列入 M1/M2 实现清单。
- [x] 可复现截图脚本 `npm run shots:mobile` → `docs/ui-redesign/review/mobile/`。
- [x] 文档：`docs/ui-redesign/MOBILE.md`。
- [x] 用户确认原型
- [x] 合入 `develop`

### M0 设计点

- 移动端不保留桌面左右栏；读数进底部账笺，结余条放在顶栏下方常驻。
- 星图单指平移、双指缩放；星轨横向拖动；底部导航只保留星图/洞察/记一笔。
- 当前只是原型，硬编码演示数据；不接 `web/` 业务逻辑，也不改生产 UI。

## G1 · 网页版首次存储选择页（完成）

- [x] 独立 `webapp/gate.js` / `gate.css`：石墨底、黄铜线、直角、无玻璃/无蓝紫渐变。
- [x] 桌面双卡：存成真实文件（推荐）/ 存在浏览器里；移动端纵向堆叠。
- [x] 不支持 File System Access 时只显示浏览器存储，不显示不可用按钮。
- [x] 记住过目录但权限失效时，提供“继续使用上次目录”，可重新授权；不再悄悄开空账本。
- [x] 取消文件选择留在 gate；选择/启动失败在 gate 内显示错误，可重试。
- [x] dialog 语义、焦点管理、Tab 焦点陷阱、`role=alert` 错误、48px 触控目标。
- [x] `npm run build:web` 产出 `dist/gate.css`，并在 `dist/index.html` 注入 link。
- [x] `npm test` 新增 `webapp/test/storage.test.js`（权限查询安全降级）；`npm run verify:web` 通过并新增 gate 断言。
- [x] 用户确认
- [x] 合入 `develop`

### G1 设计点

- 首次进入只做一件事：选存放位置；存储路径只解释到“文件 / 浏览器”层面，不堆技术细节。
- 文件卡在支持的浏览器显示；不支持时隐藏，不制造死路。
- 权限失效的错误发生在用户手势之后，gate 不自动请求权限。
- 切换存放方式不会迁移数据，gate 明确提示“两种存放方式的数据互不相通”。

## M1a · 移动端生产骨架（完成）

- [x] 760px 断点：桌面左栏/右轨/缩放条退场，移动端改为全屏星图。
- [x] 顶部结余条：结余、支出、收入、读数入口；数值与桌面左栏同源。
- [x] 底部导航：星图 / 读数 / ＋记一笔；读数打开现有左栏 DOM 的底部账笺。
- [x] 移动端图谱边界重算：顶栏高度、底部星轨和底部导航都参与，不再给隐藏面板留 300px。
- [x] 单指拖拽平移；双指 pinch 缩放（复用 CAM/setScale）。
- [x] 底栏星轨选中月居中；移动端收入标签缩短，避免两颗收入星文字重叠。
- [x] 记一笔复用现有浮层；390×844 下字段、底部保存按钮可达。
- [x] `verify:web` 增加移动端断言：底部导航、顶部结余、读数账笺开关、记一笔、图谱尺寸。
- [x] `npm run build:web` / `npm test` / `verify:web` 通过。
- [x] 用户确认
- [x] 合入 `develop`

### M1a 已知边界

- 顶栏在 390px 下会折成 3 行（品牌、账本/维度/今天/记一笔、期间/总额），信息全保留但还不够紧凑；M1b 收成更稳的两行。
- 右侧粒度轨在移动端隐藏，星图缩放由 pinch 承担；星轨粒度仍可点/拖。
- 顶部安全区尚未单独处理，M1b 一起补。
- 本次不迁移数据；只改移动端布局与触控，桌面回归由现有 E2E 覆盖。

## M1b · 移动端顶栏/安全区/浮层收口（完成）

- [x] 移动端隐藏顶栏的重复月总额，顶栏收成两行；月总额已由结余条的“支出”承担，不丢数值。
- [x] 结余条补上账期（`2026年11月`），避免收掉月总额后失去时间上下文。
- [x] 顶栏加 `safe-area-inset-top`；底部导航高度/星轨位置吃 `safe-area-inset-bottom`；图谱下边界按导航实际高度重算。
- [x] 浮层统一 `max-height:calc(100dvh - 24px)` + 滚动，避免小屏记一笔/明细/标签管理被裁掉。
- [x] 账本下拉限制在视口内。
- [x] `build:web` / `npm test` / `verify:web`（含 390 移动断言）通过，桌面回归通过。
- [x] 用户确认
- [x] 合入 `develop`

### M1b 已知边界

- 移动端不再显示顶栏的“679 天有记录/日均”等长说明，这些在读数账笺里保留。
- 顶部安全区在无刘海的桌面仿真里为 0，真机需 Android 包 M2 再验。
- 本次不处理软键盘顶起、横屏和手势返回，留给 M2/M1c。

## M1c · 软键盘视口与横屏回退（完成）

- [x] `visualViewport` 同步 `--vvh` / `--vv-top`；软键盘弹出时，浮层高度跟着可视视口缩。
- [x] 记一笔账笺在键盘打开时高度 = 可视视口，底部保存区不会被顶到键盘后；字段内部滚动。
- [x] 横屏短视口（≥761px 宽）回到三栏桌面骨架：面板/右轨恢复，竖屏底栏和 126px 星轨不再硬塞。
- [x] 横屏顶栏恢复 56px 单行；星轨 110px。
- [x] `verify:web` 增加两个断言：模拟键盘 390×500 时账笺高度/底边；横屏 844×390 时 panel/nav/图谱。
- [x] `build:web` / `npm test` / `verify:web` 通过，桌面回归通过。
- [x] 用户确认
- [x] 合入 `develop`

### M1c 已知边界

- Android 硬件返回键仍未接；这属于 M2 Capacitor 的 `App.backButton`，不能在纯浏览器里假装完成。
- 软键盘用 CDP 改可视视口模拟，真实 Gboard/第三方输入法的 offset 还需真机。
- 横屏只回退到桌面骨架，不另做横屏移动编排；844×390 可读，极窄横屏（<761px）仍走竖屏移动布局。

## M2a/M2b · Android APK 与模拟器链路（完成）

- [x] Capacitor 8.6.2 Android 工程；debug APK 在 GitHub Actions 构建成功。
- [x] Android Emulator（API 35 / Pixel 6）安装 APK，通过 WebView CDP 驱动真实 DOM。
- [x] 首次 gate（Android 只显示浏览器存储）；进入移动壳；读数账笺；记一笔 ¥12.34。
- [x] 系统旋转横屏；force-stop 后重开，12.34 恢复且不再回 gate。
- [x] 修复浏览器存储模式未持久化的问题（`orbit.storage.mode`）。
- [x] 截图 artifact：android-main / android-after-add / android-landscape / android-relaunch。
- [x] 文档：`docs/ui-redesign/M2.md`。
- [x] 用户确认
- [x] 合入 `develop`

### M2 已知边界

- 仅 debug APK；没有 release keystore/签名，不发版。
- 未接 Android 硬件返回键/手势返回。
- 未在真机验刘海、输入法、厂商 WebView；模拟器不能替代真机。
- 本地无 JDK/Android SDK/KVM；当前以 CI 的 APK + emulator run 为准。

## M2c · Android 硬件返回键（完成）

- [x] `MainActivity.onBackPressed()` 先调用网页 `window.__orbitBack()`：有浮层时只关最上层，根视图才退出。
- [x] 返回顺序：命名/记一笔/明细/标签/详情/移动读数账笺/账本菜单/下钻，最后才退出。
- [x] Android smoke 增加两条断言：返回键关读数账笺、关记一笔账笺，进程仍在。
- [x] `build:web` / `npm test` / `verify:web` / Android Emulator E2E 通过。
- [x] 合入 `develop`。

### M2c 仍待

- release keystore 与签名 APK/AAB（不向用户索取 keystore 内容；用 CI secrets）。
- 真机刘海/输入法/厂商 WebView/性能抽测。
- APK 品牌图标/启动图。

## 合入记录

| 日期 | 界面 | 分支 | commit | 确认 | 备注 |
|---|---|---|---|---|---|
| 2026-11-08 | 阶段 0 基线 | `chore/ui-baseline` | 7c890fa | 已确认 | 只改测试/文档/只读调试接口，无生产 UI 改动 |
| 2026-11-08 | 阶段 1 方向 | `docs/ui-direction` | 3ea86d5 | 已选 B | B 为结构基线；A/C 留作后续皮肤 |
| 2026-11-08 | 阶段 2.1 顶栏 | `ui/topbar` | d6acd6a | 已确认 | 全宽仪器横梁；未改 app.js |
| 2026-11-08 | 阶段 2.2 左侧仪表盘 | `ui/panel` | 21b361a | 已确认 | 仪器读数；E2E 负结余色断言更新 |
| 2026-11-08 | 阶段 2.3 底部星轨 | `ui/star-track` | 122397b | 已确认 | 全宽刻度长轨；Canvas 去发光 |
| 2026-11-08 | 阶段 2.4 右侧粒度轨 | `ui/rail` | d364ac5 | 已确认 | 四级刻度；全高校准尺 |
| 2026-11-08 | 阶段 2.5 左下缩放条 | `ui/zoom` | 9b8b092 | 已确认 | 黄铜校准尺 |
| 2026-11-08 | 阶段 2.6 记一笔 | `ui/entry` | 7a8e090 | 已确认 | 右侧通高账笺 |
| 2026-11-08 | 阶段 2.7 星图 | `ui/graph` | 3f25aae | 已确认 | 石墨星图；逻辑未动 |
| 2026-11-08 | 阶段 2.8 菜单/标签 | `ui/menus` | 2e431a3 | 已确认 | 仪器菜单与登记板 |
| 2026-11-08 | 阶段 2.9 明细/详情/取色 | `ui/details` | 6460367 | 已确认 | 三块登记板 |
| 2026-11-08 | 阶段 2.10 全局收尾 | `ui/polish` | 4706cdf | 已确认 | 清理旧玻璃/光斑；README 截图更新 |
| 2026-11-12 | 阶段 2.11 可调栏 | `ui/resizable` | e41beac | 已确认 | 三栏拖拽/左栏收起；星轨节点不变形 |
| 2026-11-13 | G1 首次存储页 | `feat/webapp-gate` | 8f9c32b | 已确认 | B 视觉；移动端单选项；目录重授权 |
| 2026-11-13 | M0 移动端原型 | `feat/mobile-m0` | 285a9ae | 已确认 | 390/412 布局；账笺与触控原型 |
| 2026-11-13 | M1a 移动端生产骨架 | `feat/mobile-m1` | fc8a931 | 已确认 | 760 断点；结余/底部导航/读数账笺/pinch |
| 2026-11-14 | M1b 顶栏/安全区/浮层 | `feat/mobile-m1b` | 6f0c800 | 已确认 | 两行顶栏；账期；安全区；浮层滚动 |
| 2026-11-14 | M1c 键盘/横屏 | `feat/mobile-m1c` | 29c39eb | 已确认 | visualViewport；横屏三栏回退 |
| 2026-11-14 | M2a/b Android | `feat/mobile-m2-android` | b035e22 | 已确认 | debug APK；API 35 模拟器；持久化 |
| 2026-11-14 | M2c Android 返回键 | `feat/mobile-m2c` | 本次合并 | 已确认 | 先关浮层再退出 |

## 备注

- `docs/ui-redesign/review/` 只放本地 review 截图，不入库。
- `docs/screenshots/` 已更新为 B 方向当前界面；后续发版前如 UI 再变需同步。
- `.dsh/`（Impeccable 安装）保持本地未跟踪，不随 UI 提交。
- 阶段 0 只动测试/文档/只读调试接口，不改任何生产 UI。
- Linux 打包已改为 deb + rpm，CI 用系统 fpm + Electron 镜像（`ccba250`），不再依赖 electron-builder 的 GitHub 资产。
