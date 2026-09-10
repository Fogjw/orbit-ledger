# Orbit 星账 · 业务逻辑层架构

> 对齐 Obsidian 需求基线（`10-项目/账单图谱/账单图谱-需求基线.md`）与技术选型文档的分层架构。
> 本文件描述 `server/`（业务逻辑层）；前端（`web/`）的交互与视觉约定见需求基线与 `web/` 源码。

## 分工

```
orbit-ledger/
├─ server/       ★ 业务逻辑层（本仓库后端）：数据 + 业务规则 + REST API
├─ web/          前端（消费本仓库 REST）：零依赖 Canvas2D 星图 + 记账 / 统计 / tag 管理
├─ demo-star/    早期视觉 Demo（纯静态、不接后端，保留作视觉参考）
└─ docs/
   └─ architecture.md（本文档）
```

## 分层

```
┌────────────────────────────────────────────┐
│ API 层 (Express)   routes + validate + 错误映射 │  前端/REST 契约
├────────────────────────────────────────────┤
│ 服务层 (services)  事务边界 + 业务规则 + BizError │  记账/隔离/报表
├────────────────────────────────────────────┤
│ 数据访问 (repos)   纯 SQL，无业务规则          │  每表/聚合一组
├────────────────────────────────────────────┤
│ 数据层 (db)       node:sqlite · WAL · schema  │  五表 + 迁移 + seed
└────────────────────────────────────────────┘
```

依赖只向下：api → services → repos → db。模块用工厂函数注入 `db`，便于测试（内存库）与将来复用。

## 数据模型（五表，对齐需求基线 §3 正交多维度）

| 表 | 职责 | 要点 |
|---|---|---|
| `ledgers` | 账本 | 顶级隔离（D-07）；花销/维度/tag 均挂 ledger_id |
| `dimensions` | 维度 | `(ledger_id, key)` 唯一；key ∈ category/context/payment（MVP: 前两者） |
| `tags` | 维度取值（两级） | `parent_tag_id` 自引用：NULL = **主 tag**（维度取值，如「餐饮」）；非 NULL = **副 tag**（主 tag 的细分，如 餐饮→午餐）。每维/每主 tag 各有一个 **「未分类」占位**（is_unnamed=1，产品层弱化）；颜色可选覆盖 |
| `expenses` | 花销事实表 | type expense/income；**amount_cents 分存储**；date YYYY-MM-DD |
| `expense_tag_links` | 花销↔tag | role primary/secondary；每维一个 primary + N 个 secondary（secondary 须挂在本笔某个 primary 之下） |

**核心不变量（D-03）**：每笔花销每维恰好一个 primary ⇒ 每维 Σ = 总额（「未分类」参与求和）。统计按 type 过滤。

**缺省兜底（记一笔不要求用户选任何 tag）**：
- 某维主 tag 未选 → 落到该维「未分类」主 tag
- 某主 tag 下一个副 tag 都没选 → 补该主 tag 的「未分类」副 tag
- 「未分类」**用到了才创建**（懒创建，不预设）：新账本/新维度里不会有没人用过的占位行；创建与记账同一事务，记账失败则占位 tag 一并回滚。

**副 tag 归属（S6-v3）**：一笔花销的副 tag 只能取自**它自己的主 tag** —— 副 tag 的 `parent_tag_id` 必须 ∈ 本笔的 primary tag 集合。因为「每维恰一 primary」，这一条规则同时实现了「交通通勤下挂不了午餐」与「维度之间互不串味」。副 tag 不参与维度求和（不重复计数）。

**命名唯一性作用域**：`UNIQUE (dimension_id, parent_tag_id, name)`（NULL 视为同作用域）—— 主 tag 之间唯一；副 tag 在同父下唯一，**不同主 tag 下允许同名**（餐饮→其他 与 交通通勤→其他 共存）。层级只支持两级。

## 业务规则（services 层）

- **记账 = 单事务**（`expenseService.add`）：写 expense + 全部 primary + secondary；任一步失败整体回滚（测试锁定）。
- **所有维度均可缺省**（不再有必填维）：缺省 → 该维「未分类」占位主 tag（见上「缺省兜底」）。`dimensions.required` 列保留但当前不参与校验。
- 全部 tag 必须属于同一账本（隔离，防跨账本关联）。
- 副 tag 只能挂在本笔同维主 tag 下，否则 `SUBTAG_NOT_UNDER_PRIMARY`；主/副不可互相冒充（`NOT_A_SUBTAG` / `NOT_A_PRIMARY_TAG`）。
- 副 tag 按名解析遇重名（不同主 tag 下同名）→ 要求用 id（`TAG_AMBIGUOUS`）。
- tag 层级只支持两级：副 tag 之下不可再建（`SUBTAG_DEPTH_EXCEEDED`）；「未分类」不可作为父（`UNNAMED_TAG_LOCKED`）。
- 删除保护扩展：删主 tag 时，其副 tag 若被花销引用也拒删（`TAG_IN_USE`）—— 否则 `ON DELETE CASCADE` 会静默删掉副 tag 及其 links，造成历史断裂。
- 金额正整数（分）；日期 YYYY-MM-DD（schema CHECK + service 双保险）。
- 建账本自动初始化默认维度（品类 6 + 情境 4），**不预设占位 tag**。

## REST API 契约

