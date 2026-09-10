# Orbit（星账）

图谱化账单软件：用关系图谱替代流水账/扇形图，花销与分类构成二部图，节点大小编码金额，让"钱花在哪、钱之间有什么关联"一眼可见。

- **产品名**：Orbit（中文「星账」）——星轨（Orbit）是产品视觉核心
- **定位**：本地优先（Local-First）个人记账；Electron 桌面端 + 浏览器直连 + MCP（同进程同端口）
- **需求与设计文档**：Obsidian 知识库 `pm` 库 `10-项目/账单图谱/`（需求基线、技术选型）

## 结构

| 目录 | 归属 | 说明 |
|---|---|---|
| `server/` | 业务逻辑层 | SQLite 数据层 + 业务规则 + REST + MCP（node:sqlite / Express / node:test）。**详见 [docs/architecture.md](docs/architecture.md)** |
| `web/` | 前端 | 零依赖 Canvas2D 星图 + 星轨 + 玻璃 UI；消费 `server/` 的 REST（同端口静态托管） |
| `electron/` | 桌面壳层 | 主进程内嵌同一个本地服务 + 窗口 |
| `docs/` | 文档 | `architecture.md`（REST/MCP 契约权威） |

## 运行

```bash
cd server
npm install
npm run dev        # http://localhost:5310（前端 / + REST /api + MCP /mcp）
npm test           # node:test 全量回归（Σ 守恒 / 账本隔离 / 事务回滚 / 导入导出 / API / MCP）
npm run seed:demo  # 生成式演示数据（固定种子、21 个月）
```

浏览器打开 http://localhost:5310 即用；数据落在 `server/data/orbit.db`。
验证实验请起独立实例（`ORBIT_PORT=5311 ORBIT_DB=<临时库>`），不要直接写演示库。

## 运行桌面端（Electron）

```bash
cd electron
npm install        # 首次下载 Electron 二进制；国内可设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm start
```

主进程内嵌同一个本地服务（`server/src/bootstrap.js`），窗口与浏览器访问**同一份数据**。

## 备份与恢复

账本下拉菜单 →「⇩ 导出备份」下载该账本的全量 JSON 快照（`orbit-ledger-backup` v1：账本/维度/tag/花销/关联五表扁平结构）；
「⇧ 导入备份」把快照回读为**一个新账本**——不覆盖、不合并，主键全部重新分配，对现有数据零影响。

## 状态

- 后端：记账事务 / 正交双维度 / 两级 tag（主→副）/ 统计聚合 / 导出导入 / MCP —— 全部落地并测试锁定。
- 前端：L1 星图、星轨三档吸附与画布平移、L3 下钻二部图、记账与 tag 管理、浏览器前进后退导航视图 —— 全链路接真实 REST。
- 桌面：Electron 壳层（主进程内嵌服务）。
