// 计划（预算轨道）：CRUD、余额、账本隔离。
// 余额 = 预算 + 入账 − 已用；允许为负（允许超支）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createPlanService } from '../src/services/planService.js';
import { createPlanRepo } from '../src/repos/planRepo.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    plans: createPlanService(db),
  };
  return { db, svc };
}

describe('计划 CRUD 与余额', () => {
  test('建计划：余额 = 预算 + 入账 − 已用', () => {
    const { svc, db } = setup();
    const l = svc.ledgers.create('生活费');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '收入·生活费' });
    const p = svc.plans.create(l.id, { name: '生活费', budgetCents: 200000, startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.equal(p.remaining_cents, 200000);
    assert.equal(p.bill_count, 0);

    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-11-05', primary: { category: '餐饮' } });
    createPlanRepo(db).link(e.id, p.id);
    const inc = svc.expenses.add({ ledgerId: l.id, type: 'income', amountCents: 10000, date: '2026-11-06', primary: { category: '收入·生活费' } });
    createPlanRepo(db).link(inc.id, p.id);

    const row = svc.plans.list(l.id).find(x => x.id === p.id);
    assert.equal(row.spent_cents, 4560);
    assert.equal(row.income_cents, 10000);
    assert.equal(row.remaining_cents, 200000 + 10000 - 4560);
    assert.equal(row.bill_count, 2);
  });

  test('计划 CRUD 校验与隔离', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    assert.throws(() => svc.plans.create(a.id, { name: ' ', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30' }));
    assert.throws(() => svc.plans.create(a.id, { name: 'P', budgetCents: -1, startDate: '2026-11-01', endDate: '2026-11-30' }));
    assert.throws(() => svc.plans.create(a.id, { name: 'P', budgetCents: 0, startDate: '2026-11-30', endDate: '2026-11-01' }));

    const p = svc.plans.create(a.id, { name: 'P', budgetCents: 100, startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.equal(svc.plans.update(a.id, p.id, { budgetCents: 200 }).budget_cents, 200);
    assert.throws(() => svc.plans.update(b.id, p.id, { name: 'X' }), (e) => e.code === 'PLAN_NOT_FOUND');
    assert.throws(() => svc.plans.remove(b.id, p.id), (e) => e.code === 'PLAN_NOT_FOUND');
    assert.equal(svc.plans.list(a.id).length, 1);
  });
});

describe('账单 ↔ 计划', () => {
  test('一笔账进多个计划：各自全额计入，改/删同步', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('L');
    const p1 = svc.plans.create(l.id, { name: '生活费', budgetCents: 200000, startDate: '2026-11-01', endDate: '2026-11-30' });
    const p2 = svc.plans.create(l.id, { name: '旅行', budgetCents: 100000, startDate: '2026-11-01', endDate: '2026-11-30' });

    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 5000, date: '2026-11-05', planIds: [p1.id, p2.id] });
    assert.deepEqual(e.plans.map(x => x.id).sort(), [p1.id, p2.id]);
    const rows = svc.plans.list(l.id);
    assert.equal(rows.find(r => r.id === p1.id).spent_cents, 5000);
    assert.equal(rows.find(r => r.id === p2.id).spent_cents, 5000);

    svc.expenses.update(l.id, e.id, { type: 'expense', amountCents: 7000, date: '2026-11-05', primary: {}, tags: [], planIds: [p2.id] });
    const after = svc.plans.list(l.id);
    assert.equal(after.find(r => r.id === p1.id).spent_cents, 0, 'p1 解绑');
    assert.equal(after.find(r => r.id === p2.id).spent_cents, 7000);

    svc.expenses.removeInLedger(l.id, e.id);
    assert.equal(svc.plans.list(l.id).find(r => r.id === p2.id).spent_cents, 0);
  });

  test('已关联的计划在日期改到区间外后仍保留', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('L');
    const p = svc.plans.create(l.id, { name: 'P', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30' });
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-11-05', planIds: [p.id] });
    const moved = svc.expenses.update(l.id, e.id, {
      type: 'expense', amountCents: 100, date: '2026-12-05', primary: {}, tags: [], planIds: [p.id],
    });
    assert.deepEqual(moved.plans.map(x => x.id), [p.id], '越界编辑不静默丢链接');
    assert.equal(svc.plans.list(l.id)[0].spent_cents, 100, '仍计入该计划');
  });

  test('计划归属与日期窗口校验', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    const p = svc.plans.create(a.id, { name: 'P', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.throws(
      () => svc.expenses.add({ ledgerId: a.id, amountCents: 100, date: '2026-12-01', planIds: [p.id] }),
      (e) => e.code === 'PLAN_OUT_OF_RANGE'
    );
    assert.throws(
      () => svc.expenses.add({ ledgerId: b.id, amountCents: 100, date: '2026-11-05', planIds: [p.id] }),
      (e) => e.code === 'PLAN_NOT_FOUND'
    );
    const e = svc.expenses.add({ ledgerId: a.id, amountCents: 100, date: '2026-11-05' });
    assert.deepEqual(e.plans, []);
  });

  test('删计划不删账单；列表可按计划过滤', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('L');
    const p = svc.plans.create(l.id, { name: 'P', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30' });
    const inPlan = svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-11-05', planIds: [p.id] });
    svc.expenses.add({ ledgerId: l.id, amountCents: 200, date: '2026-11-06' });

    assert.equal(svc.expenses.listByWindow(l.id, { planId: p.id }).length, 1);
    svc.plans.remove(l.id, p.id);
    assert.ok(svc.expenses.getInLedger(l.id, inPlan.id), '账单仍在');
    assert.deepEqual(svc.expenses.getInLedger(l.id, inPlan.id).plans, []);
  });
});
