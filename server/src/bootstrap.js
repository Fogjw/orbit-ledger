// 运行时装配（可复用入口）：DB → 迁移 → 种子 → services → Express 应用
// 为什么单独一层：`index.js` 是**脚本**（启动即监听 + 信号处理），而 Electron 主进程
// 需要「同一个服务、同一份数据」但生命周期由宿主掌控（窗口关闭即收摊）。
// 把装配抽到这里，两条入口都复用它，服务行为与契约不会分叉。
import { openDatabase } from './db/database.js';
import { migrate } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { createLedgerService } from './services/ledgerService.js';
import { createTagService } from './services/tagService.js';
import { createExpenseService } from './services/expenseService.js';
import { createReportService } from './services/reportService.js';
import { createExportService } from './services/exportService.js';
import { createImportService } from './services/importService.js';
import { createApp } from './api/app.js';
import { config } from './config.js';

/**
 * 装配运行时：打开库、迁移、按需注入种子、组装 services 与 Express 应用。**不监听端口。**
 * @param {{ dbPath?: string, webDir?: string }} [opts] 缺省取 config（env 可覆盖）
 * @returns {{ db: object, svc: object, app: import('express').Express, dbPath: string,
 *   webDir: string, seeded: boolean, close: () => void }}
 */
export function createRuntime(opts = {}) {
  const dbPath = opts.dbPath ?? config.dbPath;
  const webDir = opts.webDir ?? config.webDir;

  const db = openDatabase(dbPath);
  migrate(db);
  const { seeded } = seedIfEmpty(db);

  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    reports: createReportService(db),
    exports: createExportService(db),
    imports: createImportService(db),
  };
  const app = createApp(svc, { webDir });

  return { db, svc, app, dbPath, webDir, seeded, close: () => db.close() };
}

/**
 * 装配并监听端口（`index.js` 与 Electron 主进程共用）。
 * 用 Promise 包住 listen：调用方 await 到「真的在监听了」再拿 URL，
 * 端口占用等错误也不会变成未捕获异常。
 * @param {{ dbPath?: string, webDir?: string, port?: number }} [opts] port 传 0 = 由系统分配
 * @returns {Promise<{ port: number, url: string, runtime: object,
 *   server: import('node:http').Server, close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const runtime = createRuntime(opts);
  const port = opts.port ?? config.port;
  const server = runtime.app.listen(port);

  await new Promise((resolve, reject) => {
    server.once('error', (err) => { try { runtime.close(); } catch { /* 已关闭 */ } reject(err); });
    server.once('listening', resolve);
  });

  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    runtime,
    server,
    /** 先停 HTTP 再关库：避免关闭瞬间仍有请求打到已关闭的连接 */
    close: () => new Promise((resolve) => {
      server.close(() => { try { runtime.close(); } catch { /* 已关闭 */ } resolve(); });
    }),
  };
}
