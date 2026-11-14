# Orbit 星账 · 界面层约定

界面在 `web/`（`app.js` + `data.js` + `styles.css`），桌面端、网页版、Android WebView **共用同一份**，一行不改。
它不做业务判断，只负责「把数据画成星图 / 星轨，把用户操作转成 API 调用」。
本文记录几条**踩过坑才定下来的硬约定**，改界面之前先读它。

---

## 1. 金额显示：只有一个出口

账本的最小单位是**分**（`amount_cents`），所以金额文本必须精确到分、分以下不计。

```js
moneyText(cents, group = true)   // 分 → '1,905.36' / '12' / '12.5'（末尾 0 不写；group=false 给输入框，不能有逗号）
fmtYuan(yuan)                    // 元 → '¥1,905.36'（负数写成 '-¥…'，负号在货币符号前）
```

- **所有**金额显示都走这两个函数：顶部总额、左侧洞察三数、日均、星图标签、星轨 tooltip、年档金额、
  账单详情、明细列表、下钻返回按钮、确认框、编辑框回填。（toast 已全局关闭，不再有文本出口。）
- 不要在别处写 `Math.round(x).toLocaleString()` 或 `'¥' + (cents / 100)` —— 只要存在第二处，
  同一个数就会在两处不一样（曾经左边 ¥1,905、右边 ¥1,905.36）。
- `Math.round(v)` 这种「精确到元」的写法等于丢掉角分；`(cents / 100).toFixed(0)` 更糟 ——
  它是**在打开编辑浮层的那一刻就把小数位抹掉**，用户切一下类型再保存，钱就变了。
- 入参先落到整数分（`Math.round(Number(cents) || 0)`）：`/100` 带来的浮点毛刺到此为止，
  不会出现 `¥1,905.3600000000001`。
- **结余的显示口径**（看板三数与星轨节点共用，规则在 `OrbitData.balanceColor/balanceAbs`）：
  结余 = 收入 − 支出，界面只显示**绝对值**；结余为正或零用鲜红，为负用鲜绿。
  收入固定鲜红、支出固定鲜绿，不跟随分类色。星轨节点的星等仍按 `total`（有账总额）算，
  不因读数改成结余而变小。

## 2. 时间轴与「今天」

星轨的三档时间轴（`MONTHS` / `DAYS` / `YEARS`）**只含有记账的格子** ——
今天没记账，序列里就没有今天。于是有三个全局下标：

| 变量 | 含义 | 今天没记账时 |
|---|---|---|
| `MONTH_TODAY` | 今天所在月在 `MONTHS` 里的下标 | `-1` |
| `DAY_TODAY` | 今天在 `DAYS` 里的下标 | `-1` |
| `YEAR_TODAY` | 今年在 `YEARS` 里的下标 | `-1` |

- 绘制时**只给 `=== *_TODAY` 的那个节点**加呼吸环与「✦ 今天 / · 今」标注。
  读取「最后一个格子」当今天（`TODAY = MONTHS.length - 1`）是错的：今天没记账时，
  末尾那一格其实是更早的日期，会被标成今天。
- 「回到今天」按钮走 `todayIdxIn(arr, exact, notAfter)`：先精确匹配今天；今天不在序列里时，
  退到**最后一个不晚于今天**的格子。**停在哪一格 ≠ 把那一格标注成今天**，两件事不能混。
- 索引兜底（当前窗口对不上任何节点时）用 `lastMonthIdx()`，与「今天」无关。
- 日期一律用本地日期 `todayISO()`。**不要用 `new Date().toISOString().slice(0, 10)`**：
  那是 UTC，东八区 00:00–08:00 会算成「昨天」，星轨标注与新建时的默认记账日期都会错一天。

## 3. 渲染缓存与刷新链

数据层是 `window.OrbitData`，界面层另有三份**派生缓存**，改完数据必须显式刷新：

| 缓存 | 内容 | 刷新它 |
|---|---|---|
| `CATS` / `CTXS` / `INCOMES` / `SUBS` | 渲染用的 tag 数组（主 tag / 副 tag 索引） | `refreshTagArrays()` |
| `tagAmountMap` | 当前时间窗各 tag 金额（元） | `refreshAmounts()` |
| `MONTHS` / `DAYS` / `YEARS` | 星轨三档序列 | `refreshMonths()` / `refreshDays()` |

**改动数据后的标准刷新链**：

```js
await Data.afterChange();                 // 重拉维度 + 月序列 + 当前时间窗统计
refreshTagArrays();                       // ← 最容易漏的一环
refreshMonths(); refreshAmounts();
buildGraph(); syncChrome();               // 重绘星图/星轨 + 同步顶栏与左侧洞察
```


