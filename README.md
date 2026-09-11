# Orbit（星账）

> ⚠️ **暂不支持移动设备访问。** 界面按桌面宽屏设计（左侧面板在窄屏下会收起、星轨的拖拽与滚轮
> 交互也依赖鼠标），手机上体验不完整 —— 移动端适配不在当前计划内。请用桌面浏览器或桌面端。

> **每一笔支出都是一颗流星。**
> 它划过某一天、某一月、某一年，留下一道轨迹 —— Orbit 把这些轨迹连成星轨（Orbit 就是「轨道」）。
> 于是「钱花在哪了」不再是一串数字，而是一片能一眼看清的夜空。
> 偶尔有几颗反向划过的星，那是收入。

**[在线试用](https://fogjw.github.io/orbit-ledger/)** —— 纯前端版：打开即用，数据存在你自己那台设备上，不上传

![Orbit 星账 · 主视图](docs/screenshots/overview.png)

图谱化账单软件：用关系图谱替代流水账/扇形图，花销与分类构成二部图，节点大小编码金额，让"钱花在哪、钱之间有什么关联"一眼可见。

- **产品名**：Orbit（中文「星账」）——星轨（Orbit）是产品视觉核心
- **定位**：本地优先（Local-First）个人记账；Electron 桌面端 + 浏览器直连 + MCP（同进程同端口）
- **架构与接口**：[docs/architecture.md](docs/architecture.md) —— 分层、数据模型、业务规则与 REST / MCP 契约

## 界面预览

主视图：中间是花销星图（面积编码金额），底部星轨按日 / 月 / 年三档浏览，左侧是当月洞察。

| 记一笔 | 账本与备份 |
|---|---|
| ![记一笔](docs/screenshots/entry.png) | ![账本下拉](docs/screenshots/ledger-menu.png) |

下钻到某个品类：外环是细分、内环是每一笔花销，被同一笔账单挂上的细分之间连虚线「共享线」。

![分类下钻二部图](docs/screenshots/detail.png)

> 以上截图由 `npm run shots` 生成（Electron 自己渲染并截屏，尺寸与等待时机都可复现，
> 截图前还会自检界面状态，避免拍到没打开或加载中的帧）。

## 结构

| 目录 | 归属 | 说明 |
|---|---|---|
| `core/` | 共享业务层 | 业务规则 + SQL（纯 JS，不依赖 Node）—— **桌面端与纯前端版共用同一份** |
| `server/` | 服务端 | HTTP + MCP + node:sqlite 驱动，引用 `core/`。**详见 [docs/architecture.md](docs/architecture.md)** |
| `web/` | 界面 | 零依赖 Canvas2D 星图 + 星轨 + 玻璃 UI；数据来源由注入的 `OrbitAPI` 决定 |
| `webapp/` | 纯前端版 | 浏览器里跑 SQLite + 本地数据存储，构建成静态站点 |
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

## 纯前端版（浏览器直连本地数据）

不装任何东西、也不用在本地跑服务：打开一个网址就能记账，**数据存在访问它的那台设备上**。
网页只负责业务规则与呈现（SQLite 跑在浏览器里），服务端不留任何账目。

```bash
npm run build:web    # 产出纯静态站点到 webapp/dist/（可直接托管）
npm run verify:web   # 端到端验证：起静态服务 + 用 Electron 当浏览器跑一遍并截图
```

- **数据存哪**：首次打开会让你选一个目录，账本写成该目录里的 `orbit.db` —— 真实文件，
  可备份、可拷到别的设备；句柄记在浏览器里，下次不用重选。
- **浏览器支持**：直接读写本地文件依赖 File System Access API，目前只有 Chrome / Edge 支持；
  其他浏览器自动降级为浏览器内部存储（IndexedDB），**清站点数据会丢**，所以要定期导出备份。
- **两种形态的关系**：业务规则（`core/`）与界面（`web/`）完全共用，差别只在数据来源 ——
  桌面端走本地服务（带 MCP），纯前端版直接跑在浏览器里（无服务端、无 MCP）。
- **在线试用**：<https://fogjw.github.io/orbit-ledger/>（GitHub Pages，由 `.github/workflows/pages.yml` 自动构建部署）
- **部署**：产物是纯静态的，GitHub Pages、Cloudflare Pages、Vercel 或任意静态服务器都能托管。
  Pages 会挂在 `/<仓库名>/` 子路径下 —— 构建产物里的引用全是相对的，所以子路径部署不需要改任何配置。
  唯一的前提：首次启用 Pages 必须由仓库主人在 Settings → Pages 把 Source 设为 GitHub Actions，
  这一步**无法由 workflow 代办**（`GITHUB_TOKEN` 拿不到创建 Pages 站点的权限，会被拒为
  `Resource not accessible by integration`）。

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
- 前端：L1 星图、星轨四档吸附与画布平移、L3 下钻二部图、记账与 tag 管理、浏览器前进后退导航视图 —— 全链路接真实 REST。
- 桌面：Electron 壳层（主进程内嵌服务）。

## 界面要点

几个容易被误读的地方，先说清楚：

**左侧洞察面板**同时给出三个数，各自带文字标签——大字是**结余**（收入 − 支出，为负时转红），
下面两行是**支出**与**收入**。数字口径都跟着当前时间窗走（日档是那一天，年档/「全部」是那一段）。
「N 天有记录」指的是**有账的天数**，不是笔数。

**星轨**（底部时间轴）有四档：**日 → 月 → 年 → 全部**。右侧刻度轨拖到最底那一档是「全部」，
表示从第一笔账到今天的整段时间。相邻节点之间的空档有上限（三分之一视口），
所以补记很久以前的账不会把画面拉散；拖到尽头时端点节点正好停在视口中心。

**收入与支出共用「品类」维度**，靠名字的「收入」前缀区分，渲染成绿色四角星。
每个维度每笔都有归属：没选时支出的缺省是「未分类」、收入的缺省是「收入·未分类」，
两者分开收纳。收入同样参与情境维度。

## 持续集成与发布

- **CI**（`.github/workflows/ci.yml`）：push / PR 触发 —— 后端全量回归（`server && npm test`）+ 前端与壳层脚本语法检查。
- **Release**（`.github/workflows/release.yml`）：推 `v*` 标签触发 —— Windows runner 上打包 NSIS 安装包，
  上传构建产物并自动创建带安装包的 Release；也可在 Actions 页面手动触发，只验证打包链路。

发版流程（版本号写在仓库根 `package.json`，workflow 会校验 tag 与它一致）：

```bash
npm version 1.0.1 --no-git-tag-version   # 或直接手改 package.json 的 version
git add package.json && git commit -m "chore: 发布 1.0.1"
git tag v1.0.1
git push origin main --tags
```

## 本地验收脚本

除单元测试外，还有两个端到端脚本，都是**真的把程序跑起来、走真实 UI 路径**再断言，不看截图：

```bash
npm run verify:web       # 纯前端版：引导层→浏览器存储→界面记账→星轨/星图/面板/标签管理的各项判据
npm run verify:upgrade   # 覆盖更新：装两次，验证注册表只留一份、数据目录不被重置、账本文件不丢
```

`verify:upgrade` 会真的安装/覆盖安装/卸载它自己造的两个目录，跑完自行清理；
若本机已装过 Orbit，它会把既有的安装记录临时挪开（`reg export` → `reg delete` → 跑完 `reg import`），
不会动你真实的安装与账本。

