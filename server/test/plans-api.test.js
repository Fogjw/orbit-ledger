// 计划 REST 契约：CRUD / 记账勾选 / 统计过滤 / 隔离。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createPlanService } from '../src/services/planService.js';
import { createReportService } from '../src/services/reportService.js';
import { createApp } from '../src/api/app.js';

const db = openDatabase(':memory:');
migrate(db);
const svc = {
  ledgers: createLedgerService(db),
  tags: createTagService(db),
  expenses: createExpenseService(db),
  plans: createPlanService(db),
  reports: createReportService(db),
};
const app = createApp(svc);
let base = '';
let server;

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(res => server.close(res)));

const json = (res) => res.json();
const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const patch = (path, body) => fetch(base + path, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('计划 REST', () => {
  test('建/查/改/删 + 记账勾选 + 统计过滤', async () => {
    const l = await json(await post('/api/ledgers', { name: 'L' }));
    const created = await post(`/api/ledgers/${l.id}/plans`, {
      name: '生活费', budgetCents: 200000, startDate: '2026-11-01', endDate: '2026-11-30',
    });
    assert.equal(created.status, 201);
    const plan = await created.json();
    assert.equal(plan.remaining_cents, 200000);

    const list = await json(await fetch(`${base}/api/ledgers/${l.id}/plans`));
    assert.equal(list.items.length, 1);

    const exp = await json(await post(`/api/ledgers/${l.id}/expenses`, {
      type: 'expense', amountCents: 4560, date: '2026-11-05', planIds: [plan.id],
    }));
    assert.deepEqual(exp.plans.map(p => p.id), [plan.id]);

    const stats = await json(await fetch(`${base}/api/ledgers/${l.id}/stats?planId=${plan.id}`));
    assert.equal(stats.totals.expense, 4560);

    const renamed = await json(await patch(`/api/ledgers/${l.id}/plans/${plan.id}`, { name: '十一月生活费' }));
    assert.equal(renamed.name, '十一月生活费');
    assert.equal(renamed.remaining_cents, 200000 - 4560);

    const del = await fetch(`${base}/api/ledgers/${l.id}/plans/${plan.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    const after = await json(await fetch(`${base}/api/ledgers/${l.id}/expenses/${exp.id}`));
    assert.deepEqual(after.plans, []);
  });

  test('跨账本与非法参数', async () => {
    const a = await json(await post('/api/ledgers', { name: 'A' }));
    const b = await json(await post('/api/ledgers', { name: 'B' }));
    const plan = await json(await post(`/api/ledgers/${a.id}/plans`, {
      name: 'P', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30',
    }));

    const bad = await post(`/api/ledgers/${a.id}/plans`, {
      name: '负预算', budgetCents: -1, startDate: '2026-11-01', endDate: '2026-11-30',
    });
    assert.equal(bad.status, 400);

    const cross = await post(`/api/ledgers/${b.id}/expenses`, {
      type: 'expense', amountCents: 100, date: '2026-11-05', planIds: [plan.id],
    });
    assert.equal(cross.status, 404);
    assert.equal((await cross.json()).error, 'PLAN_NOT_FOUND');

    const out = await post(`/api/ledgers/${a.id}/expenses`, {
      type: 'expense', amountCents: 100, date: '2026-12-05', planIds: [plan.id],
    });
    assert.equal(out.status, 400);
    assert.equal((await out.json()).error, 'PLAN_OUT_OF_RANGE');
  });
});

describe('计划入参校验（review 补测）', () => {
  test('不存在的账本建计划 → 404，不是 500', async () => {
    const r = await post('/api/ledgers/99999/plans', {
      name: '孤儿', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30',
    });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'LEDGER_NOT_FOUND');
  });

  test('planIds 非数组 → 400，且不清空已有关联', async () => {
    const l = await json(await post('/api/ledgers', { name: '校验' }));
    const p = await json(await post(`/api/ledgers/${l.id}/plans`, {
      name: 'P', budgetCents: 0, startDate: '2026-11-01', endDate: '2026-11-30',
    }));
    const exp = await json(await post(`/api/ledgers/${l.id}/expenses`, {
      type: 'expense', amountCents: 100, date: '2026-11-05', planIds: [p.id],
    }));

    const bad = await fetch(`${base}/api/ledgers/${l.id}/expenses/${exp.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'expense', amountCents: 100, date: '2026-11-05', planIds: 3 }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'INVALID_FIELD');

    const after = await json(await fetch(`${base}/api/ledgers/${l.id}/expenses/${exp.id}`));
    assert.deepEqual(after.plans.map(x => x.id), [p.id], '坏入参不得静默解绑');
  });
});
