// 服务入口：初始化 DB → 组装 services → 挂载 API → 监听本地端口
// 形态：本地优先业务服务（未来 Electron 主进程内嵌；浏览器/CORS 直连；MCP 同进程）
import { openDatabase } from './db/database.js';
import { migrate } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { createLedgerService } from './services/ledgerService.js';
import { createTagService } from './services/tagService.js';
import { createExpenseService } from './services/expenseService.js';
import { createReportService } from './services/reportService.js';
import { createApp } from './api/app.js';
import { config } from './config.js';

// 数据层
const db = openDatabase(config.dbPath);
migrate(db);
const { seeded } = seedIfEmpty(db);
if (seeded) console.log('[seed] 已注入开发种子数据（生活费账本 + 品类/情境维度）');

// 组装 services + HTTP
const svc = {
  ledgers: createLedgerService(db),
  tags: createTagService(db),
  expenses: createExpenseService(db),
  reports: createReportService(db),
};
const app = createApp(svc);

const server = app.listen(config.port, () => {
  console.log(`[server] Orbit 业务服务 → http://localhost:${config.port}  (db: ${config.dbPath})`);
});

// 优雅退出（未来 Electron 由主进程统一管理生命周期）
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[server] 收到 ${sig}，关闭…`);
    server.close(() => process.exit(0));
  });
}