Base: `http://localhost:5310/api`（端口 env `ORBIT_PORT` 覆盖）。CORS 放开（本地浏览器直连）。| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活 |
| GET/POST | `/ledgers` | 账本列表 / 建账本 `{name}`（自动维度） |
| GET | `/ledgers/:id` | 账本 |
| GET | `/ledgers/:id/dimensions` | 维度+tag 树（录入下拉/图谱源） |
| POST | `/ledgers/:id/dimensions` | 启用扩展维度 `{key,name?}`（如 payment；不预设占位 tag） |
| GET | `/ledgers/:id/export` | 账本全量 JSON 快照（备份，D-13，供未来 import） |
| PATCH/DELETE | `/ledgers/:id` | 改名 `{name}` / 删除 |
| POST | `/ledgers/:id/tags` | 建 tag `{dimensionKey,name,color?,parentTagId?}`——带 `parentTagId` 则在其下建副 tag（父须为同维度主 tag） |
| PATCH/DELETE | `/ledgers/:id/tags/:tagId` | 改名/改色 `{name?,color?}`（同层级唯一，「未分类」锁定） / 删除（「未分类」与被引用 tag、以及副 tag 被引用的父 tag 409 保护） |
| POST | `/ledgers/:id/expenses` | 记一笔（见下） |
| GET | `/ledgers/:id/expenses?from&to&type` | 时间窗列表（含 tag 明细） |
| GET/PUT/DELETE | `/ledgers/:id/expenses/:eid` | 单笔 / 编辑 / 删除（单笔操作账本内校验，跨账本 404） |
| GET | `/ledgers/:id/stats?from&to&type` | 聚合视图 |

记一笔与编辑共用请求体（D-10：PUT = 全量替换）：
```json
{ "type": "expense", "amountCents": 4560, "date": "2026-06-07", "note": "撸串",
  "primary": { "category": "餐饮", "context": "和朋友" },
  "tags": ["夜宵"] }
```
- `tags` 是副 tag 列表（元素可为 id 或名称），必须挂在**本笔某个主 tag** 下（S6-v3）；用数字 id 可避开重名歧义。
- PUT 语义：金额/日期/类型/备注/主副 tag **一次重写**（旧关联清空），单事务回滚；校验同记一笔（账本内 tag、副 tag 归属）。
- 响应花销含 `tags[]`（role primary/secondary、dim_key、is_unnamed）。

统计响应（图谱/星轨数据源）：
```json
{ "totals": { "expense": 4560, "income": 0 },
  "byDimension": { "category": [{ "tag_id":1,"name":"餐饮","amount_cents":4560 }], "context": [...] },
  "monthly": [{ "month":"2026-06","type":"expense","amount_cents":4560 }],
  "daily": [...] }
```

## MCP Server（2026-07-28 协议，S4）

同进程同端口挂载：`POST http://localhost:5310/mcp`（Express 内 toNodeHandler 包装，与 REST 共享 services 注入）。

- **协议**：MCP 2026-07-28（stateless core）——官方 TS SDK v2 `@modelcontextprotocol/server@2.0.0`（zod v4 描述工具入参）；`legacy: 'stateless'` 亦兼容 2025-era 客户端。
- **实现**：`server/src/mcp/`——`orbitMcpServer.js`（工厂注册工具）+ `index.js`（createMcpHandler → toNodeHandler）。
- **工具（7 个，复用 services 同一批规则）**：
  | 工具 | 说明 |
  |---|---|
  | `create_ledger` | 建账本（自动维度） |
  | `list_ledgers` | 账本列表 |
  | `list_dimensions` | 维度+tag 树 |
  | `create_tag` | 建 tag（可选 `parentTagId` 建副 tag） |
  | `add_expense` | 记一笔（Σ 守恒/缺省兜底/隔离经 service 生效，与 REST 同源） |
  | `get_stats` | 聚合视图 |
  | `export_ledger` | JSON 快照 |
- 错误：业务规则失败返回工具 `isError: true` + `[CODE] message`（如 `[REQUIRED_TAG] …`、`[TAG_NOT_FOUND] …`）。

## 错误格式

`{ "error": "CODE", "message": "中文说明" }`；HTTP 状态：400 参数、404 不存在、409 冲突、500 内部。BizError 由 api 层统一映射。

## 质量

- 测试：`npm test`（node:test 63 项：Σ 守恒/隔离/回滚/校验/编辑全量替换/tag 维护保护/维度扩展贯通/迁移机制（含 v3 表重建安全性）/导出快照/MCP 真实协议/聚合/API 全流程/错误映射/副 tag 归属校验）。
- schema 版本：当前 **v3**（v1 五表、v2 dimensions.required、v3 tags 两级化）。v3 走表重建流程，属 `foreignKeysOff` 类迁移。
- 金额守恒是记账正确性生死线，回归必查。

## 技术要点与取舍

- **node:sqlite**（Node ≥22.5 内置）替代 better-sqlite3：API 等价（同步/WAL/事务）、零原生编译、Electron 亦可用；如需切换只动 `db/database.js`。
- 迁移：`db/schema.js` 版本化迁移序列（只追加、不改已发布项）。表重建类迁移标记 `foreignKeysOff`——`migrate()` 在**事务外**临时关闭外键（PRAGMA 在事务内是 no-op），迁移内在提交前跑 `foreign_key_check` 兜底。
- 未来：Electron 主进程内嵌本服务（同进程/端口）；MCP Server 复用 services；多入口同一数据层。

## 相关

- Obsidian 需求基线（产品决策 D-01~D-08、正交多维度 §3）
- Obsidian 技术选型（分层架构、T-04/T-05）
