// 迁移机制测试：版本化升级 / 幂等 / 旧库兼容 / v2 required 列 / v3 tags 两级化（表重建）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate, MIGRATIONS } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';

/** 全部迁移版本号，直接从迁移表推导 —— 以后再加迁移，这些断言不用跟着改 */
const ALL_VERSIONS = MIGRATIONS.map(m => m.version);

function versionRows(db) {
  return db.prepare('SELECT version FROM schema_version ORDER BY version').all().map(r => r.version);
}

describe('schema 版本化迁移（S3-1/S3-2/S6-v3）', () => {
  test('全新库 migrate → 迁移全部应用，v2/v3 列就位', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    assert.deepEqual(versionRows(db), ALL_VERSIONS, 'schema_version 记录全部迁移');
    // v2 加的列
    const cols = db.prepare('PRAGMA table_info(dimensions)').all().map(c => c.name);
    assert.ok(cols.includes('required'), 'v2 迁移为 dimensions 增加 required 列');
    // v3 加的列
    const tagCols = db.prepare('PRAGMA table_info(tags)').all().map(c => c.name);
    assert.ok(tagCols.includes('parent_tag_id'), 'v3 迁移为 tags 增加 parent_tag_id 列');
  });

  test('migrate 幂等：重复调用不重复应用、不报错', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    migrate(db);
    assert.deepEqual(versionRows(db), ALL_VERSIONS, '重复 migrate 版本行不增加');
  });

  test('旧库兼容升级：只跑到 v1 的库（无 required 列）→ migrate 补到最新且数据保留', () => {
    const db = openDatabase(':memory:');
    // 模拟旧库：只应用 v1（五表初版，无 required 列）
    MIGRATIONS[0].up(db);
    const preCols = db.prepare('PRAGMA table_info(dimensions)').all().map(c => c.name);
    assert.equal(preCols.includes('required'), false, 'v1 表无 required 列（旧库形态）');
    const hasVer = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).get();
    assert.equal(hasVer.n, 0, '旧库无 schema_version 表（尚未纳入版本管理）');

    // 用裸 SQL 造 v1 时代数据（绕过依赖 required 列的新版 service）
    const { lastInsertRowid: ledgerId } = db.prepare('INSERT INTO ledgers (name) VALUES (?)').run('旧账本');
    const insDim = db.prepare('INSERT INTO dimensions (ledger_id, key, name, position) VALUES (?, ?, ?, ?)');
    insDim.run(ledgerId, 'category', '品类', 0);
    insDim.run(ledgerId, 'context', '情境', 1);

    migrate(db); // 升级
    assert.deepEqual(versionRows(db), ALL_VERSIONS);
    // 数据保留
    const row = db.prepare('SELECT COUNT(*) AS n FROM ledgers').get();
    assert.equal(row.n, 1);
    // v2 回填：category required=1，context=0
    const dims = db.prepare('SELECT key, required FROM dimensions ORDER BY key').all();
    const byKey = Object.fromEntries(dims.map(d => [d.key, d.required]));
    assert.equal(byKey.category, 1, 'v2 回填 category.required=1');
    assert.equal(byKey.context, 0);
  });
});

