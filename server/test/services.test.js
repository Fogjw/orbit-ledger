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

describe('花销编辑（S1：PUT 全量替换，单事务）', () => {
  test('编辑金额/日期/备注/主副 tag 全部生效（旧关联清空重写）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', color: '#ffb066' });
    const e = svc.expenses.add({
      ledgerId: l.id, amountCents: 4560, date: '2026-06-07', note: '撸串',
      primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'],
    });
    const updated = svc.expenses.update(l.id, e.id, {
      amountCents: 2000, date: '2026-06-08', note: '改坐地铁',
      primary: { category: '交通', context: '通勤' }, tags: [],
    });
    assert.equal(updated.amount_cents, 2000);
    assert.equal(updated.date, '2026-06-08');
    assert.equal(updated.note, '改坐地铁');
    // primary 每维一个（交通/通勤），无餐饮、无夜宵残留
    const primaries = updated.tags.filter(t => t.role === 'primary');
    assert.equal(primaries.length, 2);
    assert.deepEqual(new Set(primaries.map(t => t.name)), new Set(['交通', '通勤']));
    assert.equal(updated.tags.some(t => t.name === '餐饮'), false);
    assert.equal(updated.tags.some(t => t.name === '夜宵'), false);
  });

  test('编辑后 Σ 守恒：改金额/换主 tag 反映到各维聚合', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' } });
    svc.expenses.update(l.id, e.id, { amountCents: 1000, date: '2026-06-07', primary: { category: '交通', context: '通勤' } });
    const view = svc.reports.windowView(l.id, { type: 'expense' });
    assert.equal(view.totals.expense, 1000);
    const sumBy = (rows) => rows.reduce((s, r) => s + r.amount_cents, 0);
    assert.equal(sumBy(view.byDimension.category), 1000, '品类 Σ=总额');
    assert.equal(sumBy(view.byDimension.context), 1000, '情境 Σ=总额');
    const cat = view.byDimension.category;
    assert.equal(cat.find(t => t.name === '交通').amount_cents, 1000);
    assert.equal(cat.some(t => t.name === '餐饮'), false, '旧主 tag 金额应归零（不再出现在聚合）');
  });

  test('编辑失败 → 整体回滚，原值原关联不变', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('X');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵' });
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' }, tags: ['夜宵'] });
    // 副 tag 不存在 → 抛错回滚
    assert.throws(
      () => svc.expenses.update(l.id, e.id, { amountCents: 999, date: '2026-06-08', primary: { category: '交通' }, tags: ['不存在的tag'] }),
      { code: 'TAG_NOT_FOUND' }
    );
    const after = svc.expenses.byId(e.id);
    assert.equal(after.amount_cents, 4560, '金额未变');
    assert.equal(after.date, '2026-06-07');
    const cnt = db.prepare('SELECT COUNT(*) n FROM expense_tag_links').get();
    assert.equal(cnt.n, 3, 'links 未被破坏（餐饮 primary + 未标注 primary + 夜宵 secondary）');
  });

  test('编辑仍需品类必填（全量替换语义）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' } });
    assert.throws(
      () => svc.expenses.update(l.id, e.id, { amountCents: 100, date: '2026-06-08', primary: {} }),
      { code: 'CATEGORY_REQUIRED' }
    );
    const after = svc.expenses.byId(e.id);
    assert.equal(after.amount_cents, 4560, '失败应回滚');
  });

  test('跨账本编辑/删除/单笔读取 → 404（隔离收紧）', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    const e = svc.expenses.add({ ledgerId: a.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' } });
    // B 编辑 A 的花销
    assert.throws(
      () => svc.expenses.update(b.id, e.id, { amountCents: 1, date: '2026-06-07', primary: { category: '餐饮' } }),
      { code: 'NOT_FOUND', status: 404 }
    );
    // B 单笔读 A 的花销 → null（路由映射 404）
    assert.equal(svc.expenses.getInLedger(b.id, e.id), null);
    // A 正常读得到
    assert.ok(svc.expenses.getInLedger(a.id, e.id));
    // 不存在的 id
    assert.throws(
      () => svc.expenses.update(a.id, 99999, { amountCents: 1, date: '2026-06-07', primary: { category: '餐饮' } }),
      { code: 'NOT_FOUND', status: 404 }
    );
  });

  test('编辑可切换 income/expense 类型', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' } });
    const updated = svc.expenses.update(l.id, e.id, { type: 'income', amountCents: 10000, date: '2026-06-07', primary: { category: '餐饮' } });
    assert.equal(updated.type, 'income');
    const view = svc.reports.windowView(l.id, {});
    assert.equal(view.totals.income, 10000);
    assert.equal(view.totals.expense, 0, '由支出转收入后 expense Σ 归零');
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
