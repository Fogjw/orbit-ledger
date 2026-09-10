// API 集成测试：真实 listen + fetch 全流程
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createReportService } from '../src/services/reportService.js';
import { createExportService } from '../src/services/exportService.js';
import { createApp } from '../src/api/app.js';

const db = openDatabase(':memory:');
migrate(db);
const svc = {
  ledgers: createLedgerService(db),
  tags: createTagService(db),
  expenses: createExpenseService(db),
  reports: createReportService(db),
  exports: createExportService(db),
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

    // 建副 tag：必须挂在主 tag 下（v3）——夜宵 → 餐饮
    const food = dims.dimensions.find(d => d.key === 'category').tags.find(t => t.name === '餐饮');
    assert.ok(food, '品类维含「餐饮」主 tag');
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '夜宵', color: '#ffb066', parentTagId: food.id }),
    });
    assert.equal(r.status, 201);
    assert.equal((await j(r)).parent_tag_id, food.id, '副 tag 记录父引用');

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
    // 建副 tag（供记账引用）：挂在「餐饮」下
    const foodTag = svc.tags.dimensions(ledger.id).find(d => d.key === 'category').tags.find(t => t.name === '餐饮');
    await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '夜宵', parentTagId: foodTag.id }),
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

  test('tag PATCH 改名/改色 + DELETE 删除保护（409/404）', async () => {
    const ledger = svc.ledgers.create('tag 账本');
    // 建副 tag（须挂在主 tag 下，v3）：夜宵 + 同父的「午餐」
    const catOf = (name) => svc.tags.dimensions(ledger.id).find(d => d.key === 'category').tags.find(t => t.name === name);
    const foodTag = catOf('餐饮');
    let r = await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '夜宵', color: '#ffb066', parentTagId: foodTag.id }),
    });
    assert.equal(r.status, 201);
    const tag = await j(r);
    assert.equal(tag.parent_tag_id, foodTag.id, '副 tag 记录父引用');
    await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '午餐', parentTagId: foodTag.id }),
    });

    // PATCH 改名/改色
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags/${tag.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '夜宵摊', color: '#aa0000' }),
    });
    assert.equal(r.status, 200);
    const updated = await j(r);
    assert.equal(updated.name, '夜宵摊');
    assert.equal(updated.color, '#aa0000');

    // PATCH 改名同父冲突 → 409
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags/${tag.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '午餐' }),
    });
    assert.equal(r.status, 409);
    assert.equal((await j(r)).error, 'TAG_EXISTS');

    // 跨父同名允许：在「交通」下建同名「午餐」→ 201
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '午餐', parentTagId: catOf('交通').id }),
    });
    assert.equal(r.status, 201, '不同主 tag 下允许同名副 tag');

    // 副 tag 不能跨维度挂：父属于情境维却按品类维提交 → 400
    const ctxOf = svc.tags.dimensions(ledger.id).find(d => d.key === 'context').tags.find(t => t.name === '和朋友');
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '错维子标签', parentTagId: ctxOf.id }),
    });
    assert.equal(r.status, 400);
    assert.equal((await j(r)).error, 'PARENT_DIMENSION_MISMATCH');

    // 「未分类」占位锁定 → 409：缺省记一笔触发按需创建，再取情境维那个
    await fetch(`${base}/api/ledgers/${ledger.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 100, date: '2026-06-01' }),
    });
    const dims = await (await fetch(`${base}/api/ledgers/${ledger.id}/dimensions`)).json();
    const ctxDim = dims.dimensions.find(d => d.key === 'context');
    const unnamed = ctxDim.tags.find(t => t.is_unnamed === 1 && t.parent_tag_id === null);
    assert.ok(unnamed, '缺省记账后情境维应存在「未分类」主 tag');
    assert.equal(unnamed.name, '未分类');
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags/${unnamed.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '改了' }),
    });
    assert.equal(r.status, 409);
    assert.equal((await j(r)).error, 'UNNAMED_TAG_LOCKED');

    // 记一笔引用「夜宵摊」→ DELETE → 409 TAG_IN_USE
    await fetch(`${base}/api/ledgers/${ledger.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 100, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['夜宵摊'] }),
    });
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags/${tag.id}`, { method: 'DELETE' });
    assert.equal(r.status, 409);
    assert.equal((await j(r)).error, 'TAG_IN_USE');

    // 未引用 tag 可删
    const idleTag = await (await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'category', name: '临时' }),
    })).json();
    r = await fetch(`${base}/api/ledgers/${ledger.id}/tags/${idleTag.id}`, { method: 'DELETE' });
    assert.equal(r.status, 204);

    // 跨账本操作 → 404
    const other = svc.ledgers.create('其他账本');
    r = await fetch(`${base}/api/ledgers/${other.id}/tags/${tag.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(r.status, 404);
  });

  test('POST dimensions 启用 payment → 记账/统计贯通', async () => {
    const ledger = svc.ledgers.create('扩展账本');
    // 启用 payment 维度
    let r = await fetch(`${base}/api/ledgers/${ledger.id}/dimensions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'payment', name: '支付方式' }),
    });
    assert.equal(r.status, 201);
    const dim = await j(r);
    assert.equal(dim.key, 'payment');

    // 维度树含 payment（不预设占位 tag，「未分类」由记账缺省按需创建）
    r = await fetch(`${base}/api/ledgers/${ledger.id}/dimensions`);
    const dims = await j(r);
    const pay = dims.dimensions.find(d => d.key === 'payment');
    assert.equal(pay.tags.length, 0, '新维度不预设占位 tag');

    // 记一笔带 payment primary
    await fetch(`${base}/api/ledgers/${ledger.id}/tags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dimensionKey: 'payment', name: '微信' }),
    });
    r = await fetch(`${base}/api/ledgers/${ledger.id}/expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 2000, date: '2026-06-01', primary: { category: '餐饮', payment: '微信' } }),
    });
    assert.equal(r.status, 201);

    // 统计含 payment 维度
    r = await fetch(`${base}/api/ledgers/${ledger.id}/stats`);
    const stats = await j(r);
    assert.equal(stats.totals.expense, 2000);
    const wechat = stats.byDimension.payment.find(t => t.name === '微信');
    assert.equal(wechat.amount_cents, 2000);

    // 重复启用 → 409
    r = await fetch(`${base}/api/ledgers/${ledger.id}/dimensions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'payment' }),
    });
    assert.equal(r.status, 409);
  });

  test('GET /ledgers/:id/export 返回账本全量快照；不存在 404', async () => {
    const ledger = svc.ledgers.create('导出账本');
    svc.expenses.add({ ledgerId: ledger.id, amountCents: 1234, date: '2026-06-01', primary: { category: '餐饮' } });
    let r = await fetch(`${base}/api/ledgers/${ledger.id}/export`);
    assert.equal(r.status, 200);
    const snap = await j(r);
    assert.equal(snap.format, 'orbit-ledger-backup');
    assert.equal(snap.version, 1);
    assert.equal(snap.ledger.id, ledger.id);
    assert.equal(snap.expenses.length, 1);
    assert.equal(snap.expenses[0].amount_cents, 1234);

    r = await fetch(`${base}/api/ledgers/99999/export`);
    assert.equal(r.status, 404);
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
