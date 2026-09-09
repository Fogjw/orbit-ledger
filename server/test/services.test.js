// 服务层测试：账本/记账/聚合（内存库）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createReportService } from '../src/services/reportService.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    reports: createReportService(db),
  };
  return { db, svc };
}

describe('账本', () => {
  test('建账本自动生成默认维度与「未标注」', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    const dims = svc.tags.dimensions(l.id);
    const keys = dims.map(d => d.key);
    assert.deepEqual(keys, ['category', 'context']);
    const ctx = dims.find(d => d.key === 'context');
    assert.ok(ctx.tags.some(t => t.is_unnamed === 1 && t.name === '未标注'), '情境维含未标注');
  });

  test('账本隔离：A 账本 tag 不能用于 B 账本记账', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    // 取 A 账本品类维「餐饮」tag id
    const aCatDim = svc.tags.dimensions(a.id).find(d => d.key === 'category');
    const aFoodTag = aCatDim.tags.find(t => t.name === '餐饮');
    assert.throws(
      () => svc.expenses.add({ ledgerId: b.id, amountCents: 100, date: '2026-06-01', primary: { category: aFoodTag.id } }),
      { code: 'TAG_NOT_FOUND' },
      'B 账本记账引用 A 的 tag id 应被拒'
    );
  });

  test('空名校验 / 删除后不可见', () => {
    const { svc } = setup();
    assert.throws(() => svc.ledgers.create('   '), { code: 'INVALID_NAME' });
    const l = svc.ledgers.create('X');
    svc.ledgers.remove(l.id);
    assert.throws(() => svc.ledgers.byId(l.id), { code: 'NOT_FOUND' }, '删除后 service 查询抛 NOT_FOUND');
  });
});

describe('记账（正交维度 Σ 守恒）', () => {
  test('多笔支出：品类 Σ = 情境 Σ = 总额（含未标注）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    const add = (p) => svc.expenses.add({ ledgerId: l.id, amountCents: p, date: '2026-06-05', primary: { category: '餐饮' } });
    add(3500); // context 缺省 → 未标注
    svc.expenses.add({ ledgerId: l.id, amountCents: 1200, date: '2026-06-06', primary: { category: '交通', context: '通勤' } });
    add(480);

    const win = { type: 'expense' };
    const view = svc.reports.windowView(l.id, win);
    const total = view.totals.expense;
    const sumBy = (rows) => rows.reduce((s, r) => s + r.amount_cents, 0);
    const catSum = sumBy(view.byDimension.category);
    const ctxSum = sumBy(view.byDimension.context);
    assert.equal(total, 3500 + 1200 + 480);
    assert.equal(catSum, total, '品类 Σ=总额');
    assert.equal(ctxSum, total, '情境 Σ=总额（含未标注）');
  });

  test('品类必填：缺省主 tag 抛 CATEGORY_REQUIRED 且事务回滚', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('X');
    assert.throws(
      () => svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01', primary: {} }),
      { code: 'CATEGORY_REQUIRED' }
    );
    // 事务回滚：无残留花销
    const cnt = db.prepare('SELECT COUNT(*) n FROM expenses').get();
    assert.equal(cnt.n, 0, '失败事务应回滚');
  });

  test('副 tag 不存在 → 抛错回滚（隔离 + 事务原子性）', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('X');
    assert.throws(
      () => svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['不存在的tag'] }),
      { code: 'TAG_NOT_FOUND' }
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses').get().n, 0);
  });

  test('金额/日期非法 → 抛错', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    assert.throws(() => svc.expenses.add({ ledgerId: l.id, amountCents: 0, date: '2026-06-01', primary: { category: '餐饮' } }), { code: 'INVALID_AMOUNT' });
    assert.throws(() => svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026/06/01', primary: { category: '餐饮' } }), { code: 'INVALID_DATE' });
  });

  test('收入记账独立于支出统计', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '收入·生活费', color: '#6fe3a8' });
    svc.expenses.add({ ledgerId: l.id, type: 'income', amountCents: 50000, date: '2026-06-01', primary: { category: '收入·生活费' } });
    svc.expenses.add({ ledgerId: l.id, amountCents: 1000, date: '2026-06-02', primary: { category: '餐饮' } });
    const view = svc.reports.windowView(l.id, {});
    assert.equal(view.totals.income, 50000);
    assert.equal(view.totals.expense, 1000);
  });
});

describe('聚合', () => {
  test('月度/每日序列按时间窗过滤', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const add = (amountCents, date) => svc.expenses.add({ ledgerId: l.id, amountCents, date, primary: { category: '餐饮' } });
    add(1000, '2026-05-10');
    add(2000, '2026-06-01');
    add(3000, '2026-06-15');
    const view = svc.reports.windowView(l.id, { from: '2026-06-01', to: '2026-06-30' });
    assert.equal(view.totals.expense, 5000);
    assert.equal(view.monthly.filter(m => m.month === '2026-05').length, 0);
    assert.equal(view.monthly.find(m => m.month === '2026-06').amount_cents, 5000);
    assert.equal(view.daily.length, 2);
  });
});
