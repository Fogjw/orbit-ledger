// 路由：账本下花销（挂载于 /api/ledgers/:ledgerId/expenses）
import { Router } from 'express';
import { idOf, windowFrom, requireInt, requireStr, optStr } from '../validate.js';
import { BizError } from '../../services/ledgerService.js';

export function expensesRouter(svc) {
  const r = Router({ mergeParams: true });

  /** 记一笔 POST /api/ledgers/:ledgerId/expenses */
  r.post('/', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const body = req.body ?? {};
    const primary = body.primary ?? {};
    if (typeof primary !== 'object' || Array.isArray(primary)) {
      throw new BizError('primary 须为对象', 'INVALID_FIELD');
    }
    const expense = svc.expenses.add({
      ledgerId,
      type: body.type === 'income' ? 'income' : 'expense',
      amountCents: requireInt(body, 'amountCents', { min: 1 }),
      date: requireStr(body, 'date'),
      note: optStr(body, 'note'),
      primary,
      tags: Array.isArray(body.tags) ? body.tags : [],
    });
    res.status(201).json(expense);
  });

  /** 时间窗列表 GET ?from&to&type */
  r.get('/', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const list = svc.expenses.listByWindow(ledgerId, windowFrom(req.query));
    res.json({ items: list, count: list.length });
  });

  /** 单笔 */
  r.get('/:expenseId', (req, res) => {
    const expense = svc.expenses.byId(idOf(req.params.expenseId));
    if (!expense) throw new BizError('花销不存在', 'NOT_FOUND', 404);
    res.json(expense);
  });

  r.delete('/:expenseId', (req, res) => {
    const expense = svc.expenses.byId(idOf(req.params.expenseId));
    if (!expense) throw new BizError('花销不存在', 'NOT_FOUND', 404);
    svc.expenses.remove(expense.id);
    res.status(204).end();
  });

  return r;
}
