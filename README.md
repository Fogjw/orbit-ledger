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
| `electron/` | 桌面壳层 | 主进程内嵌同一个本地服务 + 窗口；仓库根 `package.json` 是应用清单（`npm start` / `npm run dist`） |
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

## 桌面端（Electron）

```bash
npm install        # 仓库根：装 Electron 与打包工具（国内可设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
npm start          # 起窗口：主进程内嵌同一个本地服务，与浏览器访问同一份数据
```

主进程把数据库放到**用户数据目录**（`%APPDATA%/Orbit 星账/orbit.db`）—— 安装后的 app 在只读的 asar 里，
不能沿开发路径写库；两处数据互不干扰。

窗口菜单（按 Alt 显示）：视图 → 重新载入（Ctrl+R）/ 强制重新载入（Ctrl+Shift+R）/ 开发者工具（F12）。

**关窗 ≠ 退出**：关掉窗口后进程继续驻留托盘，内嵌服务仍在监听（浏览器直连与 MCP 照常可用）；
右键托盘图标可以「显示主窗口」或「退出 Orbit 星账」——只有后者才真正结束进程。

## 打包成安装包（Windows）

```bash
npm run make:icon  # assets/icon.svg → assets/icon.png（用 Electron 自己光栅化，项目零图形依赖）
npm run dist       # electron-builder → release/Orbit-Setup-<版本>.exe
```

安装向导里有**两处可选路径**：安装目录，以及紧接着一页的**账本数据目录**（默认 `%APPDATA%\Orbit 星账`）。
数据目录选择结果写入 `%APPDATA%\Orbit 星账\data-path.txt`，主进程启动时读取；
换目录不会自动搬走旧数据 —— 把旧的 `orbit.db` 复制过去即可。安装包还会自动创建
**桌面与开始菜单快捷方式**，并在注册表留下卸载入口。`npm run pack` 只产目录不产安装包。

打包会下载 Electron 二进制与 NSIS，受限网络下同样靠镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## 备份与恢复

账本下拉菜单 →「⇩ 导出备份」下载该账本的全量 JSON 快照（`orbit-ledger-backup` v1：账本/维度/tag/花销/关联五表扁平结构）；
「⇧ 导入备份」把快照回读为**一个新账本**——不覆盖、不合并，主键全部重新分配，对现有数据零影响。

## 状态

- 后端：记账事务 / 正交双维度 / 两级 tag（主→副）/ 统计聚合 / 导出导入 / MCP —— 全部落地并测试锁定。
- 前端：L1 星图、星轨三档吸附与画布平移、L3 下钻二部图、记账与 tag 管理、浏览器前进后退导航视图 —— 全链路接真实 REST。
- 桌面：Electron 壳层（主进程内嵌服务）。
