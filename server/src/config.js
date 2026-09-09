// 服务配置：端口 / 数据库路径 / 前端静态目录（可用环境变量覆盖）
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const srcRoot = dirname(fileURLToPath(import.meta.url));

export const config = {
  // 本地服务端口（Electron 内嵌 / 浏览器直连 / MCP 同进程复用）
  port: Number(process.env.ORBIT_PORT || 5310),
  // SQLite 数据文件（本地优先，崩溃安全靠 WAL + 事务）
  dbPath: process.env.ORBIT_DB || join(srcRoot, '../data/orbit.db'),
  // 前端静态目录（web/，本地 http://localhost:5310/ 即开；file:// 双击亦可，CORS 已放开）
  webDir: process.env.ORBIT_WEB || join(srcRoot, '../../web'),
};
