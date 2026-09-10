// 服务层测试：账本/记账/聚合（内存库）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createReportService } from '../src/services/reportService.js';
import { createExportService } from '../src/services/exportService.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    reports: createReportService(db),
    exports: createExportService(db),
  };
  return { db, svc };
}

/** 取账本某维度下主 tag 的 id（副 tag 须挂在其下，测试辅助） */
function mainTagId(svc, ledgerId, dimKey, name) {
  const dim = svc.tags.dimensions(ledgerId).find(d => d.key === dimKey);
  const tag = dim.tags.find(t => t.name === name);
  assert.ok(tag, `维度 ${dimKey} 下应存在主 tag「${name}」`);
  return tag.id;
}

describe('账本', () => {
  test('建账本生成默认维度与种子 tag（不预设占位 tag）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    const dims = svc.tags.dimensions(l.id);
    assert.deepEqual(dims.map(d => d.key), ['category', 'context']);
    assert.equal(dims.find(d => d.key === 'category').tags.length, 6, '品类 6 个常用类');
    assert.equal(dims.find(d => d.key === 'context').tags.length, 4, '情境 4 个常用场景');
    assert.equal(
      dims.flatMap(d => d.tags).some(t => t.is_unnamed === 1), false,
      '不预设占位 tag ——「未分类」由记账缺省时按需创建'
    );
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

  test('什么 tag 都不选也能记账：各维自动落「未分类」（并当场创建）', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('X');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01' });

    // 每维一个「未分类」主 tag
    const primaries = e.tags.filter(t => t.role === 'primary');
    assert.equal(primaries.length, 2, '两维各一个 primary');
    assert.ok(primaries.every(t => t.name === '未分类' && t.is_unnamed === 1), '缺省落到「未分类」占位主 tag');
    // 每维的主 tag 下还各补一个「未分类」副 tag
    const secondaries = e.tags.filter(t => t.role === 'secondary');
    assert.equal(secondaries.length, 2, '两维各补一个副 tag');
    assert.ok(secondaries.every(t => t.name === '未分类' && t.is_unnamed === 1));
    assert.deepEqual(
      new Set(secondaries.map(t => t.parent_tag_id)),
      new Set(primaries.map(t => t.tag_id)),
      '副 tag 各挂在自己维度的主 tag 下'
    );
    // 占位 tag 按需创建：库里恰好 4 个（2 主 + 2 副），且不重复创建
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tags WHERE is_unnamed = 1').get().n, 4);
    svc.expenses.add({ ledgerId: l.id, amountCents: 50, date: '2026-06-02' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tags WHERE is_unnamed = 1').get().n, 4, '复用既有占位，不重复创建');
    // 缺省仍保证 Σ 守恒
    const view = svc.reports.windowView(l.id, { type: 'expense' });
    assert.equal(view.totals.expense, 150);
    assert.equal(view.byDimension.category.reduce((s, r) => s + r.amount_cents, 0), 150, '品类 Σ=总额');
    assert.equal(view.byDimension.context.reduce((s, r) => s + r.amount_cents, 0), 150, '情境 Σ=总额');
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
    svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', color: '#ffb066', parentTagId: mainTagId(svc, l.id, 'category', '餐饮') });
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
    svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', parentTagId: mainTagId(svc, l.id, 'category', '餐饮') });
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' }, tags: ['夜宵'] });
    const before = db.prepare('SELECT COUNT(*) n FROM expense_tag_links').get().n;
    const beforeTags = db.prepare('SELECT COUNT(*) n FROM tags').get().n;
    // 副 tag 不存在 → 抛错回滚
    assert.throws(
      () => svc.expenses.update(l.id, e.id, { amountCents: 999, date: '2026-06-08', primary: { category: '交通' }, tags: ['不存在的tag'] }),
      { code: 'TAG_NOT_FOUND' }
    );
    const after = svc.expenses.byId(e.id);
    assert.equal(after.amount_cents, 4560, '金额未变');
    assert.equal(after.date, '2026-06-07');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM expense_tag_links').get().n, before, 'links 未被破坏');
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM tags').get().n, beforeTags,
      '失败事务内懒创建的占位 tag 也一并回滚（懒创建与记账同生共死）'
    );
  });

  test('编辑缺省主 tag → 同样落「未分类」（全量替换语义）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', primary: { category: '餐饮' } });
    const updated = svc.expenses.update(l.id, e.id, { amountCents: 100, date: '2026-06-08' });
    assert.equal(updated.amount_cents, 100);
    assert.ok(
      updated.tags.filter(t => t.role === 'primary').every(t => t.name === '未分类'),
      '编辑时两维主 tag 都缺省 → 均落「未分类」'
    );
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

describe('tag 维护（S2-1：改名/改色/删除保护）', () => {
  test('改名生效且不破坏历史关联（link 按 tag_id）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 1000, date: '2026-06-01', primary: { category: '餐饮' } });
    const catDim = svc.tags.dimensions(l.id).find(d => d.key === 'category');
    const food = catDim.tags.find(t => t.name === '餐饮');
    svc.tags.update(l.id, food.id, { name: '外卖' });
    // 历史花销显示新名（关联按 tag_id 未断）
    const after = svc.expenses.byId(e.id);
    const prim = after.tags.find(t => t.role === 'primary' && t.dim_key === 'category');
    assert.equal(prim.name, '外卖');
    // 维度树同步
    const dims = svc.tags.dimensions(l.id);
    assert.equal(dims.find(d => d.key === 'category').tags.some(t => t.name === '外卖'), true);
    assert.equal(dims.find(d => d.key === 'category').tags.some(t => t.name === '餐饮'), false);
  });

  test('改色生效', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const catDim = svc.tags.dimensions(l.id).find(d => d.key === 'category');
    const food = catDim.tags.find(t => t.name === '餐饮');
    const updated = svc.tags.update(l.id, food.id, { color: '#123456' });
    assert.equal(updated.color, '#123456');
  });

  test('改名同维重名 → TAG_EXISTS；跨账本 → 404', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    const aCat = svc.tags.dimensions(a.id).find(d => d.key === 'category');
    const food = aCat.tags.find(t => t.name === '餐饮');
    // A 内改成已存在的「交通」→ 冲突
    assert.throws(() => svc.tags.update(a.id, food.id, { name: '交通' }), { code: 'TAG_EXISTS', status: 409 });
    // B 改 A 的 tag → 404
    assert.throws(() => svc.tags.update(b.id, food.id, { name: '外卖' }), { code: 'NOT_FOUND', status: 404 });
    // 空名 → 400
    assert.throws(() => svc.tags.update(a.id, food.id, { name: '  ' }), { code: 'MISSING_FIELD' });
  });

  test('「未分类」占位锁定：不可改名/改色/删除', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    // 缺省记账触发懒创建（不预设）
    svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01' });
    const ctx = svc.tags.dimensions(l.id).find(d => d.key === 'context');
    const unnamed = ctx.tags.find(t => t.is_unnamed === 1 && t.parent_tag_id === null);
    assert.ok(unnamed, '情境维已按需创建「未分类」主 tag');
    assert.equal(unnamed.name, '未分类');
    assert.throws(() => svc.tags.update(l.id, unnamed.id, { name: '随便' }), { code: 'UNNAMED_TAG_LOCKED', status: 409 });
    assert.throws(() => svc.tags.update(l.id, unnamed.id, { color: '#ff0000' }), { code: 'UNNAMED_TAG_LOCKED', status: 409 });
    assert.throws(() => svc.tags.remove(l.id, unnamed.id), { code: 'UNNAMED_TAG_LOCKED', status: 409 });
  });

  test('被引用 tag 删除 → TAG_IN_USE 拒绝（防级联破坏 Σ）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    // primary 引用
    svc.expenses.add({ ledgerId: l.id, amountCents: 1000, date: '2026-06-01', primary: { category: '餐饮' } });
    const catDim = svc.tags.dimensions(l.id).find(d => d.key === 'category');
    const food = catDim.tags.find(t => t.name === '餐饮');
    assert.throws(() => svc.tags.remove(l.id, food.id), { code: 'TAG_IN_USE', status: 409 });
    // 数据完好（拒绝发生在 DELETE 之前）
    const view = svc.reports.windowView(l.id, { type: 'expense' });
    assert.equal(view.totals.expense, 1000);
    const cnt = svc.expenses.listByWindow(l.id)[0].tags.filter(t => t.name === '餐饮').length;
    assert.equal(cnt, 1, '餐饮 primary link 未被级联删除');
  });

  test('副 tag 引用也拒删；未引用 tag 可删且维度树移除', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', parentTagId: mainTagId(svc, l.id, 'category', '餐饮') });
    svc.expenses.add({ ledgerId: l.id, amountCents: 1000, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['夜宵'] });
    const catDim = svc.tags.dimensions(l.id).find(d => d.key === 'category');
    const snack = catDim.tags.find(t => t.name === '夜宵');
    assert.throws(() => svc.tags.remove(l.id, snack.id), { code: 'TAG_IN_USE', status: 409 });

    // 建一个未引用的 tag 并删除
    const fresh = svc.tags.create(l.id, { dimensionKey: 'category', name: '临时' });
    svc.tags.remove(l.id, fresh.id);
    const dims = svc.tags.dimensions(l.id);
    assert.equal(dims.find(d => d.key === 'category').tags.some(t => t.name === '临时'), false);
  });
});

