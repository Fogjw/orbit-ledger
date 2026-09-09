// 迁移机制测试：版本化升级 / 幂等 / 旧库兼容 / v2 required 列落地
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate, MIGRATIONS } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';

function versionRows(db) {
  return db.prepare('SELECT version FROM schema_version ORDER BY version').all().map(r => r.version);
}

describe('schema 版本化迁移（S3-1/S3-2）', () => {
  test('全新库 migrate → 迁移全部应用（版本含 1、2），dimensions 带 required 列', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    assert.deepEqual(versionRows(db), [1, 2], 'schema_version 记录 v1、v2');
    // v2 加的列存在
    const cols = db.prepare('PRAGMA table_info(dimensions)').all().map(c => c.name);
    assert.ok(cols.includes('required'), 'v2 迁移为 dimensions 增加 required 列');
  });

  test('migrate 幂等：重复调用不重复应用、不报错', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    migrate(db);
    assert.deepEqual(versionRows(db), [1, 2], '重复 migrate 版本行不增加');
  });

  test('旧库兼容升级：只跑到 v1 的库（无 required 列）→ migrate 补到 v2 且数据保留', () => {
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
    assert.deepEqual(versionRows(db), [1, 2]);
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