// v3 是表重建类迁移（tags 表 DROP + 重建），风险点是「重建是否损坏既有数据与关联」。
// 这里独立造一个 v2 时代的库（含 tag 与 links），升级后逐项核对。
describe('v3 tags 两级化迁移（表重建安全性）', () => {
  /** 造一个 stops-at-v2 的库：应用 v1+v2 DDL，再用裸 SQL 写入代表性数据 */
  function makeV2Db() {
    const db = openDatabase(':memory:');
    MIGRATIONS[0].up(db);
    MIGRATIONS[1].up(db);
    // 标记为「已升级到 v2」：否则 migrate 会从版本 0 重跑 v2，
    // 其 ALTER TABLE ADD COLUMN 会因 required 已存在而报 duplicate column。
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec("INSERT INTO schema_version (version, name) VALUES (1, 'v1'), (2, 'v2');");

    const { lastInsertRowid: ledgerId } = db.prepare('INSERT INTO ledgers (name) VALUES (?)').run('生活费');
    const insDim = db.prepare('INSERT INTO dimensions (ledger_id, key, name, position, required) VALUES (?, ?, ?, ?, ?)');
    const catDim = Number(insDim.run(ledgerId, 'category', '品类', 0, 1).lastInsertRowid);
    const ctxDim = Number(insDim.run(ledgerId, 'context', '情境', 1, 0).lastInsertRowid);
    const insTag = db.prepare(
      'INSERT INTO tags (ledger_id, dimension_id, name, is_unnamed, color, position) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const food = Number(insTag.run(ledgerId, catDim, '餐饮', 0, '#ff8800', 0).lastInsertRowid);
    const unnamedCtx = Number(insTag.run(ledgerId, ctxDim, '未标注', 1, null, 999).lastInsertRowid);

    const { lastInsertRowid: expId } = db.prepare(
      "INSERT INTO expenses (ledger_id, type, amount_cents, date, note) VALUES (?, 'expense', 4560, '2026-06-07', '撸串')"
    ).run(ledgerId);
    const insLink = db.prepare('INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, ?)');
    insLink.run(expId, food, 'primary');
    insLink.run(expId, unnamedCtx, 'primary');

    return { db, ledgerId: Number(ledgerId), expId: Number(expId), food, unnamedCtx, catDim, ctxDim };
  }

  test('升级后：行数/id/关联全部不变（links 未被 ON DELETE CASCADE 误删）', () => {
    const { db, ledgerId, expId, food, unnamedCtx, catDim, ctxDim } = makeV2Db();
    const beforeTags = db.prepare('SELECT id, name FROM tags ORDER BY id').all().map(r => ({ ...r }));
    const beforeLinks = db.prepare('SELECT COUNT(*) AS n FROM expense_tag_links').get().n;

    migrate(db);

    assert.deepEqual(versionRows(db), ALL_VERSIONS);
    // tags 内容与 id 原样保留
    const afterTags = db.prepare('SELECT id, name FROM tags ORDER BY id').all().map(r => ({ ...r }));
    assert.deepEqual(afterTags, beforeTags, 'tags 行与 id 不变');
    // 关联未被级联删除（重建期间 foreign_keys=OFF 的关键收益）
    const afterLinks = db.prepare('SELECT COUNT(*) AS n FROM expense_tag_links').get().n;
    assert.equal(afterLinks, beforeLinks, 'expense_tag_links 行数不变');
    assert.equal(afterLinks, 2);
    // 外键完整性
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, '无悬空外键');
    // 既有 tag 全部为主 tag（parent_tag_id 为空）
    const parents = db.prepare('SELECT parent_tag_id FROM tags').all().map(r => r.parent_tag_id);
    assert.ok(parents.every(p => p === null), '迁移后既有 tag 均为根级主 tag');
    // 字段延续性
    const t = db.prepare('SELECT color, dimension_id FROM tags WHERE id = ?').get(food);
    assert.equal(t.color, '#ff8800', 'color 保留');
    assert.equal(t.dimension_id, catDim, 'dimension_id 保留');
    // 花销仍可读
    const e = db.prepare('SELECT amount_cents, note, ledger_id FROM expenses WHERE id = ?').get(expId);
    assert.equal(e.amount_cents, 4560);
    assert.equal(e.note, '撸串');
    assert.equal(e.ledger_id, ledgerId);
    assert.ok(ctxDim > 0 && unnamedCtx > 0);
  });

  test('升级后 autoincrement 不冲突：新 tag id 大于既有最大 id', () => {
    const { db, ledgerId, catDim } = makeV2Db();
    migrate(db);
    const maxId = db.prepare('SELECT MAX(id) AS m FROM tags').get().m;
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO tags (ledger_id, dimension_id, name, position) VALUES (?, ?, '午餐', 0)"
    ).run(ledgerId, catDim);
    assert.ok(Number(lastInsertRowid) > Number(maxId), 'AUTOINCREMENT 序列未回退');
  });

  test('升级后外键约束恢复开启（不留 OFF 状态）', () => {
    const { db } = makeV2Db();
    migrate(db);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'migrate 结束后 foreign_keys 应恢复 ON');
  });

  test('新唯一约束：同父下同名拒绝，不同主 tag 下同名允许', () => {
    const { db, ledgerId, catDim } = makeV2Db();
    migrate(db);
    const ins = db.prepare('INSERT INTO tags (ledger_id, dimension_id, name, parent_tag_id, position) VALUES (?, ?, ?, ?, ?)');
    const food = Number(db.prepare("SELECT id FROM tags WHERE name = '餐饮'").get().id);
    const traffic = Number(ins.run(ledgerId, catDim, '交通通勤', null, 1).lastInsertRowid);

    // 不同父下同名 → 允许（餐饮→其他 与 交通通勤→其他 共存）
    ins.run(ledgerId, catDim, '其他', food, 0);
    ins.run(ledgerId, catDim, '其他', traffic, 0);

    // 同一父下同名 → 拒绝
    assert.throws(
      () => ins.run(ledgerId, catDim, '其他', food, 1),
      /UNIQUE|constraint/i,
      '同一主 tag 下不允许同名子 tag'
    );
    // 根级之间同名 → 同样拒绝
    assert.throws(
      () => ins.run(ledgerId, catDim, '交通通勤', null, 2),
      /UNIQUE|constraint/i,
      '根级主 tag 之间不允许同名'
    );
  });

  test('v3 迁移后 service 可正常建账本并读到新列', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const ledgers = createLedgerService(db);
    const l = ledgers.create('新账本');
    const dims = db.prepare('SELECT key FROM dimensions WHERE ledger_id = ? ORDER BY position').all(l.id);
    assert.deepEqual(dims.map(d => d.key), ['category', 'context']);
    const parentNull = db.prepare(
      'SELECT COUNT(*) AS n FROM tags WHERE ledger_id = ? AND parent_tag_id IS NOT NULL'
    ).get(l.id).n;
    assert.equal(parentNull, 0, '默认维度建的 tag 均为主 tag');
  });
});

