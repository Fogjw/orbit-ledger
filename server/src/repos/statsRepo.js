// 聚合统计数据访问 —— 图谱/星轨视图的数据来源
// 关键不变量（D-03 正交多维度）：每个维度内 Σ tag 金额 = 总额（未标注也参与求和）

export function createStatsRepo(db) {
  const plainAll = (rs) => rs.map(r => ({ ...r }));

  return {
    /**
     * 某维度下各 tag 的金额汇总（时间窗内）。
     * 关联主链路：expenses → 该维 primary link → tag。
     * @param {number} ledgerId
     * @param {string} dimKey 维度 key（'category' | 'context' …）
     * @param {{from?: string, to?: string, type?: 'expense'|'income'|null}} win
     * @returns {{tag_id, name, is_unnamed, amount_cents}[]}
     */
    tagSums(ledgerId, dimKey, win = {}) {
      let sql = `
        SELECT t.id AS tag_id, t.name, t.is_unnamed, SUM(e.amount_cents) AS amount_cents
        FROM expenses e
        JOIN expense_tag_links l ON l.expense_id = e.id AND l.role = 'primary'
        JOIN tags t ON t.id = l.tag_id
        JOIN dimensions d ON d.id = t.dimension_id
        WHERE e.ledger_id = ? AND d.key = ?`;
      const args = [ledgerId, dimKey];
      if (win.from) { sql += ' AND e.date >= ?'; args.push(win.from); }
      if (win.to) { sql += ' AND e.date <= ?'; args.push(win.to); }
      if (win.type) { sql += ' AND e.type = ?'; args.push(win.type); }
      sql += ' GROUP BY t.id ORDER BY amount_cents DESC';
      return plainAll(db.prepare(sql).all(...args));
    },

    /** 时间窗总金额（按 type 分组） */
    totals(ledgerId, { from = null, to = null } = {}) {
      let sql = 'SELECT type, SUM(amount_cents) AS amount_cents FROM expenses WHERE ledger_id = ?';
      const args = [ledgerId];
      if (from) { sql += ' AND date >= ?'; args.push(from); }
      if (to) { sql += ' AND date <= ?'; args.push(to); }
      sql += ' GROUP BY type';
      const rows = plainAll(db.prepare(sql).all(...args));
      const out = { expense: 0, income: 0 };
      for (const r of rows) out[r.type] = r.amount_cents;
      return out;
    },

    /** 月份序列（YYYY-MM → 金额），粒度日/月/年切换的数据基础 */
    monthlySeries(ledgerId, { from = null, to = null, type = null } = {}) {
      let sql = `
        SELECT substr(e.date, 1, 7) AS month, e.type, SUM(e.amount_cents) AS amount_cents
        FROM expenses e WHERE e.ledger_id = ?`;
      const args = [ledgerId];
      if (from) { sql += ' AND e.date >= ?'; args.push(from); }
      if (to) { sql += ' AND e.date <= ?'; args.push(to); }
      if (type) { sql += ' AND e.type = ?'; args.push(type); }
      sql += ' GROUP BY month, e.type ORDER BY month';
      return plainAll(db.prepare(sql).all(...args));
    },

    /** 每日序列（date → 金额），日粒度视图/星轨日节点 */
    dailySeries(ledgerId, { from = null, to = null, type = null } = {}) {
      let sql = `
        SELECT e.date, e.type, SUM(e.amount_cents) AS amount_cents
        FROM expenses e WHERE e.ledger_id = ?`;
      const args = [ledgerId];
      if (from) { sql += ' AND e.date >= ?'; args.push(from); }
      if (to) { sql += ' AND e.date <= ?'; args.push(to); }
      if (type) { sql += ' AND e.type = ?'; args.push(type); }
      sql += ' GROUP BY e.date, e.type ORDER BY e.date';
      return plainAll(db.prepare(sql).all(...args));
    },
  };
}
