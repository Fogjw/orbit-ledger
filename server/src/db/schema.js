// Schema 版本化迁移 —— 对齐需求基线 §2/§3（正交多维度，账本顶级隔离 D-07）
// 设计（D-12）：
//  - 每个 schema 演进 = 一个迁移 { version, name, up(db) }，顺序追加，绝不修改已发布版本
//  - migrate(db)：读 schema_version 当前版本 → 事务内逐个应用更高版本并记录
//  - v1 用 CREATE TABLE IF NOT EXISTS（幂等）⇒ 既有旧库（无版本表）升级时无副作用地纳入 v1
// 五表：ledgers / dimensions / tags / expenses / expense_tag_links
// 核心不变量：每笔每维恰一 primary ⇒ 每维 Σ=总额；金额以「分」存储

const DDL_V1 = `
CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dimensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key IN ('category','context','payment')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ledger_id, key)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_unnamed INTEGER NOT NULL DEFAULT 0 CHECK (is_unnamed IN (0,1)),
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (dimension_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_ledger_date ON expenses(ledger_id, date);

CREATE TABLE IF NOT EXISTS expense_tag_links (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'secondary' CHECK (role IN ('primary','secondary')),
  PRIMARY KEY (expense_id, tag_id, role)
);
CREATE INDEX IF NOT EXISTS idx_links_tag ON expense_tag_links(tag_id);
CREATE INDEX IF NOT EXISTS idx_links_expense ON expense_tag_links(expense_id);
`;

/**
 * 迁移序列（只追加、不改已发布项）。version 唯一且递增。
 * @type {{version:number, name:string, up:(db:import('node:sqlite').DatabaseSync)=>void}[]}
 */
export const MIGRATIONS = [
  {
    version: 1,
    name: '五表初版（账本/维度/tag/花销/关联，金额分存储）',
    up(db) { db.exec(DDL_V1); },
  },
  {
    version: 2,
    name: 'dimensions.required：维度必填数据化（回填品类必填）',
    up(db) {
      db.exec("ALTER TABLE dimensions ADD COLUMN required INTEGER NOT NULL DEFAULT 0");
      db.exec("UPDATE dimensions SET required = 1 WHERE key = 'category'");
    },
  },
];

/** 当前 schema 最新版本 */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

import { transaction } from './database.js';

/**
 * 应用迁移至最新版本（幂等，可重复调用）。
 * 升级流程：确保版本表 → 读当前版本 → 逐个应用更高版本（每版单事务 + 记录）。
 * 旧库兼容：无版本表但已有 v1 表 ⇒ 版本视为 0，v1 的 IF NOT EXISTS 幂等纳入，继续升 v2+。
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const current = row?.v ?? 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    transaction(db, () => {
      m.up(db);
      db.prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
  }
}
