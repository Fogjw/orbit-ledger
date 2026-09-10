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

    /** 更新花销事实行（不动 ledger_id / created_at） */
    update(id, { type, amountCents, date, note }) {
      db.prepare(
        'UPDATE expenses SET type = ?, amount_cents = ?, date = ?, note = ? WHERE id = ?'
      ).run(type, amountCents, date, note ?? null, id);
    },

    // ---- tag 关联 ----
    linkTags(expenseId, links) {
      const stmt = db.prepare(
        'INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, ?)'
      );
      for (const { tagId, role } of links) stmt.run(expenseId, tagId, role);
    },

    /**
     * 整笔替换一笔花销的 tag 关联（编辑语义：全量重写）。
     * 调用方须在事务内：先清旧 links，再写新 links，任一步失败整体回滚。
     */
    replaceLinks(expenseId, links) {
      db.prepare('DELETE FROM expense_tag_links WHERE expense_id = ?').run(expenseId);
      this.linkTags(expenseId, links);
    },

    /**
     * 一笔花销的全部 tag（带维度 key 与名称）。
     * parent_tag_id 供前端把副 tag 归到它所属的主 tag 下（L3 分类内「花销×标签」视图）。
     */
    tagsOf(expenseId) {
      return plainAll(db.prepare(
        `SELECT l.role, l.tag_id, t.name, t.is_unnamed, t.parent_tag_id, d.key AS dim_key, d.name AS dim_name
         FROM expense_tag_links l
         JOIN tags t ON t.id = l.tag_id
         JOIN dimensions d ON d.id = t.dimension_id
         WHERE l.expense_id = ?
         ORDER BY l.role DESC, t.id`
      ).all(expenseId));
    },
  };
}
