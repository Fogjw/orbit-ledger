// Schema DDL —— 对齐需求基线 §2/§3（正交多维度，账本顶级隔离 D-07）
// 五表：ledgers / dimensions / tags / expenses / expense_tag_links
// 设计要点：
//  - 花销 = 事实表；维度各自独立（互斥取值、维间正交）⇒ 每维 Σ=总额永远正确
//  - 每笔花销每维恰好一个 primary tag（context 未选 ⇒ 特殊「未标注」tag）
//  - 副 tag（secondary）多选，跨维关联
//  - 金额以「分」存储（amount_cents），杜绝浮点误差
const DDL = `
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
 * 应用 schema（幂等）。并发/恢复：DDL 单次执行；数据写入走 service 事务。
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function migrate(db) {
  db.exec(DDL);
}
