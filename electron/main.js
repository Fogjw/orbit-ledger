// Orbit 星账 · Electron 主进程
// 形态（技术选型 §2）：**主进程内嵌本地 HTTP 服务**，窗口只是它的一个客户端 ——
// 于是「浏览器直连」与「桌面窗口」天然共享同一份数据、同一套接口，不需要 IPC 桥。
// 生命周期：**关窗 ≠ 退出**（服务要继续对外提供 REST / MCP），退出统一走托盘菜单。
import { app, BrowserWindow, dialog, Menu, shell, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { startServer } from '../server/src/bootstrap.js';

let srv = null;      // startServer 的返回值（含 url / close）
let win = null;
let tray = null;
let trayAvailable = false; // 托盘是否可用：Linux 无 StatusNotifier 时关窗必须退出，否则进程没有入口
let quitting = false; // true 时 close 不再拦截，窗口真正关闭并退出进程

/**
 * 读取安装器写下的数据目录配置（Windows 安装器写在 `%APPDATA%/Orbit 星账/data-path.txt`）。
 * Linux 没有安装器，这个文件通常不存在，于是回退到 Electron 的 userData
 * （`~/.config/Orbit 星账`）。兼容三种编码：带 BOM 的 UTF-16LE（当前安装器的写法）、UTF-8、
 * 以及早期用系统 ANSI 写出的旧文件（中文 Windows 下即 GBK）—— 编码猜错的代价是凭空建出
 * 一个乱码目录并写库进去，所以这里做一次嗅探而不是假定。返回空串表示「没配置过」。
 */
function readDataDirConfig(file) {
  let buf;
  try { buf = readFileSync(file); } catch { return ''; }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le').trim();
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8.trim();
  try { return new TextDecoder('gbk').decode(buf).trim(); } catch { return utf8.trim(); }
}

/**
 * 账本数据目录：安装程序允许用户自选，没配置过就用 Electron 默认的 userData。
 * 目录不存在时建出来 —— 用户可能选了一个全新路径。
 */
function dataDir() {
  const dir = readDataDirConfig(join(app.getPath('appData'), 'Orbit 星账', 'data-path.txt'));
  const target = dir || app.getPath('userData');
  mkdirSync(target, { recursive: true });
  return target;
}

function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * 应用菜单：窗口只是本地页面的壳，前端一改就得能立刻看到新版本，所以必须留重载入口。
 * autoHideMenuBar 下菜单栏默认藏起（按 Alt 显示），但快捷键始终生效。
 */
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '文件', submenu: [{ role: 'quit', label: '退出' }] },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', label: '强制重新载入（忽略缓存）', accelerator: 'CmdOrCtrl+Shift+R' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具（控制台）', accelerator: 'F12' },
      ],
    },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }] },
  ]);
}

/**
 * 托盘：关窗后进程仍在服务，必须有地方能唤回窗口、也必须有一个明确的「退出」。
 * Linux 的托盘依赖桌面环境的 StatusNotifier/AppIndicator；没有时返回 false，
 * 调用方据此把「关窗」降级成「退出」，避免留下一个看不见也找不到的常驻进程。
 */
function buildTray() {
  const iconPath = join(app.getAppPath(), 'assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.warn(`[electron] 托盘图标加载失败，关闭窗口将直接退出：${iconPath}`);
    return false;
  }
  try {
    tray = new Tray(icon);
  } catch (err) {
    console.warn('[electron] 当前桌面环境不支持系统托盘，关闭窗口将直接退出：', err?.message ?? err);
    tray = null;
    return false;
  }
  tray.setToolTip('Orbit 星账 · 服务运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWin },
    { type: 'separator' },
    {
      label: '退出 Orbit 星账',
      click: () => { quitting = true; app.quit(); },
    },
  ]));
  tray.on('click', showWin);
  tray.on('double-click', showWin);
  return true;
}

async function boot() {
  // 数据库落在用户数据目录：安装后 app 在只读 asar 里，沿开发路径写库会失败。
  // 首次启动这里是空库，服务会自动建默认账本与维度。
  const dir = dataDir();
  const dbPath = join(dir, 'orbit.db');
  console.log(`[electron] 账本数据目录：${dir}`);
  // 首选默认端口；被占用（例如浏览器版服务已在跑）则退到系统分配端口 ——
  // 桌面端总能起来，而不是给用户一个「端口被占」的死局。
  try {
    srv = await startServer({ dbPath });
  } catch (err) {
    console.warn('[electron] 默认端口不可用，改用系统分配端口：', err?.message ?? err);
    srv = await startServer({ dbPath, port: 0 });
  }

  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 960, minHeight: 660,
    backgroundColor: '#030510',
    title: 'Orbit 星账',
    autoHideMenuBar: true,
    webPreferences: {
      // 页面是本地静态前端，不需要任何 Node 能力：一律关闭 + 上下文隔离
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // 关窗 = 收到托盘（服务继续跑）；没有托盘时关窗必须退出，
  // 否则进程会留在后台却没有任何入口能再唤回窗口。
  win.on('close', (e) => {
    if (quitting || !trayAvailable) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => { win = null; });

  // 外链交给系统浏览器：本地应用里不该再开第二个 Chromium 窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(srv.url);
  trayAvailable = buildTray();
  console.log(
    trayAvailable
      ? `[electron] 窗口已载入 ${srv.url}（关窗不退出，可右键托盘图标退出）`
      : `[electron] 窗口已载入 ${srv.url}（无可用托盘，关窗即退出）`
  );
}

/**
 * 单实例锁：第二次双击（或从快捷方式再启动）不该再拉一个进程出来 ——
 * 那样会有两个内嵌服务抢同一个数据库、两个托盘图标。这里让后来的实例直接退出，
 * 由已有实例把窗口唤到前台。
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showWin(); });
  app.whenReady()
    .then(() => { Menu.setApplicationMenu(buildMenu()); return boot(); })
    .catch((err) => {
      dialog.showErrorBox('Orbit 启动失败', String(err?.stack ?? err));
      app.quit();
    });
}

// 有托盘时关窗只是收起（内嵌服务还在监听）；没有托盘时窗口没了就没有入口，直接退出
app.on('window-all-closed', () => {
  if (!trayAvailable) app.quit();
});

// 真正退出前先把 HTTP 服务与数据库连接收干净，再放行退出
app.on('before-quit', (e) => {
  if (!srv) return;
  e.preventDefault();
  quitting = true;
  const closing = srv;
  srv = null;
  closing.close().catch(() => {}).finally(() => app.quit());
});
