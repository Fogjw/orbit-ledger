// 花销数据访问（事实表 + tag 关联）
// date 格式 YYYY-MM-DD；时间窗 [from, to] 含端点

export function createExpenseRepo(db) {
  const plain = (r) => (r ? { ...r } : null);
  const plainAll = (rs) => rs.map(r => ({ ...r }));
  const COLS = 'id, ledger_id, type, amount_cents, date, note, created_at';

  return {
    insert({ ledgerId, type, amountCents, date, note }) {
      const { lastInsertRowid } = db.prepare(
        `INSERT INTO expenses (ledger_id, type, amount_cents, date, note) VALUES (?, ?, ?, ?, ?)`
      ).run(ledgerId, type, amountCents, date, note ?? null);
      return Number(lastInsertRowid);
    },

    /** 花销主键行 */
    byId(id) {
      return plain(db.prepare(`SELECT ${COLS} FROM expenses WHERE id = ?`).get(id));
    },

    /** 时间窗内花销（账本内，按日期倒序） */
    listByWindow(ledgerId, { from = null, to = null, type = null } = {}) {
      let sql = `SELECT ${COLS} FROM expenses WHERE ledger_id = ?`;
      const args = [ledgerId];
      if (from) { sql += ' AND date >= ?'; args.push(from); }
      if (to) { sql += ' AND date <= ?'; args.push(to); }
      if (type) { sql += ' AND type = ?'; args.push(type); }
      sql += ' ORDER BY date DESC, id DESC';
      return plainAll(db.prepare(sql).all(...args));
    },

    remove(id) {
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    },

    // ---- tag 关联 ----
    linkTags(expenseId, links) {
      const stmt = db.prepare(
        'INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, ?)'
      );
      for (const { tagId, role } of links) stmt.run(expenseId, tagId, role);
    },

    /** 一笔花销的全部 tag（带维度 key 与名称） */
    tagsOf(expenseId) {
      return plainAll(db.prepare(
        `SELECT l.role, l.tag_id, t.name, t.is_unnamed, d.key AS dim_key, d.name AS dim_name
         FROM expense_tag_links l
         JOIN tags t ON t.id = l.tag_id
         JOIN dimensions d ON d.id = t.dimension_id
         WHERE l.expense_id = ?
         ORDER BY l.role DESC, t.id`
      ).all(expenseId));
    },
  };
}
