// SQLite 连接（node:sqlite，同步 API —— 零原生编译，Electron/Node ≥22.5 可用）
// 崩溃安全三件套：WAL（读写不互斥、崩溃可恢复）+ foreign_keys + busy_timeout
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

/**
 * 在事务中执行 fn（同步），出错回滚并重抛。
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
