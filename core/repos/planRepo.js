// 计划数据访问（纯 SQL，无业务规则）
// 计划 = 账本内的一段时间 + 预算；账单与计划多对多，余额按链接聚合。
export function createPlanRepo(db) {
  const plain = (r) => (r ? { ...r } : null);
  const plainAll = (rs) => rs.map(r => ({ ...r }));
  const COLS = 'id, ledger_id, name, budget_cents, start_date, end_date, position, created_at';
  // LEFT JOIN 保证「没有账单的计划」也返回一行 0（COUNT(e.id) = 0）
  const TOTALS = `
    SELECT p.id AS plan_id,
           COALESCE(SUM(CASE WHEN e.type = 'expense' THEN e.amount_cents ELSE 0 END), 0) AS spent_cents,
           COALESCE(SUM(CASE WHEN e.type = 'income'  THEN e.amount_cents ELSE 0 END), 0) AS income_cents,
           COUNT(e.id) AS bill_count
      FROM plans p
      LEFT JOIN expense_plan_links l ON l.plan_id = p.id
      LEFT JOIN expenses e ON e.id = l.expense_id
     WHERE p.ledger_id = ?`;

  return {
    list(ledgerId) {
      return plainAll(db.prepare(
        `SELECT ${COLS} FROM plans WHERE ledger_id = ? ORDER BY start_date, id`
      ).all(ledgerId));
    },

    byId(ledgerId, planId) {
      return plain(db.prepare(`SELECT ${COLS} FROM plans WHERE ledger_id = ? AND id = ?`).get(ledgerId, planId));
    },

    insert({ ledgerId, name, budgetCents, startDate, endDate }) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO plans (ledger_id, name, budget_cents, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
      ).run(ledgerId, name, budgetCents, startDate, endDate);
      return Number(lastInsertRowid);
    },

    update(planId, { name, budgetCents, startDate, endDate }) {
      db.prepare(
        'UPDATE plans SET name = ?, budget_cents = ?, start_date = ?, end_date = ? WHERE id = ?'
      ).run(name, budgetCents, startDate, endDate, planId);
    },

    remove(planId) {
      db.prepare('DELETE FROM plans WHERE id = ?').run(planId);
    },

    /** 全部计划的已用/入账/笔数（一次查询，避免总览 N+1） */
    totalsAll(ledgerId) {
      return plainAll(db.prepare(`${TOTALS} GROUP BY p.id`).all(ledgerId));
    },

    totalsOf(ledgerId, planId) {
      return plain(db.prepare(`${TOTALS} AND p.id = ? GROUP BY p.id`).get(ledgerId, planId));
    },

    plansOfExpense(expenseId) {
      return plainAll(db.prepare(
        `SELECT p.id, p.name FROM expense_plan_links l JOIN plans p ON p.id = l.plan_id
          WHERE l.expense_id = ? ORDER BY p.start_date, p.id`
      ).all(expenseId));
    },

    link(expenseId, planId) {
      db.prepare('INSERT OR IGNORE INTO expense_plan_links (expense_id, plan_id) VALUES (?, ?)').run(expenseId, planId);
    },

    unlinkAll(expenseId) {
      db.prepare('DELETE FROM expense_plan_links WHERE expense_id = ?').run(expenseId);
    },
  };
}
