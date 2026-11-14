---
name: Orbit 星账
description: 中式星图 × 浑仪气质的本地优先账本
colors:
  ground: "#070a09"
  surface: "#0d1110"
  surface-raised: "#111613"
  brass: "#b08d57"
  copper: "#8a5a44"
  patina: "#6f8f82"
  star: "#e3e9df"
  ink-text: "#e8e2d2"
  dim: "#92978c"
  cinnabar: "#b33a2b"
typography:
  display:
    fontFamily: "Noto Serif CJK SC, Source Han Serif SC, Songti SC, SimSun, serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0.04em"
  ui:
    fontFamily: "Noto Sans CJK SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.02em"
  numeric:
    fontFamily: "SFMono-Regular, Cascadia Mono, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.02em"
rounded:
  none: "0px"
spacing:
  hairline: "1px"
  xs: "5px"
  sm: "8px"
  md: "14px"
  lg: "22px"
components:
  topbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "64px"
  add-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brass}"
    rounded: "{rounded.none}"
    padding: "8px 13px"
  entry-sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.none}"
    padding: "26px"
    width: "430px"
---

# Design System: Orbit 星账

## Overview

**已选方向：B · 浑仪铜鉴。** 界面是一台夜间使用的观测仪器：石墨底、失光黄铜、氧化铜绿、星白；控件是刻度、环、读数，而不是悬浮圆角卡片或毛玻璃。

A · 绢本星图 与 C · 碑拓星图 不作为并列世界，保留为后续主题皮肤：同一套结构、tokens 不同的材质变体。皮肤以后在设置里切换；本阶段只做默认皮肤 B。

这次不是给旧界面换色。结构必须一起改：

- 顶栏从悬浮胶囊变成贯穿全宽的**仪器横梁**。
- 左面板从 KPI 卡片变成**竖排读数**，用刻度、对齐、发丝线分层。
- 星轨从浮动卡片变成**底部的刻度长轨**，节点是刻度上的星珠。
- 右轨与缩放从发光滑杆变成**校准刻度/环形读数**。
- 记一笔从居中毛玻璃弹窗变成**右侧账笺（side sheet）**，保留全部字段与操作。
- 星图本身保留图谱逻辑，只换视觉语言：主星=双环，副星=单环，账单=小珠，收入=斜置菱形/环，共享线=虚线。

**冻结**：主 tag 相连、点击主 tag 下钻、下钻「副 tag × 账单」二部图、共享线、返回、hover/pin、平移缩放；所有功能与信息不得减少。

## Colors

- **Ground `#070a09`**：石墨黑，带一点绿；不是纯黑，给铜色留出温度。
- **Surface `#0d1110` / raised `#111613`**：仪器面板，靠 1px 双线和明度差分层；不用 blur。
- **Brass `#b08d57`**：主强调、刻度、焦点、当前状态；少量。
- **Copper `#8a5a44`**：次强调、警示/删除的暖色替代；不用于大面积。
- **Patina `#6f8f82`**：收入、成功、稳定状态；冷而旧。
- **Star `#e3e9df`**：星点与最高层级文字；略带灰绿，不是纯白。
- **Ink text `#e8e2d2` / dim `#92978c`**：正文与说明；正文必须达到 AA。
- **Cinnabar `#b33a2b`**：只做印章式强调（保存、当前 tab），不铺满。
- **数据颜色**：tag 自带颜色是画面里主要的饱和色；chrome 保持中性，不能与数据抢。

**Skins**：A 绢本把 surface 换成墨蓝绢、brass 换成朱砂/金、字体换宋体；C 碑拓用炭黑、蛤白刻线与浅色拓纸 sheet。三者共用同一结构、同一组件尺寸、同一信息密度；皮肤只换 tokens 与星形材质，不改布局/逻辑。

## Typography

- **Display**：宋体/思源宋体，只用于品牌、sheet 标题、少量题签；不用于长正文。
- **UI**：中文无衬线（Noto Sans CJK SC / PingFang SC / Microsoft YaHei），字距略宽（`.02–.2em`），用于控件、标签、说明。
- **Numeric**：等宽数字，所有金额、百分比、日期、刻度；`font-variant-numeric: tabular-nums`。
- 不用 Inter 作为默认；不用渐变文字；标题靠字号/字重/字距建立层级。
- 中文小标签用 letter-spacing 而不是全大写英文；英文只做仪器刻度/注释。

## Layout

