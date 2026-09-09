// MCP 接入组装：McpServer 工厂 → createMcpHandler（stateless，2026-07-28）→ toNodeHandler（Express）
// 挂载路径 POST /mcp（同 Express 进程/端口；与 REST 同一 services 注入）
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createOrbitMcpServerFactory } from './orbitMcpServer.js';

/**
 * 生成 Express 请求处理器（(req, res) => Promise），挂到 app.post('/mcp')。
 * @param {object} svc 与 REST 相同的 services 注入
 */
export function createMcpMiddleware(svc) {
  const handler = createMcpHandler(createOrbitMcpServerFactory(svc), {
    legacy: 'stateless',   // 2025-era 客户端亦走 stateless fallback；2026-07-28 客户端走 per-request envelope
    onerror: (err) => console.error('[mcp]', err),
  });
  return toNodeHandler(handler);
}
