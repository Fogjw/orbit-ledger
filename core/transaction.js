// 事务边界（纯 SQL，不含任何 Node 专有 API）
// 为什么从 server 的 db/database.js 抽出来：**打开数据库**是驱动的事
// （Node 用 node:sqlite、浏览器用 sql.js），而**开事务**是业务层的事 ——
// 两边都只需要 db.exec 这三条语句，所以它属于共享 core，不属于任何一侧的驱动。
/**
 * 在事务中执行 fn（同步），出错回滚并重抛。
 * @param {{ exec: (sql: string) => unknown }} db
 * @param {() => T} fn
 * @returns {T}
 * @template T
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
