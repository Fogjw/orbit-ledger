# Orbit（星账）

图谱化账单软件：用关系图谱替代流水账/扇形图，花销与分类构成二部图，节点大小编码金额，让"钱花在哪、钱之间有什么关联"一眼可见。

- **产品名**：Orbit（中文「星账」）——星轨（Orbit）是产品视觉核心
- **定位**：本地优先（Local-First）个人记账；Electron 桌面端 + 浏览器直连 + 未来 MCP
- **需求与设计文档**：Obsidian 知识库 `pm` 库 `10-项目/账单图谱/`（需求基线、技术选型）

## 分工

| 目录 | 归属 | 说明 |
|---|---|---|
| `server/` | 业务逻辑层 | SQLite 数据层 + 业务规则 + REST API（node:sqlite / Express / node:test）。**详见 [docs/architecture.md](docs/architecture.md)** |
| `demo-star/` | 前端视觉 Demo | 纯静态（其他 Agent 负责），当前为编造数据不接后端 |

## 运行业务服务

```bash
cd server
npm install
npm run dev        # http://localhost:5310（api/health 探活；ORBIT_PORT/ORBIT_DB 可覆盖）
npm test           # node:test 12 项（Σ 守恒/隔离/回滚/API 全流程）
```

## 状态

业务逻辑层已搭骨架并跑通（schema / 记账事务 / 聚合 / REST / 测试）；前端由 demo-star 方向演进。