- **顶栏**：`height 64px`，全宽，左品牌、左账本/维度、右期间/总额/记一笔；底部 1px 双线。不是浮动圆角条。
- **左读数**：`width 268px`，`top 64px`、`bottom 104px`；竖排：期间 → 结余 → 支出/收入/环比 → 分隔线 → TOP 星官 → 下钻预览。没有卡片外框，只有右缘 1px 线和内部发丝线。
- **星图 plate**：`left 268px`、`top 64px`、`bottom 104px`；星图是主角，占最大面积；允许节点超出视口，靠平移/缩放查看。
- **星轨**：底部 104px 全宽刻度条；标题在左，操作提示在右；节点在一条基线上。
- **右轨**：宽 28px 的竖直校准尺，贴近右缘；日/全部只在两端。
- **缩放**：左下方的小型校准读数，不抢星图；与右轨分离。
- **记一笔**：右侧 430px 账笺，覆盖星图右侧；标题、金额、品类/情境、日期/账本、备注、最近、保存。所有字段保留。
- **可调栏**：左读数柱 200–380px（可收至 34px 窄条）；右校准尺 44–80px；底部星轨 110–240px。拖动只改布局，松手重排星图；尺寸持久化。

## Elevation & Depth

- **不做毛玻璃、不做 backdrop-filter、不做发光边缘。** 深度来自：1px 双线、内嵌的 raised 面板、明度差、刻度的疏密。
- 当前/选中状态：brass 1px 外框 + 极轻的 inset 明度，不用彩色 glow。
- 星点可以有 1px 的十字星芒，但不做零偏移彩色光晕。
- 阴影只用于右侧账笺（`-24px 0 70px`）与极少数浮层；卡片本身不投影。

## Shapes

- 圆角：**0**。按钮、输入、面板、sheet 都是直角；圆只属于星点、环、刻度。
- 按钮是矩形刻度块，不是胶囊；chip 是直角小片，不是圆角药丸。
- 星形语法：
  - 主星（主 tag）：双环 + 星白核心，半径由金额平方根决定。
  - 副星（副 tag）：单环，较小。
  - 账单：实心小珠，金额决定大小。
  - 收入：斜置菱形/开口环，patina 色；与支出形状不同。
  - 共享线：1px 虚线；归属线：1px 实线。
- 轨道：横轨是刻度尺，纵轨是校准尺；不是渐变光条。

## Components

- **Topbar**：品牌印（“星”字方印/铜环）、账本、品类/情境、回到今天、期间、总额、记一笔。所有原入口保留。
- **Readout**：结余大字、支出/收入/环比、TOP 星官行（名称/刻度/金额）、下钻预览。无卡片。
- **Timeline**：`星轨 · 时序` 标题、操作提示、基线、星珠、今天游标（brass）、月份标签。保留点击/拖拽/滚轮。
- **Rail**：日/全部、主刻度/次刻度、brass 游标；保留拖动/滚轮。
- **Zoom**：`−` / 刻度线 / `+` / 百分比；保留滑杆/按钮行为（阶段 2.5 重做）。
- **Entry sheet**：右侧账笺；支出/收入 tab、金额、品类/情境主副 tag、新建、日期、账本、备注、最近、取消/保存；保留全部字段与键盘。
- **Star grammar**：主/副/账单/收入/共享线五种形态；所有标签与金额可见；不靠颜色单一编码。
- **Graph frame**：L1 与下钻的拓扑不变；只换绘制材质与标签排版。

## Do's and Don'ts

**Do**

- 用发丝线、刻度、对齐、留白建立层级。
- 让 tag 颜色成为画面里主要的饱和色；chrome 退到石墨/铜。
- 所有金额用等宽数字；所有小标签有足够字距。
- 保留每个入口、字段、Canvas 标签、tooltip、今天标记、共享线。
- 一次只改一个界面；改前/改后截图 + 信息量对照。

**Don't**

- 不用磨砂玻璃、紫蓝渐变、发光文字、零偏移彩色 halo。
- 不做圆角卡片套卡片、不做胶囊按钮泛滥、不做通用 KPI 仪表盘。
- 不用国潮贴皮（灯笼/龙纹/祥云/书法堆砌），不伪造星官名。
- 不为了“干净”隐藏信息；拥挤时用错位/引线/缩小字号，不删。
- 不碰 `buildGraph` 拓扑、`computeHot`、`pointerup` 导航、`enterDetail`/`goBack`。
- 不在本阶段加主题切换 UI；A/C 皮肤等结构稳定后再做。
