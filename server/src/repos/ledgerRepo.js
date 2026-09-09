// 账本数据访问（纯 SQL，无业务规则）
// @param {import('node:sqlite').DatabaseSync} db

export function createLedgerRepo(db) {
  return {
    list() {
      return db.prepare('SELECT id, name, created_at FROM ledgers ORDER BY id').all()
        .map(r => ({ ...r }));
    },
    byId(id) {
      const r = db.prepare('SELECT id, name, created_at FROM ledgers WHERE id = ?').get(id);
      return r ? { ...r } : null;
    },
    create(name) {
      const { lastInsertRowid } = db.prepare('INSERT INTO ledgers (name) VALUES (?)').run(name);
      return this.byId(Number(lastInsertRowid));
    },
    rename(id, name) {
      db.prepare('UPDATE ledgers SET name = ? WHERE id = ?').run(name, id);
      return this.byId(id);
    },
    remove(id) {
      db.prepare('DELETE FROM ledgers WHERE id = ?').run(id);
    },
  };
}