// v4：收入与情境维度解耦。老库里收入笔挂着 context/未分类（那时记账给每维都补占位），
// 结果是那笔收入会从「情景视图 → 未分类」里冒出来。迁移只清收入的 context 关联。
describe('v4 收入与情境解耦迁移', () => {
  test('清掉历史收入笔上的 context 关联，支出的关联原样保留', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const ledgers = createLedgerService(db);
    const tagSvc = createTagService(db);
    const expenses = createExpenseService(db);
    const l = ledgers.create('L');
    const inc = expenses.add({ ledgerId: l.id, type: 'income', amountCents: 100, date: '2026-09-01' });
    const exp = expenses.add({ ledgerId: l.id, amountCents: 200, date: '2026-09-02', primary: { category: '餐饮' } });
    const ctxDim = tagSvc.dimensions(l.id).find(d => d.key === 'context');
    const ctxUnnamed = ctxDim.tags.find(t => t.is_unnamed === 1 && t.name === '未分类');
    assert.ok(ctxUnnamed, '支出那笔会按需建出 context/未分类');

    // 手工补一条「老库遗留」的关联：v3 及更早，收入也会挂上 context/未分类
    db.prepare('INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, ?)')
      .run(inc.id, ctxUnnamed.id, 'primary');
    const ctxLinksOf = (id) => db.prepare(`
      SELECT COUNT(*) AS n FROM expense_tag_links l
        JOIN tags t ON t.id = l.tag_id JOIN dimensions d ON d.id = t.dimension_id
       WHERE l.expense_id = ? AND d.key = 'context'`).get(id).n;
    assert.equal(ctxLinksOf(inc.id), 1, '迁移前：收入也挂着情境');

    // 抹掉 v4 记录再迁移，等价于「用新版本打开一个老库」
    db.prepare('DELETE FROM schema_version WHERE version = 4').run();
    migrate(db);
    assert.equal(ctxLinksOf(inc.id), 0, '迁移后：收入的 context 关联被清掉');
    assert.equal(ctxLinksOf(exp.id), 2, '支出的 context 关联不受影响（primary + 副占位各一条）');
    assert.ok(versionRows(db).includes(4), 'v4 重新记录在案');
  });
});
