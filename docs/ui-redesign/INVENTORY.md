# Orbit 界面信息与功能清单

> 阶段 0 基线，作为「不阉割」验收合同。
> 规则：只允许改排版、分组、字体、颜色、材质、动效；不允许删除字段、入口、操作或 Canvas 信息。
> 桌面默认 1440×900 / 1920×1080 下，当前可见的信息改版后仍须可见；移动端按 760px 断点重新编排（不是隐藏信息），桌面布局不变。
> 1.2.3 起 Android APK 与桌面/网页共用同一份界面与业务能力；toast 通知层已全局关闭。

## 全局约定

| 项 | 内容 | 验收 |
|---|---|---|
| 金额 | 一律走 `fmtYuan` / `moneyText`，精确到分；顶部、面板、节点、tooltip、详情、编辑框同口径 | 分位非 0 的金额在每处都带小数；编辑前后不变 |
| 日期/今天 | 本地日期 `todayISO()`；星轨只给真实今天加标记；今天没记账时下标为 -1 | `docs/frontend-rendering.md` 的测试与 E2E |
| 刷新链 | `Data.afterChange()` → `refreshTagArrays()` → `refreshMonths()` / `refreshAmounts()` → `buildGraph()` / `syncChrome()` | 记账/导入/编辑/删除后不出现「数据有了但图里没有」 |
| 历史 | 账本/维度/主视图↔下钻各占一条浏览器历史；浮层与星轨浏览位置不入历史 | 前进/后退恢复正确 |
| 提示 | 通知层已按用户要求全局关闭（toast hidden/display:none）；tooltip 仍跟随指针 | tooltip 不挡点击；不再弹 toast |
| 空/错误 | 空账本/空时段仍显示空态；坏文件/删除保护/网络失败进控制台或原生日志（toast 已关闭） | 不再弹通知；排查看 Console/Logcat |

## 顶栏 `header.topbar`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 品牌 logo +「Orbit 星账」 | `.brand` / `.logo` / `.brand-text` | 仍在，链接/图标不丢 |
| 当前账本名 + 切换下拉 | `#ledgerBtn` / `#ledgerMenu` | 显示当前账本；点击展开；每个账本可切换 |
| 品类 / 情境维度切换 | `#dimSeg`、`.seg[data-v]` | 两个维度都可切；选中态正确；切换回主视图 |
| 回到今天 | `#btnToday` | 可点；落在今天或最后一个不晚于今天的格子 |
| 返回主视图 | `#btnBack`（仅下钻显示，文本含主 tag 名与金额） | 下钻时出现；点击回 L1 |
| 当前期间 + 支出 + 笔数/天数 | `#mtLabel` | 文案含期间、支出、笔数/天数；切换档位更新 |
| 当前期间支出总额 | `#mtValue` | 与数据层一致；分位非 0 时带小数 |
| 记一笔 | `#btnAdd` | 打开记一笔浮层；不改变当前时间窗 |

## 左侧洞察面板 `aside#insightPanel`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 面板标题（当前期间） | `#pTitle` | 含期间语义（如「当日星图」） |
| 结余 | `#pNum` | `收入 − 支出`；负数标红；始终有「结余」标签 |
| 支出 | `#pExp` | 与顶栏同一个口径 |
| 收入 | `#pInc` | 与数据层一致 |
| 环比/跨期说明 | `#pDelta` | 日/月显示环比；年/全部显示跨期说明，不伪造环比 |
| 记录天数/笔数 + 日均支出 | `#pCount` | 来源语义正确（天 vs 笔），空账本不显示 1 笔 |
| TOP 分类（最多 5 条） | `#topList .top-row` | 色点、名称、占比条、金额都在；按金额降序 |
| TOP 行 hover 联动星图 | `.top-row` mouseenter/leave | 对应星图节点高亮 |
| TOP 行点击下钻/明细 | `.top-row` click → `openExpenseList` | 能打开该类明细 |
| 交叉洞察/最大支出星系 | `#insightBox` | 文案仍在；空账本有空状态 |

