# Orbit 星账 · 业务逻辑层架构

> 对齐 Obsidian 需求基线（`10-项目/账单图谱/账单图谱-需求基线.md`）与技术选型文档的分层架构。
> 本文件描述 `server/`（业务逻辑层）；前端由 demo-star/ 等其他 Agent 负责。

## 分工

```
orbit-ledger/
├─ server/       ★ 业务逻辑层（本仓库后端）：数据 + 业务规则 + REST API
├─ demo-star/    前端视觉 Demo（其他 Agent，纯静态，当前不接后端）
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
| `tags` | 维度取值 | 每维一「未标注」（is_unnamed=1，产品层弱化）；颜色可选覆盖 |
| `expenses` | 花销事实表 | type expense/income；**amount_cents 分存储**；date YYYY-MM-DD |
| `expense_tag_links` | 花销↔tag | role primary/secondary；每维一个 primary + N 个 secondary |

**核心不变量（D-03）**：每笔花销每维恰好一个 primary ⇒ 每维 Σ = 总额（未标注参与求和）。统计按 type 过滤。

## 业务规则（services 层）

- **记账 = 单事务**（`expenseService.add`）：写 expense + 全部 primary + secondary；任一步失败整体回滚（测试锁定）。
- 品类 primary 必填（CATEGORY_REQUIRED）；情境等可选维缺省 → 该维「未标注」。
- 全部 tag 必须属于同一账本（隔离，防跨账本关联）。
- 副 tag 按名解析遇跨维重名 → 要求用 id（TAG_AMBIGUOUS）。
- 金额正整数（分）；日期 YYYY-MM-DD（schema CHECK + service 双保险）。
- 建账本自动初始化默认维度（品类 6 + 情境 4 及「未标注」）。

## REST API 契约

Base: `http://localhost:5310/api`（端口 env `ORBIT_PORT` 覆盖）。CORS 放开（本地浏览器直连）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活 |
| GET/POST | `/ledgers` | 账本列表 / 建账本 `{name}`（自动维度） |
| GET | `/ledgers/:id` | 账本 |
| GET | `/ledgers/:id/dimensions` | 维度+tag 树（录入下拉/图谱源） |
| PATCH/DELETE | `/ledgers/:id` | 改名 `{name}` / 删除 |
| POST | `/ledgers/:id/tags` | 建 tag `{dimensionKey,name,color}` |
| POST | `/ledgers/:id/expenses` | 记一笔（见下） |
| GET | `/ledgers/:id/expenses?from&to&type` | 时间窗列表（含 tag 明细） |
| GET/DELETE | `/ledgers/:id/expenses/:eid` | 单笔 |
| GET | `/ledgers/:id/stats?from&to&type` | 聚合视图 |

记一笔请求体：
```json
{ "type": "expense", "amountCents": 4560, "date": "2026-06-07", "note": "撸串",
  "primary": { "category": "餐饮", "context": "和朋友" },
  "tags": ["夜宵"] }
```
响应花销含 `tags[]`（role primary/secondary、dim_key、is_unnamed）。

统计响应（图谱/星轨数据源）：
```json
{ "totals": { "expense": 4560, "income": 0 },
  "byDimension": { "category": [{ "tag_id":1,"name":"餐饮","amount_cents":4560 }], "context": [...] },
  "monthly": [{ "month":"2026-06","type":"expense","amount_cents":4560 }],
  "daily": [...] }
```

## 错误格式

`{ "error": "CODE", "message": "中文说明" }`；HTTP 状态：400 参数、404 不存在、409 冲突、500 内部。BizError 由 api 层统一映射。

## 质量

- 测试：`npm test`（node:test 12 项：Σ 守恒/隔离/回滚/校验/聚合/API 全流程/错误映射）。
- 金额守恒是记账正确性生死线，回归必查。

## 技术要点与取舍

- **node:sqlite**（Node ≥22.5 内置）替代 better-sqlite3：API 等价（同步/WAL/事务）、零原生编译、Electron 亦可用；如需切换只动 `db/database.js`。
- 迁移：`db/schema.js` 幂等 DDL；未来 schema 演进在此追加迁移序列。
- 未来：Electron 主进程内嵌本服务（同进程/端口）；MCP Server 复用 services；多入口同一数据层。

## 相关

- Obsidian 需求基线（产品决策 D-01~D-08、正交多维度 §3）
- Obsidian 技术选型（分层架构、T-04/T-05）
