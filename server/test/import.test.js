// 导入（备份回读）测试：格式校验 / 引用完整性 / 重建等价 / 隔离 / 事务无残留
// 语义：导入 = 用一个备份快照**新建一个账本**（不覆盖、不合并），主键全部重新分配。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createExportService } from '../src/services/exportService.js';
import { createImportService } from '../src/services/importService.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    exports: createExportService(db),
    imports: createImportService(db),
  };
  return { db, svc };
}

/** 造一个「内容齐全」的源账本：种子 tag + 副 tag + 收入 + 缺省占位（未分类懒创建） */
function seedSource(svc) {
  const l = svc.ledgers.create('生活费');
  const food = svc.tags.dimensions(l.id).find(d => d.key === 'category').tags.find(t => t.name === '餐饮');
  svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', parentTagId: food.id });
  svc.tags.create(l.id, { dimensionKey: 'category', name: '收入·生活费' });
  svc.expenses.add({
    ledgerId: l.id, amountCents: 4560, date: '2026-06-07', note: '撸串',
    primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'],
  });
  svc.expenses.add({
    ledgerId: l.id, type: 'income', amountCents: 50000, date: '2026-06-01',
    primary: { category: '收入·生活费' },
  });
  svc.expenses.add({ ledgerId: l.id, amountCents: 1200, date: '2026-06-06', primary: { category: '交通', context: '通勤' } });
  return l;
}

/**
 * 按各维 primary 求和，校验「每维 Σ = 总额」。
 * 收入的缺省占位「收入·未分类」在每个维度里各有一份，所以收入同样计入各维 ——
 * 两个维度都应当等于全部金额（含收入）。
 */
function assertSumInvariant(svc, ledgerId, expectedTotal) {
  const snap = svc.exports.ledgerSnapshot(ledgerId);
  const dimKeyOf = (tagId) => snap.dimensions.find(d => d.id === snap.tags.find(t => t.id === tagId)?.dimension_id)?.key;
  const perDim = {};
  let total = 0;
  for (const e of snap.expenses) {
    total += e.amount_cents;
    for (const link of snap.expense_tag_links.filter(x => x.expense_id === e.id && x.role === 'primary')) {
      const k = dimKeyOf(link.tag_id);
      perDim[k] = (perDim[k] ?? 0) + e.amount_cents;
    }
  }
  assert.equal(total, expectedTotal, '总额');
  for (const [k, v] of Object.entries(perDim)) assert.equal(v, total, `${k} 维 Σ=总额`);
}