## 底部星轨 `footer.timeline` + `#orbit`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 标题与操作提示 | `.tl-title` / `#tlTip` | 随档位更新；含点击/滚轮提示 |
| 日/月/年/全部四档 | 滚轮、右轨拖动、点击节点 | 四档都能到；档位切换不改数据 |
| 月/日/年节点与标签 | Canvas `drawOrbitMonth/Day/Year` | 每个节点仍有名称/期间/金额语义 |
| 今天标记 | Canvas 呼吸环/「✦ 今天」 | 只标真实今天；今天没记账不标末尾 |
| 选中年份/月份/日期 | Canvas 选中环 + `TL.sel` | 选中态可见；点击/拖拽同步 |
| hover 提示 | `#tooltip` / `OrbitDebug.tipFor` | 显示对应节点金额/期间 |
| 左右拖拽 | `#orbit` pointer events | 视口平移且限位；点击节点不复位 |
| 连续变焦 | 滚轮 / 右轨 | 档位与视口中心保持合理 |
| 星轨刻度/背景 | Canvas | 时间方向（左早右近）仍可读 |

## 右侧粒度轨 `#railWrap`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 日 / 全部标记 | `.rail-mark` | 两端语义仍在 |
| 拖动换档 | `#rail` pointer events | 上=日、下=年；与星轨同步 |
| 滚轮换档 | `#railWrap` wheel | 可滚；不误触画布缩放 |
| 当前档位/手柄位置 | `#railHandle` / `syncRail()` | 位置与档位一致 |

## 左下画布缩放 `#zoomBar`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 缩小 / 放大按钮 | `#zoomOut` / `#zoomIn` | 改变画布缩放；有边界 |
| 缩放滑杆 | `#zoomRange`（0.4–2.6） | 拖动改缩放；与按钮一致 |
| 百分比 | `#zoomVal` | 显示当前倍数（如 100%） |

## 记一笔浮层 `#modalMask`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 标题（记一笔/编辑） | `#modalMode` | 新建与编辑文案正确 |
| 支出 / 收入 tab | `.m-tab`（两个） | 切换类型；收入候选与情境仍正确 |
| 关闭 / 取消 | `#modalClose` / `#modalCancel` | 关闭不保存 |
| 金额 + 货币符号 | `#mAmount` / `.m-amount` | 默认 88；可输入小数；编辑精确回填 |
| 品类标签 + 新建 | `#mCats` / `#btnAddCat` | 主 tag 可选中/再点取消；收入候选正确 |
| 品类细分区 + 新建 | `#mCatsSub` / `#mCatsSubChips` / `#mCatsSubAdd` | 选中主 tag 后出现；可多选；切换主 tag 清空 |
| 情境标签 + 新建 | `#mCtx` / `#btnAddCtx` | 支出/收入都显示；主 tag 可选中/取消 |
| 情境细分区 + 新建 | `#mCtxSub` / `#mCtxSubChips` / `#mCtxSubAdd` | 同上；副 tag 只能挂本笔主 tag |
| 日期 | `.m-row input[type=date]` | 默认今天；编辑回填原日期 |
| 账本 | `.m-row select` | 默认当前账本；编辑锁定原账本 |
| 备注 | `#mNote` | 多行；编辑回填；Ctrl/Cmd+Enter 保存 |
| 保存 | `#modalSave` | 校验、提交、刷新链；错误只进控制台（toast 已关闭） |
| 编辑回填 | `.m-tab` / 主/副 tag / 金额 / 日期 / 备注 | 打开编辑时全部原样回填 |

## 下钻二部图 `#graph`（L1 → detail）

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| L1 主 tag 节点 | Canvas，`kind:'cat'` | 名称/金额可见；金额大小映射星等；按金额降序连线 |
| L1 收入节点 | Canvas，`kind:'inc'` | 独立一排；形状/颜色区别于支出；名称/金额可见 |
| L1 轨迹线与 hover | Canvas + `#tooltip` | 主 tag 相连；hover 高亮关联节点/连线 |
| 点击主 tag 下钻 | Canvas pointerup → `enterDetail` | 进入 detail；返回按钮显示主 tag 名与金额 |
| 下钻副 tag 节点 | Canvas，`kind:'sub'` | 名称/金额可见；外环排布 |
| 下钻账单节点 | Canvas，`kind:'exp'` | 金额可见；内环排布；点击打开账单详情 |
| 账单 ↔ 副 tag 实线 | Canvas links | 每笔归属关系可见 |
| 共享虚线 | Canvas links `shared` | 一笔挂多个副 tag 时出现；hover 点亮两端与账单 |
| hover/pin 高亮 | `computeHot` | 节点/连线高亮；点空白清除 pin |
| 点击副 tag | pointerup → `openExpenseList` | 打开该细分明细并保持高亮 |
| 空白点击 | pointerup | 先清 pin，再点返回主视图 |
| 平移/缩放 | `#graph` pointer/wheel + `CAM` | 下钻内容可查看；返回后恢复 |
| 返回主视图 | `#btnBack` / 浏览器后退 | 回到 L1；历史正确 |
| 提示 | `.hint` | 下钻与 L1 的操作提示不同且正确 |

