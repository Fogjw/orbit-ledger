// 路由：账本下花销（挂载于 /api/ledgers/:ledgerId/expenses）
import { Router } from 'express';
import { idOf, windowFrom, requireInt, requireStr, optStr } from '../validate.js';
import { BizError } from '../../services/ledgerService.js';

/**
 * 解析记账请求体（POST 记一笔 / PUT 编辑共用，字段同构）。
 * 返回 svc.expenses.add/update 可直接消费的输入（不含 ledgerId，由路径参数决定归属）。
 */
function expenseBody(body) {
  const primary = body.primary ?? {};
  if (typeof primary !== 'object' || Array.isArray(primary)) {
    throw new BizError('primary 须为对象', 'INVALID_FIELD');
  }
  return {
    type: body.type === 'income' ? 'income' : 'expense',
    amountCents: requireInt(body, 'amountCents', { min: 1 }),
    date: requireStr(body, 'date'),
    note: optStr(body, 'note'),
    primary,
    tags: Array.isArray(body.tags) ? body.tags : [],
  };
}

export function expensesRouter(svc) {
  const r = Router({ mergeParams: true });

  /** 记一笔 POST /api/ledgers/:ledgerId/expenses */
  r.post('/', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const expense = svc.expenses.add({ ledgerId, ...expenseBody(req.body ?? {}) });
    res.status(201).json(expense);
  });

  /** 时间窗列表 GET ?from&to&type */
  r.get('/', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const list = svc.expenses.listByWindow(ledgerId, windowFrom(req.query));
    res.json({ items: list, count: list.length });
  });

  /** 单笔（账本内；跨账本 → 404） */
  r.get('/:expenseId', (req, res) => {
    const expense = svc.expenses.getInLedger(idOf(req.params.ledgerId), idOf(req.params.expenseId));
    if (!expense) throw new BizError('花销不存在', 'NOT_FOUND', 404);
    res.json(expense);
  });

  /**
   * 编辑花销 PUT /api/ledgers/:ledgerId/expenses/:expenseId
   * 全量替换（D-10）：body 与 POST 同构，金额/日期/类型/备注/主副 tag 一次重写。
   */
  r.put('/:expenseId', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const expenseId = idOf(req.params.expenseId);
    const expense = svc.expenses.update(ledgerId, expenseId, expenseBody(req.body ?? {}));
    res.json(expense);
  });

  /** 删除（账本内；跨账本 → 404） */
  r.delete('/:expenseId', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const expenseId = idOf(req.params.expenseId);
    if (!svc.expenses.removeInLedger(ledgerId, expenseId)) {
      throw new BizError('花销不存在', 'NOT_FOUND', 404);
    }
    res.status(204).end();
  });

  return r;
}
