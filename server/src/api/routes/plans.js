// 路由：账本下的计划（预算轨道）—— /api/ledgers/:ledgerId/plans
import { Router } from 'express';
import { idOf, requireInt, requireStr } from '../validate.js';

/** 创建请求体：四个字段都必填 */
function createBody(body) {
  return {
    name: requireStr(body, 'name'),
    budgetCents: requireInt(body, 'budgetCents', { min: 0 }),
    startDate: requireStr(body, 'startDate'),
    endDate: requireStr(body, 'endDate'),
  };
}

/** PATCH：只校验给了的字段，未给字段由 service 保留原值 */
function patchBody(body) {
  const out = {};
  if (body.name !== undefined) out.name = requireStr(body, 'name');
  if (body.budgetCents !== undefined) out.budgetCents = requireInt(body, 'budgetCents', { min: 0 });
  if (body.startDate !== undefined) out.startDate = requireStr(body, 'startDate');
  if (body.endDate !== undefined) out.endDate = requireStr(body, 'endDate');
  return out;
}

export function plansRouter(svc) {
  const r = Router({ mergeParams: true });

  /** GET /api/ledgers/:ledgerId/plans */
  r.get('/', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const items = svc.plans.list(ledgerId);
    res.json({ items, count: items.length });
  });

  /** POST /api/ledgers/:ledgerId/plans */
  r.post('/', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const plan = svc.plans.create(ledgerId, createBody(req.body ?? {}));
    res.status(201).json(plan);
  });

  /** PATCH /api/ledgers/:ledgerId/plans/:planId */
  r.patch('/:planId', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const planId = idOf(req.params.planId, 'planId');
    res.json(svc.plans.update(ledgerId, planId, patchBody(req.body ?? {})));
  });

  /** DELETE：只解绑账单，不删账单 */
  r.delete('/:planId', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const planId = idOf(req.params.planId, 'planId');
    svc.plans.remove(ledgerId, planId);
    res.status(204).end();
  });

  return r;
}
