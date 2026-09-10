// 双驱动一致性：同一套 core 业务规则，分别跑在 Node 的 node:sqlite 与浏览器的 sql.js 上，
// 断言两者产出**完全相同**的数据。
// 这是纯前端版的正确性保证 —— 业务规则只有一份，换了引擎结果不能变；
// 而且它跑在 CI 里，不必靠浏览器手测（浏览器里只有 UI 与存储两条路径需要人眼确认）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../server/src/db/database.js';
import { migrate } from '../../core/schema.js';
import { openBrowserDatabase } from '../sqlite-browser.js';
import { createLedgerService } from '../../core/services/ledgerService.js';
import { createTagService } from '../../core/services/tagService.js';
import { createExpenseService } from '../../core/services/expenseService.js';
import { createReportService } from '../../core/services/reportService.js';
import { createExportService } from '../../core/services/exportService.js';
import { createImportService } from '../../core/services/importService.js';

function fullServices(db) {
  return {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    reports: createReportService(db),
    exports: createExportService(db),
    imports: createImportService(db),
  };
}

/** 同一段业务操作（覆盖建账本 / 两级 tag / 记一笔 / 统计 / 导出），两种驱动各跑一遍 */
function scenario(svc) {
  const l = svc.ledgers.create('生活费');
  const dims = svc.tags.dimensions(l.id);
  const food = dims.find((d) => d.key === 'category').tags.find((t) => t.name === '餐饮');
  svc.tags.create(l.id, { dimensionKey: 'category', name: '夜宵', parentTagId: food.id });
  svc.tags.create(l.id, { dimensionKey: 'category', name: '收入·生活费' });
  svc.expenses.add({
    ledgerId: l.id, amountCents: 4560, date: '2026-06-07', note: '撸串',
    primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'],
  });
  svc.expenses.add({ ledgerId: l.id, type: 'income', amountCents: 50000, date: '2026-06-01', primary: { category: '收入·生活费' } });
  svc.expenses.add({ ledgerId: l.id, amountCents: 1200, date: '2026-06-06', primary: { category: '交通', context: '通勤' } });
  return {
    snap: svc.exports.ledgerSnapshot(l.id),
    view: svc.reports.windowView(l.id, { from: '2026-06-01', to: '2026-06-30' }),
  };
}

/** 去掉时间戳再比较：created_at 由 datetime('now') 生成，两种驱动跑起来可能差一秒 */
function strip(snap) {
  const clean = structuredClone(snap);
  delete clean.exportedAt;
  if (clean.ledger) delete clean.ledger.created_at;
  for (const e of clean.expenses || []) delete e.created_at;
  return clean;
}

describe('浏览器 SQLite 驱动（sql.js）与 node:sqlite 的一致性', () => {
  test('同一段业务操作，两种驱动产出逐字段相同的数据（含窗口函数统计）', async () => {
    const nodeDb = openDatabase(':memory:');
    migrate(nodeDb);
    const web = await openBrowserDatabase();
    migrate(web);

    const a = scenario(fullServices(nodeDb));
    const b = scenario(fullServices(web));

    assert.deepEqual(strip(b.snap), strip(a.snap), '导出的快照应逐字段相同');
    assert.deepEqual(b.view, a.view, '统计视图（含按金额取主导 tag 的窗口函数）应相同');
    assert.equal(a.view.totals.expense, 5760);
    assert.equal(a.view.totals.income, 50000);

    nodeDb.close();
    web.close();
  });

  test('迁移结果一致：schema 版本与表清单相同', async () => {
    const nodeDb = openDatabase(':memory:');
    migrate(nodeDb);
    const web = await openBrowserDatabase();
    migrate(web);

    const versionOf = (db) => db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
    const tablesOf = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);

    assert.equal(versionOf(web), versionOf(nodeDb));
    assert.deepEqual(tablesOf(web), tablesOf(nodeDb));

    nodeDb.close();
    web.close();
  });

  test('事务在浏览器驱动上同样能回滚：记账失败不留残留', async () => {
    const web = await openBrowserDatabase();
    migrate(web);
    const svc = fullServices(web);
    const l = svc.ledgers.create('回滚测试');
    const before = svc.exports.ledgerSnapshot(l.id).expenses.length;

    // 副 tag 不存在 → 记账整体失败
    assert.throws(() => svc.expenses.add({
      ledgerId: l.id, amountCents: 100, date: '2026-06-01',
      primary: { category: '餐饮' }, tags: ['根本不存在的副标签'],
    }));

    assert.equal(svc.exports.ledgerSnapshot(l.id).expenses.length, before, '失败记账应整体回滚');
    web.close();
  });

  test('跨驱动互通：node:sqlite 导出的备份能在 sql.js 里导入', async () => {
    const nodeDb = openDatabase(':memory:');
    migrate(nodeDb);
    const src = scenario(fullServices(nodeDb));

    const web = await openBrowserDatabase();
    migrate(web);
    const webSvc = fullServices(web);
    const out = webSvc.imports.importSnapshot(src.snap);
    const dst = webSvc.exports.ledgerSnapshot(out.ledger.id);

    assert.equal(dst.expenses.length, src.snap.expenses.length);
    assert.deepEqual(
      dst.expenses.map((e) => [e.type, e.amount_cents, e.date]).sort(),
      src.snap.expenses.map((e) => [e.type, e.amount_cents, e.date]).sort()
    );
    nodeDb.close();
    web.close();
  });

  test('导出的字节能重新打开（持久化的基础）', async () => {
    const web = await openBrowserDatabase();
    migrate(web);
    fullServices(web).ledgers.create('持久化测试');
    const bytes = web.export();
    assert.ok(bytes.length > 0, '应当导出了非空字节');

    const reopened = await openBrowserDatabase(bytes);
    const names = reopened.prepare('SELECT name FROM ledgers').all().map((r) => r.name);
    assert.deepEqual(names, ['持久化测试'], '重新打开后数据还在');

    web.close();
    reopened.close();
  });
});
