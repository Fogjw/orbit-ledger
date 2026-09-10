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

    /**
     * 月份序列（YYYY-MM → 金额）。
     * 附带 top_name / top_color = 该月该 type 下金额最大的指定维度 primary tag，
     * 供星轨「颜色 = 该月花销最大 tag 色」上色（需求基线 §5.2）。
     * @param {string} [topDimKey='category'] 取哪个维度的 tag 作为主导色
     */
    monthlySeries(ledgerId, { from = null, to = null, type = null, topDimKey = 'category' } = {}) {
      const args = [ledgerId];
      let where = ' WHERE e.ledger_id = ?';
      if (from) { where += ' AND e.date >= ?'; args.push(from); }
      if (to) { where += ' AND e.date <= ?'; args.push(to); }
      if (type) { where += ' AND e.type = ?'; args.push(type); }
      const sql = `
        SELECT m.month, m.type, m.amount_cents, top.name AS top_name, top.color AS top_color
        FROM (
          SELECT substr(e.date, 1, 7) AS month, e.type, SUM(e.amount_cents) AS amount_cents
          FROM expenses e${where}
          GROUP BY month, e.type
        ) m
        LEFT JOIN (
          SELECT month, type, name, color FROM (
            SELECT substr(e2.date, 1, 7) AS month, e2.type AS type, t.name AS name, t.color AS color,
                   ROW_NUMBER() OVER (
                     PARTITION BY substr(e2.date, 1, 7), e2.type
                     ORDER BY SUM(e2.amount_cents) DESC, t.id
                   ) AS rn
            FROM expenses e2
            JOIN expense_tag_links l2 ON l2.expense_id = e2.id AND l2.role = 'primary'
            JOIN tags t ON t.id = l2.tag_id
            JOIN dimensions d2 ON d2.id = t.dimension_id
            WHERE e2.ledger_id = ? AND d2.key = ?
            GROUP BY month, e2.type, t.id
          ) WHERE rn = 1
        ) top ON top.month = m.month AND top.type = m.type
        ORDER BY m.month`;
      return plainAll(db.prepare(sql).all(...args, ledgerId, topDimKey));
    },

    /**
     * 每日序列（date → 金额），日粒度视图/星轨日节点。
     * 同样附带 top_name / top_color（该日该 type 的金额最大 tag）。
     */
    dailySeries(ledgerId, { from = null, to = null, type = null, topDimKey = 'category' } = {}) {
      const args = [ledgerId];
      let where = ' WHERE e.ledger_id = ?';
      if (from) { where += ' AND e.date >= ?'; args.push(from); }
      if (to) { where += ' AND e.date <= ?'; args.push(to); }
      if (type) { where += ' AND e.type = ?'; args.push(type); }
      const sql = `
        SELECT d.date, d.type, d.amount_cents, top.name AS top_name, top.color AS top_color
        FROM (
          SELECT e.date AS date, e.type AS type, SUM(e.amount_cents) AS amount_cents
          FROM expenses e${where}
          GROUP BY e.date, e.type
        ) d
        LEFT JOIN (
          SELECT date, type, name, color FROM (
            SELECT e2.date AS date, e2.type AS type, t.name AS name, t.color AS color,
                   ROW_NUMBER() OVER (
                     PARTITION BY e2.date, e2.type
                     ORDER BY SUM(e2.amount_cents) DESC, t.id
                   ) AS rn
            FROM expenses e2
            JOIN expense_tag_links l2 ON l2.expense_id = e2.id AND l2.role = 'primary'
            JOIN tags t ON t.id = l2.tag_id
            JOIN dimensions d2 ON d2.id = t.dimension_id
            WHERE e2.ledger_id = ? AND d2.key = ?
            GROUP BY e2.date, e2.type, t.id
          ) WHERE rn = 1
        ) top ON top.date = d.date AND top.type = d.type
        ORDER BY d.date`;
      return plainAll(db.prepare(sql).all(...args, ledgerId, topDimKey));
    },
  };
}
