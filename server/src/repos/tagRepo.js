// 维度 + tag 数据访问（账本内生效）
// tag 两级结构（v3）：parent_tag_id IS NULL = 主 tag（维度取值），非 NULL = 副 tag（主 tag 的细分）
//  - 主 tag 之间：同一维度内名称唯一
//  - 副 tag 之间：同一父下名称唯一；不同父下允许同名（餐饮→其他 与 交通通勤→其他 共存）
// 返回普通对象（剥离 node:sqlite 的 null-prototype）

/** tag 统一投影（避免各处手写列清单漂移） */
const TAG_COLS = 'id, ledger_id, dimension_id, name, is_unnamed, color, position, parent_tag_id';

export function createTagRepo(db) {
  const plain = (r) => (r ? { ...r } : null);
  const plainAll = (rs) => rs.map(r => ({ ...r }));

  return {
    /**
     * 账本维度列表（含每维全部 tag）。
     * 主/副 tag 平铺返回（均带 parent_tag_id），调用方按 parent_tag_id 组树。
     */
    dimensions(ledgerId) {
      const dims = plainAll(db.prepare(
        'SELECT id, key, name, position, required FROM dimensions WHERE ledger_id = ? ORDER BY position, id'
      ).all(ledgerId));
      const tags = plainAll(db.prepare(
        `SELECT ${TAG_COLS} FROM tags WHERE ledger_id = ? ORDER BY position, id`
      ).all(ledgerId));
      for (const d of dims) d.tags = tags.filter(t => t.dimension_id === d.id);
      return dims;
    },

    /** 取维度（按 key） */
    dimensionByKey(ledgerId, key) {
      return plain(db.prepare(
        'SELECT id, key, name, required FROM dimensions WHERE ledger_id = ? AND key = ?'
      ).get(ledgerId, key));
    },

    /** 取 tag（按 id） */
    tagById(ledgerId, id) {
      return plain(db.prepare(
        `SELECT ${TAG_COLS} FROM tags WHERE id = ? AND ledger_id = ?`
      ).get(id, ledgerId));
    },

    /**
     * 取**主 tag**（按维度 + 名称）。只匹配根级（parent_tag_id IS NULL）——
     * 记账 primary 解析用，避免子 tag 冒充维度的主取值。
     */
    rootTagByName(ledgerId, dimensionKey, name) {
      return plain(db.prepare(
        `SELECT t.id, t.ledger_id, t.dimension_id, t.name, t.is_unnamed, t.color, t.parent_tag_id
         FROM tags t JOIN dimensions d ON d.id = t.dimension_id
         WHERE t.ledger_id = ? AND d.key = ? AND t.name = ? AND t.parent_tag_id IS NULL`
      ).get(ledgerId, dimensionKey, name));
    },

    /** 全维度按名称查（含主/副；可能歧义 → 返回数组，由调用方处理） */
    findByName(ledgerId, name) {
      return plainAll(db.prepare(
        `SELECT ${TAG_COLS} FROM tags WHERE ledger_id = ? AND name = ?`
      ).all(ledgerId, name));
    },

    /** 某主 tag 下的副 tag 列表（按 position 排序） */
    childrenOf(ledgerId, parentTagId) {
      return plainAll(db.prepare(
        `SELECT ${TAG_COLS} FROM tags WHERE ledger_id = ? AND parent_tag_id = ? ORDER BY position, id`
      ).all(ledgerId, parentTagId));
    },

    /** 维度内特殊默认「未标注」主 tag */
    unnamedTag(ledgerId, dimensionKey) {
      return plain(db.prepare(
        `SELECT t.id, t.dimension_id, t.name, t.is_unnamed, t.parent_tag_id
         FROM tags t JOIN dimensions d ON d.id = t.dimension_id
         WHERE t.ledger_id = ? AND d.key = ? AND t.is_unnamed = 1 AND t.parent_tag_id IS NULL`
      ).get(ledgerId, dimensionKey));
    },

    /** 建维度（required=1 表示该维每笔必填主 tag，如品类） */
    createDimension(ledgerId, key, name, position = 0, required = 0) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO dimensions (ledger_id, key, name, position, required) VALUES (?, ?, ?, ?, ?)'
      ).run(ledgerId, key, name, position, required ? 1 : 0);
      return Number(lastInsertRowid);
    },

    /**
     * 建 tag。
     * @param {number|null} [opts.parentTagId] null = 主 tag（维度取值）；非 null = 该主 tag 下的副 tag
     */
    createTag(ledgerId, dimensionId, name, { isUnnamed = 0, color = null, position = 0, parentTagId = null } = {}) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO tags (ledger_id, dimension_id, name, is_unnamed, color, position, parent_tag_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(ledgerId, dimensionId, name, isUnnamed ? 1 : 0, color, position, parentTagId);
      return Number(lastInsertRowid);
    },

    /**
     * 改 tag 名/色（部分更新）。undefined = 不改；color: null = 显式清除覆盖色。
     * @param {number} id
     * @param {{name?: string, color?: string|null}} fields
     */
    updateTag(id, { name, color } = {}) {
      if (name !== undefined) db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id);
      if (color !== undefined) db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(color, id);
    },

    /** 删 tag（仅未引用 tag 可删；service 层先做 TAG_IN_USE/锁定校验） */
    removeTag(id) {
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    },

    /** tag 被花销引用数（primary/secondary 合计）——删除保护依据 */
    referenceCount(tagId) {
      const r = db.prepare(
        'SELECT COUNT(*) AS n FROM expense_tag_links WHERE tag_id = ?'
      ).get(tagId);
      return Number(r.n);
    },

    /**
     * 同一作用域内是否已存在同名 tag（改名/建 tag 查重用）。
     * 作用域 = (维度, 父)：parentTagId 为 null 时查根级主 tag，否则查该父下的副 tag。
     * @param {number|null} parentTagId
     */
    nameExistsUnder(dimensionId, parentTagId, name, exceptTagId = null) {
      const args = [];
      let sql = 'SELECT COUNT(*) AS n FROM tags WHERE dimension_id = ?';
      args.push(dimensionId);
      if (parentTagId === null || parentTagId === undefined) {
        sql += ' AND parent_tag_id IS NULL';
      } else {
        sql += ' AND parent_tag_id = ?';
        args.push(parentTagId);
      }
      sql += ' AND name = ?';
      args.push(name);
      if (exceptTagId !== null && exceptTagId !== undefined) {
        sql += ' AND id != ?';
        args.push(exceptTagId);
      }
      return Number(db.prepare(sql).get(...args).n) > 0;
    },
  };
}
