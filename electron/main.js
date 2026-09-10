// Orbit 星账 · Electron 主进程
// 形态（技术选型 §2）：**主进程内嵌本地 HTTP 服务**，窗口只是它的一个客户端 ——
// 于是「浏览器直连」与「桌面窗口」天然共享同一份数据、同一套接口，不需要 IPC 桥。
import { app, BrowserWindow, dialog, shell } from 'electron';
import { startServer } from '../server/src/bootstrap.js';

let srv = null;   // startServer 的返回值（含 url / close）
let win = null;

async function boot() {
  // 首选默认端口；被占用（例如浏览器版服务已在跑）则退到系统分配端口 ——
  // 桌面端总能起来，而不是给用户一个「端口被占」的死局。
  try {
    srv = await startServer();
  } catch (err) {
    console.warn('[electron] 默认端口不可用，改用系统分配端口：', err?.message ?? err);
    srv = await startServer({ port: 0 });
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

  // 外链交给系统浏览器：本地应用里不该再开第二个 Chromium 窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
  await win.loadURL(srv.url);
  console.log(`[electron] 窗口已载入 ${srv.url}`);
}

app.whenReady()
  .then(boot)
  .catch((err) => {
    dialog.showErrorBox('Orbit 启动失败', String(err?.stack ?? err));
    app.quit();
  });

// 关掉最后一个窗口 = 退出应用：先收 HTTP 服务与数据库连接，再退出
app.on('window-all-closed', async () => {
  try { await srv?.close(); } catch { /* 已关闭 */ }
  srv = null;
  app.quit();
});
