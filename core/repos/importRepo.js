// 导入回读数据访问（纯 SQL，无业务规则）——exportRepo 的对称面
// 只做「按原字段重建行」：主键一律由数据库重新分配，快照里的旧主键仅用于
// 快照内部相互引用，映射关系由 importService 负责。
// created_at 用 COALESCE 兜底：快照缺该列时回落到表默认值，不写 NULL（NOT NULL 约束）。

export function createImportRepo(db) {
  return {
    /** @returns {number} 新账本 id */
    insertLedger(name, createdAt) {
      const { lastInsertRowid } = db.prepare(
        "INSERT INTO ledgers (name, created_at) VALUES (?, COALESCE(?, datetime('now')))"
      ).run(name, createdAt ?? null);
      return Number(lastInsertRowid);
    },

    /** @returns {number} 新维度 id */
    insertDimension(ledgerId, { key, name, position, required }) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO dimensions (ledger_id, key, name, position, required) VALUES (?, ?, ?, ?, ?)'
      ).run(ledgerId, key, name, position ?? 0, required ?? 0);
      return Number(lastInsertRowid);
    },

    /** @returns {number} 新 tag id（parentTagId 传 null 即主 tag） */
    insertTag(ledgerId, { dimensionId, name, isUnnamed, color, position, parentTagId }) {
      const { lastInsertRowid } = db.prepare(
        `INSERT INTO tags (ledger_id, dimension_id, name, is_unnamed, color, position, parent_tag_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(ledgerId, dimensionId, name, isUnnamed ?? 0, color ?? null, position ?? 0, parentTagId ?? null);
      return Number(lastInsertRowid);
    },

    /** @returns {number} 新花销 id */
    insertExpense(ledgerId, { type, amountCents, date, note, createdAt }) {
      const { lastInsertRowid } = db.prepare(
        `INSERT INTO expenses (ledger_id, type, amount_cents, date, note, created_at)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
      ).run(ledgerId, type ?? 'expense', amountCents, date, note ?? null, createdAt ?? null);
      return Number(lastInsertRowid);
    },

    insertLink(expenseId, tagId, role) {
      db.prepare('INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, ?)')
        .run(expenseId, tagId, role ?? 'secondary');
    },
  };
}