describe('维度扩展（S2-2：payment 启用 + 记账/统计贯通）', () => {
  test('启用 payment 维度：维度树出现（不预设占位 tag）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    const dim = svc.ledgers.enableDimension(l.id, 'payment', '支付方式');
    assert.ok(dim.id > 0);
    assert.equal(dim.key, 'payment');
    const dims = svc.tags.dimensions(l.id);
    assert.deepEqual(dims.map(d => d.key), ['category', 'context', 'payment']);
    const pay = dims.find(d => d.key === 'payment');
    assert.equal(pay.name, '支付方式');
    assert.equal(pay.tags.length, 0, '新维度不预设占位 tag，「未分类」按需创建');
  });

  test('重复启用 / 未知 key / 跨账本不受影响', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    svc.ledgers.enableDimension(a.id, 'payment');
    // 已启用 → 409
    assert.throws(() => svc.ledgers.enableDimension(a.id, 'payment'), { code: 'DIMENSION_EXISTS', status: 409 });
    // 已存在的 category → 409
    assert.throws(() => svc.ledgers.enableDimension(a.id, 'category'), { code: 'DIMENSION_EXISTS', status: 409 });
    // 未知 key → 400（白名单前置校验，避免撞 schema CHECK 变 500）
    assert.throws(() => svc.ledgers.enableDimension(a.id, 'location'), { code: 'INVALID_DIMENSION_KEY', status: 400 });
    // B 账本无 payment（隔离）
    const b = svc.ledgers.create('B');
    assert.equal(svc.tags.dimensions(b.id).some(d => d.key === 'payment'), false);
  });

  test('启用后记账：缺省 payment → 「未分类」，payment Σ=总额', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    svc.ledgers.enableDimension(l.id, 'payment');
    const e1 = svc.expenses.add({ ledgerId: l.id, amountCents: 3500, date: '2026-06-05', primary: { category: '餐饮' } });
    const e2 = svc.expenses.add({ ledgerId: l.id, amountCents: 1200, date: '2026-06-06', primary: { category: '交通', context: '通勤' } });
    // 每笔 payment primary = 未分类
    for (const id of [e1.id, e2.id]) {
      const x = svc.expenses.byId(id);
      const pay = x.tags.find(t => t.role === 'primary' && t.dim_key === 'payment');
      assert.equal(pay.is_unnamed, 1, '缺省 payment 落到「未分类」');
      assert.equal(pay.name, '未分类');
    }
    // 统计：payment Σ = 总额
    const view = svc.reports.windowView(l.id, { type: 'expense' });
    assert.equal(view.totals.expense, 4700);
    const paySum = view.byDimension.payment.reduce((s, r) => s + r.amount_cents, 0);
    assert.equal(paySum, 4700, 'payment Σ=总额（含未标注）');
  });

  test('启用后自建 payment tag 记账，统计按维度出现且守恒', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    svc.ledgers.enableDimension(l.id, 'payment');
    svc.tags.create(l.id, { dimensionKey: 'payment', name: '微信', color: '#07c160' });
    svc.expenses.add({ ledgerId: l.id, amountCents: 2000, date: '2026-06-05', primary: { category: '餐饮', payment: '微信' } });
    svc.expenses.add({ ledgerId: l.id, amountCents: 800, date: '2026-06-06', primary: { category: '交通' } });
    const view = svc.reports.windowView(l.id, { type: 'expense' });
    const pay = view.byDimension.payment;
    assert.ok(pay, 'byDimension 自动含新维度（report 真实维度化成果）');
    assert.equal(pay.find(t => t.name === '微信').amount_cents, 2000);
    const sum = pay.reduce((s, r) => s + r.amount_cents, 0);
    assert.equal(sum, 2800, 'payment Σ=总额');
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

// S6-v3：tag 两级化（主 tag → 副 tag）。核心规则：一笔账单的副 tag 只能取自它自己的主 tag，
// 因此「交通通勤」下挂不了「午餐」；维度之间因每维恰一 primary 而天然互不串位。
describe('副 tag 绑定主 tag（两级结构 + 归属校验）', () => {
  /** 在指定维度主 tag 下建副 tag */
  const addSub = (svc, l, dimKey, parentName, name) =>
    svc.tags.create(l.id, { dimensionKey: dimKey, name, parentTagId: mainTagId(svc, l.id, dimKey, parentName) });

  test('同维另一主 tag 下的副 tag 被拒（交通通勤 × 午餐）', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('生活费');
    addSub(svc, l, 'category', '餐饮', '午餐');
    addSub(svc, l, 'category', '交通', '地铁');

    // 合法：餐饮 + 午餐
    svc.expenses.add({ ledgerId: l.id, amountCents: 2000, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['午餐'] });
    // 越界：主 tag 取「交通」，副 tag 却是挂在「餐饮」下的「午餐」
    assert.throws(
      () => svc.expenses.add({ ledgerId: l.id, amountCents: 500, date: '2026-06-01', primary: { category: '交通' }, tags: ['午餐'] }),
      { code: 'SUBTAG_NOT_UNDER_PRIMARY', status: 400 },
      '交通通勤下不能挂餐饮的副 tag'
    );
    // 失败整体回滚，无残留
    assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses').get().n, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM expense_tag_links').get().n, 4,
      '成功笔 4 条 link（2 primary + 午餐 secondary + 情境维「未分类」兜底 secondary）'
    );
  });

  test('各维度副 tag 各归其主：品类与情境互不串位', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    addSub(svc, l, 'category', '餐饮', '午餐');
    addSub(svc, l, 'context', '和朋友', '聚餐');

    // 两个维度的副 tag 挂同一笔：各挂各的主 tag，都合法
    const e = svc.expenses.add({
      ledgerId: l.id, amountCents: 3000, date: '2026-06-01',
      primary: { category: '餐饮', context: '和朋友' }, tags: ['午餐', '聚餐'],
    });
    const subs = e.tags.filter(t => t.role === 'secondary').map(t => t.name);
    assert.equal(subs.length, 2);
    assert.deepEqual(new Set(subs), new Set(['午餐', '聚餐']));

    // 本笔情境主 tag 换成「通勤」→ 情境维副 tag「聚餐」不再属于本笔 → 拒
    assert.throws(
      () => svc.expenses.add({
        ledgerId: l.id, amountCents: 100, date: '2026-06-02',
        primary: { category: '餐饮', context: '通勤' }, tags: ['聚餐'],
      }),
      { code: 'SUBTAG_NOT_UNDER_PRIMARY', status: 400 }
    );
  });

  test('主 tag 与副 tag 不可互相冒充', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const food = mainTagId(svc, l.id, 'category', '餐饮');
    const lunch = addSub(svc, l, 'category', '餐饮', '午餐');

    // 主 tag 当副 tag → NOT_A_SUBTAG
    assert.throws(
      () => svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01', primary: { category: '餐饮' }, tags: [food] }),
      { code: 'NOT_A_SUBTAG', status: 400 }
    );
    // 副 tag 当主 tag（数字 id 路径）→ NOT_A_PRIMARY_TAG
    assert.throws(
      () => svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01', primary: { category: lunch.id } }),
      { code: 'NOT_A_PRIMARY_TAG', status: 400 }
    );
    // 副 tag 当主 tag（名称路径）→ 按名解析只认主 tag，故为找不到
    assert.throws(
      () => svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01', primary: { category: '午餐' } }),
      { code: 'TAG_NOT_FOUND', status: 404 }
    );
  });

  test('建 tag 校验：同父重名拒 / 跨父同名允 / 不超两级 / 父须同维度 / 未标注不可为父', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const food = mainTagId(svc, l.id, 'category', '餐饮');
    const traffic = mainTagId(svc, l.id, 'category', '交通');
    const friend = mainTagId(svc, l.id, 'context', '和朋友');

    const lunch = addSub(svc, l, 'category', '餐饮', '午餐');
    // 同父重名 → 409
    assert.throws(() => addSub(svc, l, 'category', '餐饮', '午餐'), { code: 'TAG_EXISTS', status: 409 });
    // 跨父同名 → 允许（餐饮→午餐 与 交通→午餐 共存）
    const lunchOnTraffic = addSub(svc, l, 'category', '交通', '午餐');
    assert.ok(lunchOnTraffic.id > 0 && lunchOnTraffic.id !== lunch.id);
    // 三级 → 400
    assert.throws(
      () => svc.tags.create(l.id, { dimensionKey: 'category', name: '工作日', parentTagId: lunch.id }),
      { code: 'SUBTAG_DEPTH_EXCEEDED', status: 400 }
    );
    // 父属于别的维度 → 400
    assert.throws(
      () => svc.tags.create(l.id, { dimensionKey: 'category', name: '错位', parentTagId: friend }),
      { code: 'PARENT_DIMENSION_MISMATCH', status: 400 }
    );
    // 父不存在 / 跨账本 id → 404
    assert.throws(
      () => svc.tags.create(l.id, { dimensionKey: 'category', name: 'X', parentTagId: 999999 }),
      { code: 'NOT_FOUND', status: 404 }
    );
    // 「未分类」占位不能作为父：缺省记一笔触发懒创建，再拿它当父建子 tag
    svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-01' });
    const unnamedCtx = svc.tags.dimensions(l.id)
      .find(d => d.key === 'context').tags.find(t => t.is_unnamed === 1);
    assert.throws(
      () => svc.tags.create(l.id, { dimensionKey: 'context', name: '子', parentTagId: unnamedCtx.id }),
      { code: 'UNNAMED_TAG_LOCKED', status: 409 }
    );
    assert.ok(food > 0 && traffic > 0);
  });

  test('维度树返回 parent_tag_id，前端可组树', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const food = mainTagId(svc, l.id, 'category', '餐饮');
    addSub(svc, l, 'category', '餐饮', '午餐');

    const catDim = svc.tags.dimensions(l.id).find(d => d.key === 'category');
    assert.equal(catDim.tags.find(t => t.name === '午餐').parent_tag_id, food, '副 tag 带父引用');
    assert.equal(catDim.tags.find(t => t.name === '餐饮').parent_tag_id, null, '主 tag 无父');
    assert.equal(catDim.tags.find(t => t.name === '交通').parent_tag_id, null);
  });

  test('删除保护：副 tag 被引用时，其父主 tag 也不可删', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('X');
    const food = mainTagId(svc, l.id, 'category', '餐饮');
    addSub(svc, l, 'category', '餐饮', '午餐');
    svc.expenses.add({ ledgerId: l.id, amountCents: 1000, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['午餐'] });
    // 父自身被 primary 引用 → 拒
    assert.throws(() => svc.tags.remove(l.id, food), { code: 'TAG_IN_USE', status: 409 });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM expense_tag_links').get().n, 4, '拒绝发生在删除之前，关联完好');

    // 造「父零引用、子被引用」态：记账路径必然同时引用父，故直接写 link 专测该保护
    const traffic = mainTagId(svc, l.id, 'category', '交通');
    const bus = addSub(svc, l, 'category', '交通', '公交');
    const host = svc.expenses.add({ ledgerId: l.id, amountCents: 100, date: '2026-06-03', primary: { category: '餐饮' } });
    db.prepare("INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, 'secondary')").run(host.id, bus.id);
    assert.throws(
      () => svc.tags.remove(l.id, traffic),
      { code: 'TAG_IN_USE', status: 409 },
      '删父会级联删子，故子被引用时父不可删'
    );
    // 子 tag 自身被引用同样拒删
    assert.throws(() => svc.tags.remove(l.id, bus.id), { code: 'TAG_IN_USE', status: 409 });
    // 父子都无引用时可删（子随父级联删除）
    const idle = addSub(svc, l, 'category', '交通', '临时子');
    assert.ok(idle.id > 0);
    svc.tags.remove(l.id, idle.id);
    assert.equal(svc.tags.dimensions(l.id).find(d => d.key === 'category').tags.some(t => t.id === idle.id), false);
  });

  test('编辑花销时归属校验同样生效（PUT 全量替换）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    addSub(svc, l, 'category', '餐饮', '午餐');
    addSub(svc, l, 'category', '交通', '地铁');
    const e = svc.expenses.add({ ledgerId: l.id, amountCents: 2000, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['午餐'] });

    // 主 tag 换成交通，却仍带着餐饮的副 tag → 拒
    assert.throws(
      () => svc.expenses.update(l.id, e.id, { amountCents: 2000, date: '2026-06-01', primary: { category: '交通' }, tags: ['午餐'] }),
      { code: 'SUBTAG_NOT_UNDER_PRIMARY', status: 400 }
    );
    // 改成交通 + 地铁（同主 tag 下）→ 通过
    const ok = svc.expenses.update(l.id, e.id, { amountCents: 2000, date: '2026-06-01', primary: { category: '交通' }, tags: ['地铁'] });
    const subs = ok.tags.filter(t => t.role === 'secondary').map(t => t.name);
    assert.ok(subs.includes('地铁'), '地铁成为本笔副 tag');
    assert.ok(subs.includes('未分类'), '情境维没选副 tag → 自动补「未分类」');
  });

  test('副 tag 不参与维度求和（Σ 守恒仍只按 primary 计）', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    addSub(svc, l, 'category', '餐饮', '午餐');
    addSub(svc, l, 'category', '餐饮', '晚餐');
    // 一笔挂两个副 tag，另一笔不挂
    svc.expenses.add({ ledgerId: l.id, amountCents: 3000, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['午餐', '晚餐'] });
    svc.expenses.add({ ledgerId: l.id, amountCents: 1200, date: '2026-06-02', primary: { category: '交通', context: '通勤' } });

    const view = svc.reports.windowView(l.id, { type: 'expense' });
    const sumBy = (rows) => rows.reduce((s, r) => s + r.amount_cents, 0);
    assert.equal(view.totals.expense, 4200);
    assert.equal(sumBy(view.byDimension.category), 4200, '品类 Σ=总额（副 tag 不重复计数）');
    assert.equal(sumBy(view.byDimension.context), 4200, '情境 Σ=总额');
    assert.equal(view.byDimension.category.find(t => t.name === '餐饮').amount_cents, 3000, '餐饮只算一次');
  });
});