describe('导入（备份回读）', () => {
  test('导出→导入：笔数/金额/主副层级/links 完整重建，且主键重新分配', () => {
    const { svc } = setup();
    const src = seedSource(svc);
    const snap = svc.exports.ledgerSnapshot(src.id);

    const out = svc.imports.importSnapshot(snap);

    assert.notEqual(out.ledger.id, src.id, '导入为一个新账本');
    assert.equal(out.ledger.name, '生活费', '沿用备份内的账本名（允许重名）');
    const dst = svc.exports.ledgerSnapshot(out.ledger.id);

    // 明细等价（type/金额/日期/备注 多重集合）
    const key = (e) => [e.type, e.amount_cents, e.date, e.note];
    assert.deepEqual(dst.expenses.map(key).sort(), snap.expenses.map(key).sort());
    assert.equal(dst.expenses.length, snap.expenses.length);
    assert.equal(dst.dimensions.length, snap.dimensions.length);
    assert.equal(dst.tags.length, snap.tags.length, 'tag 全量（含懒创建的「未分类」占位）');
    assert.equal(dst.expense_tag_links.length, snap.expense_tag_links.length);

    // 主副层级随新主键重建：夜宵 的父指向**新账本的**餐饮，而非源 id
    const srcFood = snap.tags.find(t => t.name === '餐饮');
    const srcSnack = snap.tags.find(t => t.name === '夜宵');
    const dstFood = dst.tags.find(t => t.name === '餐饮');
    const dstSnack = dst.tags.find(t => t.name === '夜宵');
    assert.equal(srcSnack.parent_tag_id, srcFood.id, '源：夜宵挂在餐饮下');
    assert.equal(dstSnack.parent_tag_id, dstFood.id, '目标：副 tag 挂到新主 tag');
    assert.notEqual(dstFood.id, srcFood.id, '主键重新分配');

    // 占位 tag 语义保留
    assert.equal(dst.tags.filter(t => t.is_unnamed === 1).length,
      snap.tags.filter(t => t.is_unnamed === 1).length);

    // 金额守恒不变量在新账本成立（4560 + 50000 + 1200）
    assertSumInvariant(svc, out.ledger.id, 55760);
    assert.deepEqual(out.counts, {
      dimensions: dst.dimensions.length, tags: dst.tags.length,
      expenses: dst.expenses.length, links: dst.expense_tag_links.length,
    });
  });

  test('导入不影响源账本，且与源账本互相隔离（可重复导入出多个独立账本）', () => {
    const { svc } = setup();
    const src = seedSource(svc);
    const snap = svc.exports.ledgerSnapshot(src.id);
    assert.equal(JSON.parse(JSON.stringify(snap)).expenses.length, 3);

    const a = svc.imports.importSnapshot(snap);
    const b = svc.imports.importSnapshot(snap);

    assert.notEqual(a.ledger.id, b.ledger.id);
    assert.equal(svc.exports.ledgerSnapshot(src.id).expenses.length, 3, '源账本不受影响');
    assert.equal(svc.exports.ledgerSnapshot(a.ledger.id).expenses.length, 3);
    // 在导入账本里记一笔，不串到源账本
    svc.expenses.add({ ledgerId: a.ledger.id, amountCents: 999, date: '2026-06-08', primary: { category: '餐饮' } });
    assert.equal(svc.exports.ledgerSnapshot(a.ledger.id).expenses.length, 4);
    assert.equal(svc.exports.ledgerSnapshot(src.id).expenses.length, 3);
    assert.equal(svc.exports.ledgerSnapshot(b.ledger.id).expenses.length, 3);
  });

  test('空账本（无花销）也可导入：只重建维度与种子 tag', () => {
    const { svc } = setup();
    const src = svc.ledgers.create('空本');
    const snap = svc.exports.ledgerSnapshot(src.id);
    const out = svc.imports.importSnapshot(snap);
    const dst = svc.exports.ledgerSnapshot(out.ledger.id);
    assert.equal(dst.expenses.length, 0);
    assert.equal(dst.tags.length, 10, '两个默认维度各 5/4… 实为品类 6 + 情境 4');
    assert.equal(dst.expense_tag_links.length, 0);
  });

  test('格式/版本/结构不合法 → INVALID_BACKUP', () => {
    const { svc } = setup();
    const src = seedSource(svc);
    const good = svc.exports.ledgerSnapshot(src.id);

    const bad = [
      [null, '空'],
      [{}, '空对象'],
      [{ ...good, format: 'something-else' }, 'format 不符'],
      [{ ...good, version: 99 }, '版本不支持'],
      [{ ...good, expenses: undefined }, '缺 expenses'],
      [{ ...good, tags: 'nope' }, 'tags 不是数组'],
      [{ ...good, ledger: undefined }, '缺 ledger'],
      [{ ...good, ledger: { name: '' } }, '账本名为空'],
      // 字段级：schema CHECK 会挡住这些值，但错误码必须是 400 而不是 500
      [{ ...good, expenses: [{ ...good.expenses[0], type: 'transfer' }] }, '未知 type'],
      [{ ...good, expenses: [{ ...good.expenses[0], amount_cents: 0 }] }, '金额非正'],
      [{ ...good, expenses: [{ ...good.expenses[0], amount_cents: '12' }] }, '金额非数字'],
      [{ ...good, expenses: [{ ...good.expenses[0], date: '2026/06/07' }] }, '日期格式'],
      [{ ...good, tags: [{ ...good.tags[0], is_unnamed: 7 }] }, 'is_unnamed 非 0/1'],
    ];
    for (const [snap, why] of bad) {
      assert.throws(() => svc.imports.importSnapshot(snap),
        (e) => e.code === 'INVALID_BACKUP', `应拒绝：${why}`);
    }
  });

  test('引用完整性：悬空 link / 找不到父 tag / 找不到维度 → BACKUP_INCOMPLETE', () => {
    const { svc } = setup();
    const src = seedSource(svc);
    const good = svc.exports.ledgerSnapshot(src.id);

    // ① link 指向不存在的 expense
    const danglingExpense = structuredClone(good);
    danglingExpense.expense_tag_links.push({ expense_id: 99999, tag_id: good.tags[0].id, role: 'secondary' });
    assert.throws(() => svc.imports.importSnapshot(danglingExpense),
      (e) => e.code === 'BACKUP_INCOMPLETE', '悬空 expense_id');

    // ② link 指向不存在的 tag
    const danglingTag = structuredClone(good);
    danglingTag.expense_tag_links.push({ expense_id: good.expenses[0].id, tag_id: 99999, role: 'secondary' });
    assert.throws(() => svc.imports.importSnapshot(danglingTag),
      (e) => e.code === 'BACKUP_INCOMPLETE', '悬空 tag_id');

    // ③ 副 tag 的父不在快照里
    const orphanSub = structuredClone(good);
    orphanSub.tags.find(t => t.name === '夜宵').parent_tag_id = 99999;
    assert.throws(() => svc.imports.importSnapshot(orphanSub),
      (e) => e.code === 'BACKUP_INCOMPLETE', '父 tag 悬空');

    // ④ tag 的维度不在快照里
    const orphanDim = structuredClone(good);
    orphanDim.tags[0].dimension_id = 99999;
    assert.throws(() => svc.imports.importSnapshot(orphanDim),
      (e) => e.code === 'BACKUP_INCOMPLETE', '维度悬空');
  });

  test('事务性：导入失败不留半个账本（账本数与 tag 数均不变）', () => {
    const { svc } = setup();
    const src = seedSource(svc);
    const good = svc.exports.ledgerSnapshot(src.id);
    const broken = structuredClone(good);
    broken.expense_tag_links.push({ expense_id: 99999, tag_id: good.tags[0].id, role: 'secondary' });

    const before = svc.ledgers.list().length;
    assert.throws(() => svc.imports.importSnapshot(broken), (e) => e.code === 'BACKUP_INCOMPLETE');
    assert.equal(svc.ledgers.list().length, before, '失败导入不新增账本');
    assert.equal(svc.exports.ledgerSnapshot(src.id).tags.length, good.tags.length, '既有数据零变化');
  });
});
