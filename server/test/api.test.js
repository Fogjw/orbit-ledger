// API 集成测试：真实 listen + fetch 全流程
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createReportService } from '../src/services/reportService.js';
import { createApp } from '../src/api/app.js';

const db = openDatabase(':memory:');
migrate(db);
const svc = {
  ledgers: createLedgerService(db),
  tags: createTagService(db),
  expenses: createExpenseService(db),
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

const j = (res) => res.json();

describe('API 全流程', () => {
  test('health', async () => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    assert.equal((await j(r)).ok, true);
  });

  test('建账本 → 建副 tag → 记一笔 → 列表/统计', async () => {
    // 建账本
    let r = await fetch(`${base}/api/ledgers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '测试账本' }),
    });
    assert.equal(r.status, 201);
    const ledger = await j(r);
    assert.ok(ledger.id > 0);

    // 维度视图
    r = await fetch(`${base}/api/ledgers/${ledger.id}/dimensions`);
    const dims = await j(r);
    assert.equal(dims.dimensions.length, 2);

    // 建副 tag（品类维）
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '夜宵', color: '#ffb066' }),
    });
    assert.equal(r.status, 201);

    // 记一笔（含副 tag 用名称）
    r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents: 4560, date: '2026-06-07',
        primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'], note: '撸串',
      }),
    });
    assert.equal(r.status, 201);
    const expense = await j(r);
    assert.equal(expense.tags.filter(t => t.role === 'primary').length, 2);
    assert.equal(expense.tags.some(t => t.name === '夜宵' && t.role === 'secondary'), true);

    // 列表
    r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses`);
    const list = await j(r);
    assert.equal(list.count, 1);

    // 统计：品类 Σ=总额
    r = await fetch(`${base}/api/ledgers/${ledger.id}/stats`);
    const stats = await j(r);
    assert.equal(stats.totals.expense, 4560);
    const cat = stats.byDimension.category.find(t => t.name === '餐饮');
    assert.equal(cat.amount_cents, 4560);

    // 时间窗过滤
    r = await fetch(`${base}/api/ledgers/${ledger.id}/stats?from=2026-07-01&to=2026-07-31`);
    const empty = await j(r);
    assert.equal(empty.totals.expense, 0);
  });

  test('PUT 编辑花销：全量替换 + 统计守恒 + 404 隔离', async () => {
    const ledger = svc.ledgers.create('编辑账本');
    // 建副 tag（供记账引用）
    await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '夜宵' }),
    });
    // 记一笔
    let r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents: 4560, date: '2026-06-07', note: '撸串',
        primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'],
      }),
    });
    const expense = await j(r);

    // PUT 全量替换
    r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses/${expense.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents: 2000, date: '2026-06-08',
        primary: { category: '交通', context: '通勤' }, tags: [],
      }),
    });
    assert.equal(r.status, 200);
    const updated = await j(r);
    assert.equal(updated.amount_cents, 2000);
    assert.equal(updated.tags.some(t => t.name === '餐饮'), false);
    assert.equal(updated.tags.filter(t => t.role === 'primary').length, 2);

    // 统计守恒
    r = await fetch(`${base}/api/ledgers/${ledger.id}/stats`);
    const stats = await j(r);
    assert.equal(stats.totals.expense, 2000);
    assert.equal(stats.byDimension.category.find(t => t.name === '交通').amount_cents, 2000);

    // 跨账本 PUT → 404
    const other = svc.ledgers.create('另一账本');
    r = await fetch(`${base}/api/ledgers/${other.id}/expenses/${expense.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 1, date: '2026-06-08', primary: { category: '交通' } }),
    });
    assert.equal(r.status, 404);

    // 跨账本 GET 单笔 → 404
    r = await fetch(`${base}/api/ledgers/${other.id}/expenses/${expense.id}`);
    assert.equal(r.status, 404);

    // 非法金额 PUT → 400
    r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses/${expense.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 0, date: '2026-06-08', primary: { category: '交通' } }),
    });
    assert.equal(r.status, 400);
  });

  test('错误映射：404 / 400 / 业务错误', async () => {
    let r = await fetch(`${base}/api/nonexistent`);
    assert.equal(r.status, 404);
    assert.equal((await j(r)).error, 'NOT_FOUND');

    // 不存在的账本
    r = await fetch(`${base}/api/ledgers/99999`);
    assert.equal(r.status, 404);
    assert.equal((await j(r)).error, 'NOT_FOUND');

    // 缺金额
    const ledger = svc.ledgers.create('E');
    r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-01', primary: { category: '餐饮' } }),
    });
    assert.equal(r.status, 400);
    assert.equal((await j(r)).error, 'MISSING_FIELD');
  });
});