## 账本下拉 `#ledgerMenu`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 账本列表（色点/名称/当前标记） | `.dd-item` | 全部账本可见；当前项有标记 |
| 切换账本 | `.dd-item` click | 切换后整链刷新 |
| 新建账本 | `#ddNewLedger` | 打开命名浮层 |
| 重命名当前账本 | `#ddRenameLedger` | 打开命名浮层并回填 |
| 标签管理 | `#ddManageTags` | 打开标签管理浮层 |
| 导出备份 | `#ddExportBackup` | 下载 / Android 系统分享 JSON |
| 导入备份 | `#ddImportBackup` | 选文件；导入为新账本；失败提示 |
| 删除当前账本 | `#ddDelLedger` | 二次确认；删空后自动建默认账本 |

## 标签管理 `#tagMask`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 品类/情境切换 | `#tagDimSeg` | 两个维度都可管理 |
| 标签列表（主/副层级） | `#tagList .t-row` | 主/副层级、占位态、顺序可见 |
| 上移/下移 | `.t-mv` | 顺序落库；候选与星图顺序更新 |
| 重命名 | `.t-edit` | 打开命名浮层并回填 |
| 删除 | `.t-del` | 被引用时拒绝；未引用可删 |
| 完成 | `#tagDone` | 关闭浮层 |

## 花销明细 `#expMask`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 标题（品类/情境/细分） | `#expTitle` | 语义正确 |
| 重命名 / 改色 | `#expRenameTag` / `#expRecolorTag` | 打开对应浮层 |
| 色板/自定义色 | `#expSwatches` / `#expCustom` | 改色生效；清除覆盖色 |
| 副 tag 分布 | `#expDist` / `#expDistRows` | 有副 tag 时显示金额/笔数/占比；多选提示 |
| 逐笔列表 | `#expList .e-row` | 日期、金额、类型、删除入口都在 |
| 点击一笔 | `.e-row` click | 打开账单详情 |
| 删除一笔 | `.e-del` | 确认后删除；刷新链 |
| 删除此 tag | `#expDelTag` | 被引用时拒绝；未引用可删 |
| 完成 | `#expDone` | 关闭浮层 |

## 账单详情 / 编辑 `#viewMask` / `#modalMask`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 金额（收入/支出色） | `#viewAmount` | 精确到分；收入色正确 |
| 日期 / 账本 / 类型 | `#viewDate` / `#viewLedger` / `#viewType` | 全部显示 |
| 关联标签（主/副 + 维度） | `#viewTags` | 实际关联的 tag 全列出；占位有弱化样式 |
| 备注 | `#viewNote` | 多行、空状态 |
| 删除 | `#viewDel` | 二次确认；刷新链 |
| 编辑 | `#viewEdit` | 打开编辑浮层并回填 |
| 关闭 | `#viewClose` / `#viewClose2` | 关闭浮层 |

## 命名 / 取色 `#nameMask`

| 信息/操作 | 当前入口/选择器 | 验收 |
|---|---|---|
| 标题/输入 | `#nameTitle` / `#nameInput` | 新建/重命名文案正确；名称回填 |
| 色板 | `#nameColors` / `#ncSwatches` | 新建/重命名 tag 时可见；可选 |
| 自动取色 | `#ncDefault` | 清除覆盖色 |
| 自定义色 | `#ncCustom` | 取色生效 |
| 取消/创建 | `#nameCancel` / `#nameOk` | 校验、提交 |

## Canvas 专属信息（截图也要核对）

- L1：主 tag 名称/金额、收入名称/金额、轨迹线、hover tooltip、返回按钮金额、提示文案。
- 下钻：副 tag 名称/金额、账单金额、归属实线、共享虚线、hover 高亮、pin 持续高亮、返回按钮主 tag 名/金额。
- 星轨：月/日/年标签、金额、今天标记、选中环、hover tooltip、刻度。
- 以上信息不能因为「画面更干净」而消失；拥挤时用错位、引线、缩小字号或分层，不隐藏。

## 平台补充（1.2.3）

- Android APK 与桌面/网页共用信息与操作集合；移动端读数、记一笔、备份/导入、返回键均保留。
- 通知层在桌面、网页、Android 全部关闭；工具提示（tooltip）保留。
- Android 存储支持 SAF 真实目录与 WebView 内部存储两种模式。