漏掉 `refreshTagArrays()` 的症状：后端为「未选品类」的第一笔账**懒创建**了「未分类」占位 tag，
`Data.cats` 里有了、渲染数组 `CATS` 里没有 —— 这笔账在星图与顶部列表里根本不存在，
切一下维度或账本才突然冒出来。验收脚本里那条 `expensePlaceholderVisible` 查的是 `Data.cats`
（数据层），**绕过了渲染数组**，所以它守不住这个洞。

## 3.1 主视图只画当前时间窗有账单的主 tag

`buildGraph()` 的 L1 分支先按 `amountsForTime()` 过滤，再决定画哪些 CATS/CTXS；收入节点同样只取当前窗口的 `INCOMES`/`INC_CTXS`。判断依据是**当前选中时间窗的金额**，不是「这个 tag 在别的日/月/年有没有账」。空窗口不补零节点；TOP 分类列表用同一条过滤。


## 4. 只读调试接口 `window.OrbitDebug`

星图/星轨的关键数字都锁在 `app.js` 的闭包里，截图看不出来（画布文字、坐标都在画里）。
`OrbitDebug` 提供只读快照：`snapshot(level)`（档位 / 序列 / 节点画布坐标 / 今天下标）、
`center()`（视口中心与平移量）、`tipFor(kind, idx)`、`tapNode(kind, idx)`。
只读、不含用户数据，留在生产里无害 —— 端到端脚本靠它把「画在哪里、下标是几」变成可断言的数值。

## 5. 移动端

- `≤760px` 启用移动布局：左面板/右轨/缩放条退场；底部导航「星图 / 读数 / ＋记一笔」。
- 顶栏两行 + 结余条；读数复用桌面左栏 DOM，作为底部账笺打开。
- 星轨头部固定「日 / 月 / 年 / 全部」四档；右轨在移动端隐藏，但这四档必须可达。
- 记一笔：金额为空、自动聚焦；日期用内嵌月历（上月/下月/今天），不再依赖系统 date input。
- 横屏 `≥761px` 且短视口回退桌面三栏；`visualViewport` 驱动键盘弹起时的浮层高度。
- 触控目标 ≥44px；安全区由 `safe-area-inset-*` 处理。

## 6. 持久化与通知

- 本地 API 的写操作必须等 `persist` 完成才 resolve；webapp 的 `persist` 等待 `storage.write` + `storage.flush`。
- Android SAF 写入在原生后台线程执行，JS 用 token 回调等待；写失败/超时会释放写锁。
- `visibilitychange=hidden` 时补一次 flush，覆盖退后台。
- 通知层（toast）已按用户要求全局关闭：`toast()` 仅 `console.debug`，`#toast` 强制 `display:none`。
  错误/校验不再弹 UI；排查看控制台或 `adb logcat`。

## 7. 验收判据

`npm run verify:web`（`electron/scripts/verify-webapp.js`）用 Electron 跑一遍真实 UI 路径。
每个判据都对应一个真实踩过的坑，末尾这几条守的是本文第 1、2 节：

- 记一笔 **¥12.34**（分数位非 0 才测得出来）→ 面板支出必须出现小数点；
- 从顶部列表 → 账单明细 → 详情 →「编辑」→ 编辑框里必须仍是 `12.34`；
- `dayToday` 必须等于「今天」在日序列里的下标；
- **把今天的账挪到昨天**后再看：日序列里没有今天时，`dayToday` 必须是 `-1`
  （旧实现取末尾，会指到昨天那一格继续冒充今天）；
- 移动视口：底部导航、结余条、读数账笺、日/年/月切换、金额空焦、日历选日、键盘视口、横屏；
- 通知层必须 hidden 且 display:none；刷新后 gate 不再出现；写操作 promise 必须在 persist 完成后才 resolve。

加判据时注意两点（都栽过）：**判据要有区分力** —— 先想清楚「旧代码会不会也通过」，
必要时先制造前提（本例是把今天的账挪走，否则今天恰好就是末尾，下标法分不出新旧）；
**改了源码必须重建产物**（`npm run build:web` 会把 `web/*.js` 拷进 `webapp/dist/`）。

## 相关

- [architecture.md](architecture.md) —— 业务逻辑层：分层、数据模型、REST / MCP 契约
- `web/app.js` 顶部注释 —— 星图与星轨的绘制模型（星座节点 / 连续变焦 / 四路联动）
