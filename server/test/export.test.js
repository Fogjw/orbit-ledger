// 导出（备份）测试：账本 JSON 快照结构 / 全量 / 隔离 / API
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createExportService } from '../src/services/exportService.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    exports: createExportService(db),
  };
  return { db, svc };
}

describe('导出（S3-3：账本 JSON 全量快照）', () => {
  test('快照结构：format/version/exportedAt + 五表扁平全量', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('生活费');
    // 副 tag 须挂在主 tag 下（v3）：夜宵 → 餐饮
    const food = svc.tags.dimensions(l.id).find(d => d.key === 'category').tags.find(t => t.name === '餐饮');
    svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', parentTagId: food.id });
    svc.tags.create(l.id, { dimensionKey: 'category', name: '收入·生活费' });
    svc.expenses.add({ ledgerId: l.id, amountCents: 4560, date: '2026-06-07', note: '撸串', primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'] });
    svc.expenses.add({ ledgerId: l.id, type: 'income', amountCents: 50000, date: '2026-06-01', primary: { category: '收入·生活费' } });

    const snap = svc.exports.ledgerSnapshot(l.id);
    assert.equal(snap.format, 'orbit-ledger-backup');
    assert.equal(snap.version, 1);
    assert.ok(typeof snap.exportedAt === 'string' && snap.exportedAt.length > 0);
    // 扁平五表 + 账本单行
    assert.deepEqual(Object.keys(snap).sort(),
      ['dimensions', 'expense_tag_links', 'expenses', 'exportedAt', 'format', 'ledger', 'tags', 'version']);
    assert.equal(snap.ledger.id, l.id);
    assert.equal(snap.ledger.name, '生活费');
    assert.equal(snap.dimensions.length, 2, '品类+情境两维');
    // tags：默认维度 10（品类6 + 情境4，**不预设占位**）+ 夜宵（餐饮副 tag）+ 收入·生活费 = 12
    // 另加记账缺省兜底按需创建的 4 个「未分类」占位：
    //   和朋友→未分类（情境副）、收入·生活费→未分类（品类副）、
    //   情境维的「收入·未分类」主 tag（收入的缺省占位，前缀让它按收入类目渲染）、
    //   以及它下面的「未分类」副 tag。
    // 注意收入的缺省占位是「收入·未分类」而不是「未分类」——两者并存、分别收纳。
    assert.equal(snap.tags.length, 16);
    assert.equal(snap.tags.filter(t => t.is_unnamed === 1).length, 4, '占位 tag 均为 is_unnamed=1');
    // 未记账时账本里没有任何占位 tag（懒创建，不预设）
    const fresh = svc.ledgers.create('空账本');
    assert.equal(svc.tags.dimensions(fresh.id).flatMap(d => d.tags).length, 10, '新账本只有种子 tag');
    // 副 tag 的父子关系随快照导出（import 可回插）
    const snackRow = snap.tags.find(t => t.name === '夜宵');
    assert.equal(snackRow.parent_tag_id, food.id, '副 tag 带父引用导出');
    assert.equal(snap.tags.find(t => t.name === '餐饮').parent_tag_id, null, '主 tag 无父');
    assert.equal(snap.expenses.length, 2);
    // links：每笔 category primary + context primary（含未标注）+ 副 tag
    const e1 = snap.expenses.find(e => e.amount_cents === 4560);
    const linksOf1 = snap.expense_tag_links.filter(x => x.expense_id === e1.id);
    assert.equal(linksOf1.filter(x => x.role === 'primary').length, 2, '每维一个 primary');
    assert.ok(linksOf1.some(x => x.role === 'secondary'), '副 tag link 导出');
    // 花销不含派生 tags 数组（保持扁平，import 可回插）
    assert.equal(Array.isArray(e1.tags), false);
  });

  test('导出数据自洽：快照可重算各维 Σ=总额', () => {
    const { svc } = setup();
    const l = svc.ledgers.create('X');
    svc.expenses.add({ ledgerId: l.id, amountCents: 3500, date: '2026-06-05', primary: { category: '餐饮' } });
    svc.expenses.add({ ledgerId: l.id, amountCents: 1200, date: '2026-06-06', primary: { category: '交通', context: '通勤' } });
    const snap = svc.exports.ledgerSnapshot(l.id);
    const dimKeyOf = (tagId) => snap.dimensions.find(d => d.id === snap.tags.find(t => t.id === tagId)?.dimension_id)?.key;
    let total = 0;
    const perDim = {};
    for (const e of snap.expenses) {
      total += e.amount_cents;
      for (const link of snap.expense_tag_links.filter(x => x.expense_id === e.id && x.role === 'primary')) {
        const k = dimKeyOf(link.tag_id);
        perDim[k] = (perDim[k] ?? 0) + e.amount_cents;
      }
    }
    assert.equal(total, 4700);
    for (const k of ['category', 'context']) {
      assert.equal(perDim[k], total, `快照中 ${k} 维 Σ=总额`);
    }
    const unnamed = snap.tags.find(t => t.is_unnamed === 1);
    assert.equal(unnamed.name, '未分类');
  });

  test('跨账本导出隔离 + 不存在账本 → null', () => {
    const { svc } = setup();
    const a = svc.ledgers.create('A');
    const b = svc.ledgers.create('B');
    svc.expenses.add({ ledgerId: a.id, amountCents: 111, date: '2026-06-01', primary: { category: '餐饮' } });
    svc.expenses.add({ ledgerId: b.id, amountCents: 222, date: '2026-06-01', primary: { category: '餐饮' } });
    const snapA = svc.exports.ledgerSnapshot(a.id);
    assert.equal(snapA.expenses.length, 1);
    assert.equal(snapA.expenses[0].amount_cents, 111);
    assert.equal(svc.exports.ledgerSnapshot(99999), null);
  });
});
