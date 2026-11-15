// 导出快照数据访问（纯 SQL，无业务规则）——账本全量扁平读取
// 用于备份导出（D-13）；行保留原始主键/外键，import 时可逐表回插重建

export function createExportRepo(db) {
  const plain = (r) => (r ? { ...r } : null);
  const plainAll = (rs) => rs.map(r => ({ ...r }));

  return {
    /**
     * 账本全量快照：账本单行 + 七表扁平行（含计划）。
     * expense_tag_links / expense_plan_links 无 ledger_id 列，须 join expenses 按账本过滤。
     * @param {number} ledgerId
     * @returns {null | {ledger: object, dimensions: object[], tags: object[],
     *   expenses: object[], expense_tag_links: object[], plans: object[],
     *   expense_plan_links: object[]}}
     */
    snapshot(ledgerId) {
      const ledger = plain(db.prepare('SELECT id, name, created_at FROM ledgers WHERE id = ?').get(ledgerId));
      if (!ledger) return null;
      const dimensions = plainAll(db.prepare(
        'SELECT id, ledger_id, key, name, position, required FROM dimensions WHERE ledger_id = ? ORDER BY position, id'
      ).all(ledgerId));
      const tags = plainAll(db.prepare(
        'SELECT id, ledger_id, dimension_id, name, is_unnamed, color, position, parent_tag_id FROM tags WHERE ledger_id = ? ORDER BY position, id'
      ).all(ledgerId));
      const expenses = plainAll(db.prepare(
        'SELECT id, ledger_id, type, amount_cents, date, note, created_at FROM expenses WHERE ledger_id = ? ORDER BY date, id'
      ).all(ledgerId));
      const expense_tag_links = plainAll(db.prepare(
        `SELECT l.expense_id, l.tag_id, l.role
         FROM expense_tag_links l
         JOIN expenses e ON e.id = l.expense_id
         WHERE e.ledger_id = ?
         ORDER BY l.expense_id, l.role, l.tag_id`
      ).all(ledgerId));
      const plans = plainAll(db.prepare(
        `SELECT id, ledger_id, name, budget_cents, start_date, end_date, position, created_at
           FROM plans WHERE ledger_id = ? ORDER BY start_date, id`
      ).all(ledgerId));
      const expense_plan_links = plainAll(db.prepare(
        `SELECT l.expense_id, l.plan_id
           FROM expense_plan_links l
           JOIN expenses e ON e.id = l.expense_id
          WHERE e.ledger_id = ?
          ORDER BY l.expense_id, l.plan_id`
      ).all(ledgerId));
      return { ledger, dimensions, tags, expenses, expense_tag_links, plans, expense_plan_links };
    },
  };
}
