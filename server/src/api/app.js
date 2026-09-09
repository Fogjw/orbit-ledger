// Express 应用组装：CORS(localhost 放开) + json + 路由 + MCP + 404 + 错误映射
import express from 'express';
import { BizError } from '../services/ledgerService.js';
import { ledgersRouter } from './routes/ledgers.js';
import { expensesRouter } from './routes/expenses.js';
import { statsRouter } from './routes/stats.js';
import { createMcpMiddleware } from '../mcp/index.js';

/**
 * 组装应用。services 由外部注入（便于测试替换）。
 * @param {{ ledgers, expenses, tags, reports, exports }} svc
 */
export function createApp(svc) {
  const app = express();
  app.disable('x-powered-by');

  // 本地服务：浏览器免登录直连（CORS 放开；正式收敛为 localhost 白名单）
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/ledgers', ledgersRouter(svc));
  app.use('/api/ledgers/:ledgerId', statsRouter(svc));          // .../stats
  app.use('/api/ledgers/:ledgerId/expenses', expensesRouter(svc)); // .../expenses

  // MCP（2026-07-28 stateless）——同进程同端口，复用同一 services
  const mcp = createMcpMiddleware(svc);
  app.post('/mcp', (req, res) => mcp(req, res, req.body));

  // 404
  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', message: `无此端点: ${req.method} ${req.path}` }));

  // 错误映射：BizError → 状态码；其余 → 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BizError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    console.error('[api]', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message ?? err) });
  });

  return app;
}
