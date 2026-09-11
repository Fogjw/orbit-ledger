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

// v3：tags 两级化——副 tag 绑定主 tag（parent_tag_id 自引用，NULL = 主 tag）
// 业务规则（对齐需求基线 §4 L3「分类内 花销×标签 二部图」）：
//  - 主 tag = 维度取值（餐饮 / 交通通勤），每笔每维恰一个 primary
//  - 副 tag = 主 tag 的下级细分（餐饮 → 早餐/午餐/晚餐），只能挂在本笔同维主 tag 下
//  - 维度之间完全独立：品类维的主/副 tag 与情境维互不相干
// 为何重建表：原表级约束 UNIQUE (dimension_id, name) 会阻止「餐饮→其他」与「交通→其他」共存，
// 而 SQLite 无法直接删除表级约束，须走官方「建新表 → 拷贝 → 删旧表 → 改名」流程。
// 自引用外键写新表名 tags_v3，RENAME 时 SQLite 会自动改写为 tags(id)。
// 注：本迁移须在 PRAGMA foreign_keys=OFF 下执行（见 MIGRATIONS.foreignKeysOff），
// 否则 DROP TABLE tags 会经 ON DELETE CASCADE 连带清空 expense_tag_links。
const DDL_V3 = `
CREATE TABLE tags_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_unnamed INTEGER NOT NULL DEFAULT 0 CHECK (is_unnamed IN (0,1)),
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  parent_tag_id INTEGER REFERENCES tags_v3(id) ON DELETE CASCADE
);

INSERT INTO tags_v3 (id, ledger_id, dimension_id, name, is_unnamed, color, position, parent_tag_id)
  SELECT id, ledger_id, dimension_id, name, is_unnamed, color, position, NULL FROM tags;

DROP TABLE tags;
ALTER TABLE tags_v3 RENAME TO tags;

-- 同父下名称唯一（取代原「同维度内唯一」）：不同主 tag 下允许同名子 tag
CREATE UNIQUE INDEX IF NOT EXISTS ux_tags_parent_name
  ON tags(dimension_id, IFNULL(parent_tag_id, -1), name);
`;

/**
 * 迁移序列（只追加、不改已发布项）。version 唯一且递增。
 * foreignKeysOff: true 表示该迁移需临时关闭外键（表重建类迁移专用）。
 * @type {{version:number, name:string, up:(db:import('node:sqlite').DatabaseSync)=>void, foreignKeysOff?:boolean}[]}
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
  {
    version: 3,
    name: 'tags 两级化：副 tag 绑定主 tag（parent_tag_id 自引用 + 同父唯一）',
    foreignKeysOff: true,
    up(db) {
      db.exec(DDL_V3);
      // 重建后校验：任一外键悬空即中止本迁移（事务回滚，库保持原样）
      const dangling = db.prepare('PRAGMA foreign_key_check').all();
      if (dangling.length > 0) {
        throw new Error(`v3 迁移外键校验失败：${JSON.stringify(dangling)}`);
      }
    },
  },
  {
    version: 4,
    name: '收入与情境维度解耦：清掉历史收入笔上的 context 关联',
    up(db) {
      // 情境表达的是「和谁、在什么场合花的钱」，收入没有这个语义；早先记账给收入也补了
      // context/未分类，于是那笔收入会从「情景视图 → 未分类」里冒出来。新记账已不再挂
      // context（见 expenseService.plan），这里把历史数据一并清干净 —— 只删收入的 context
      // 关联，支出与其它维度一律不动。
      db.exec(`
        DELETE FROM expense_tag_links
         WHERE tag_id IN (
                 SELECT t.id FROM tags t JOIN dimensions d ON d.id = t.dimension_id
                  WHERE d.key = 'context')
           AND expense_id IN (SELECT id FROM expenses WHERE type = 'income')
      `);
    },
  },
  {
    version: 5,
    name: '收入的每个维度都要有归属：补回 context 的「收入·未分类」占位',
    up(db) {
      // v4 把收入的 context 关联清掉了（当时的判断是「收入没有情境语义」），但那让收入在
      // 情景维度里彻底没有归属 —— 比原来更不直观（用户：应该自动建一个收入未分类来容纳它）。
      // 正解是：收入在**每个维度**都用「收入·未分类」占位，与支出的「未分类」同机制、分开收纳；
      // 前缀还让它天然被认成收入类目，渲染成四角星。
      // 这里按新规则把每笔收入的 context 归属补回来：主占位「收入·未分类」+ 它的副占位。
      const INCOME_UNNAMED = '收入·未分类';
      const ledgers = db.prepare('SELECT DISTINCT ledger_id AS ledgerId FROM expenses WHERE type = ?').all('income');
      for (const { ledgerId } of ledgers) {
        const dim = db.prepare("SELECT id FROM dimensions WHERE ledger_id = ? AND key = 'context'").get(ledgerId);
        if (!dim) continue;
        const ensure = (name, parentTagId) => {
          const found = parentTagId === null
            ? db.prepare('SELECT id FROM tags WHERE ledger_id = ? AND dimension_id = ? AND parent_tag_id IS NULL AND name = ?').get(ledgerId, dim.id, name)
            : db.prepare('SELECT id FROM tags WHERE ledger_id = ? AND dimension_id = ? AND parent_tag_id = ? AND name = ?').get(ledgerId, dim.id, parentTagId, name);
          if (found) return Number(found.id);
          const { lastInsertRowid } = db.prepare(
            'INSERT INTO tags (ledger_id, dimension_id, name, is_unnamed, color, position, parent_tag_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(ledgerId, dim.id, name, 1, null, 999, parentTagId);
          return Number(lastInsertRowid);
        };
        const mainId = ensure(INCOME_UNNAMED, null);
        const subId = ensure('未分类', mainId);
        const link = db.prepare('INSERT INTO expense_tag_links (expense_id, tag_id, role) VALUES (?, ?, ?)');
        for (const e of db.prepare('SELECT id FROM expenses WHERE ledger_id = ? AND type = ?').all(ledgerId, 'income')) {
          const has = db.prepare('SELECT COUNT(*) AS n FROM expense_tag_links WHERE expense_id = ? AND tag_id = ?');
          if (has.get(e.id, mainId).n === 0) link.run(e.id, mainId, 'primary');
          if (has.get(e.id, subId).n === 0) link.run(e.id, subId, 'secondary');
        }
      }
    },
  },
];

/** 当前 schema 最新版本 */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

import { transaction } from './transaction.js';

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
    // 表重建类迁移需临时关闭外键：PRAGMA foreign_keys 在事务内是 no-op，只能在事务外切换
    if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF;');
    try {
      transaction(db, () => {
        m.up(db);
        db.prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)').run(m.version, m.name);
      });
    } finally {
      if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = ON;');
    }
  }
}
