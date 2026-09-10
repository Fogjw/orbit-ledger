// 服务入口：装配 + 监听（装配逻辑见 bootstrap.js，Electron 主进程复用同一入口）
// 形态：本地优先业务服务 —— 浏览器/CORS 直连、MCP 同进程、Electron 主进程内嵌。
import { startServer } from './bootstrap.js';

const { port, runtime, close } = await startServer();

console.log(`[server] Orbit 业务服务 → http://localhost:${port}  (db: ${runtime.dbPath})`);
console.log(`[server] 前端 → http://localhost:${port}/ （web/；API → /api；MCP → /mcp）`);
if (runtime.seeded) console.log('[seed] 已注入开发种子数据（生活费账本 + 品类/情境维度）');

// 优雅退出（Electron 由主进程统一管理生命周期，见 electron/main.js）
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n[server] 收到 ${sig}，关闭…`);
    await close();
    process.exit(0);
  });
}