// S6：tags.position。语义是「整组全量重写」，故"只传一部分"必须报错而非部分更新
// —— 否则会留下重复/断层的 position。
describe('tag 排序（维度内 position）', () => {
  /** 取某层级当前顺序的 tag id */
  const idsOf = (svc, ledgerId, dimKey, parentTagId = null) =>
    svc.tags.dimensions(ledgerId).find(d => d.key === dimKey).tags
      .filter(t => (t.parent_tag_id ?? null) === parentTagId).map(t => t.id);

  test('主 tag 重排：顺序生效，金额统计一分不变', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    svc.expenses.add({ ledgerId: l.id, amountCents: 3500, date: '2026-06-01', primary: { category: '餐饮' } });
    const before = idsOf(svc, l.id, 'category');
    const beforeSum = svc.reports.windowView(l.id, { type: 'expense' }).totals.expense;

    const reversed = [...before].reverse();
    svc.tags.reorder(l.id, 'category', null, reversed);

    assert.deepEqual(idsOf(svc, l.id, 'category'), reversed, '新顺序生效');
    assert.equal(svc.reports.windowView(l.id, { type: 'expense' }).totals.expense, beforeSum, '重排不碰金额');
  });

  test('副 tag 重排：只影响同父内的顺序', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const food = mainTagId(svc, l.id, 'category', '餐饮');
    const traffic = mainTagId(svc, l.id, 'category', '交通');
    for (const n of ['早餐', '午餐', '晚餐']) {
      svc.tags.create(l.id, { dimensionKey: 'category', name: n, parentTagId: food });
    }
    svc.tags.create(l.id, { dimensionKey: 'category', name: '地铁', parentTagId: traffic });

    const subBefore = idsOf(svc, l.id, 'category', food);
    const metro = idsOf(svc, l.id, 'category', traffic);
    assert.equal(subBefore.length, 3);

    const reversed = [...subBefore].reverse();
    svc.tags.reorder(l.id, 'category', food, reversed);

    assert.deepEqual(idsOf(svc, l.id, 'category', food), reversed, '副 tag 新顺序生效');
    assert.deepEqual(idsOf(svc, l.id, 'category', traffic), metro, '别的父不受影响');
    assert.ok(idsOf(svc, l.id, 'category').includes(food), '主 tag 层顺序未被打乱');
  });

  test('整组全量语义：少传/重复/跨层级/父不法 → 一律拒绝', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    const food = mainTagId(svc, l.id, 'category', '餐饮');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '午餐', parentTagId: food });
    const all = idsOf(svc, l.id, 'category');
    const subs = idsOf(svc, l.id, 'category', food);

    assert.throws(() => svc.tags.reorder(l.id, 'category', null, all.slice(0, -1)), { code: 'INCOMPLETE_ORDER', status: 400 }, '少传');
    assert.throws(() => svc.tags.reorder(l.id, 'category', null, [all[0], all[0], ...all.slice(1)]), { code: 'INVALID_FIELD', status: 400 }, '重复 id');
    assert.throws(() => svc.tags.reorder(l.id, 'category', null, [...all, ...subs]), { code: 'INCOMPLETE_ORDER', status: 400 }, '副 tag 混进主 tag 层');
    const friend = mainTagId(svc, l.id, 'context', '和朋友');
    assert.throws(() => svc.tags.reorder(l.id, 'category', friend, subs), { code: 'PARENT_DIMENSION_MISMATCH', status: 400 }, '父属于别的维度');
    assert.throws(() => svc.tags.reorder(l.id, 'category', 999999, subs), { code: 'NOT_FOUND', status: 404 }, '父不存在');
    assert.throws(() => svc.tags.reorder(l.id, 'location', null, all), { code: 'DIMENSION_NOT_FOUND', status: 404 }, '未知维度');
  });

  test('跨账本隔离：把 A 的 tag id 放进 B 的重排 → 拒绝，且 B 顺序不变', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    const aIds = idsOf(svc, a.id, 'category');
    const bBefore = idsOf(svc, b.id, 'category');
    assert.throws(() => svc.tags.reorder(b.id, 'category', null, aIds), { code: 'INCOMPLETE_ORDER', status: 400 });
    assert.deepEqual(idsOf(svc, b.id, 'category'), bBefore, 'B 的顺序未被改动');
  });

  test('position 真正落库为 0..n-1（重写而非累加）', () => {
    const { db, svc } = setup();
    const l = svc.ledgers.create('X');
    const all = idsOf(svc, l.id, 'category');
    svc.tags.reorder(l.id, 'category', null, [...all].reverse());
    const rows = db.prepare(`SELECT id, position FROM tags WHERE id IN (${all.join(',')}) ORDER BY position`).all();
    assert.deepEqual(rows.map(r => r.id), [...all].reverse(), '库里顺序 = 传入顺序');
    assert.deepEqual(rows.map(r => r.position), all.map((_, i) => i), 'position 归一为 0..n-1');
  });
});


