// SQLite 连接（node:sqlite，同步 API —— 零原生编译，Electron/Node ≥22.5 可用）
// 崩溃安全三件套：WAL（读写不互斥、崩溃可恢复）+ foreign_keys + busy_timeout
// 注意：事务边界已移到 core/transaction.js（纯 SQL，浏览器驱动同样可用），
// 本文件只负责「打开连接」这件事 —— 它才是真正绑死 Node 的部分。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 保持既有 import 路径（`../db/database.js` 取 transaction）继续可用
export { transaction } from '../../../core/transaction.js';

/**
 * 打开（必要时创建）数据库，应用连接级 PRAGMA。
 * @param {string} file 数据库文件路径
 * @returns {DatabaseSync}
 */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}
