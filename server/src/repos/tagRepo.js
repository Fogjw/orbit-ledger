// 维度 + tag 数据访问（账本内生效）
// 返回普通对象（剥离 node:sqlite 的 null-prototype）

export function createTagRepo(db) {
  const plain = (r) => (r ? { ...r } : null);
  const plainAll = (rs) => rs.map(r => ({ ...r }));

  return {
    /** 账本维度列表（含每维 tags） */
    dimensions(ledgerId) {
      const dims = plainAll(db.prepare(
        'SELECT id, key, name, position FROM dimensions WHERE ledger_id = ? ORDER BY position, id'
      ).all(ledgerId));
      const tags = plainAll(db.prepare(
        'SELECT id, ledger_id, dimension_id, name, is_unnamed, color, position FROM tags WHERE ledger_id = ? ORDER BY position, id'
      ).all(ledgerId));
      for (const d of dims) d.tags = tags.filter(t => t.dimension_id === d.id);
      return dims;
    },

    /** 取维度（按 key） */
    dimensionByKey(ledgerId, key) {
      return plain(db.prepare(
        'SELECT id, key, name FROM dimensions WHERE ledger_id = ? AND key = ?'
      ).get(ledgerId, key));
    },

    /** 取 tag（按 id） */
    tagById(ledgerId, id) {
      return plain(db.prepare(
        'SELECT id, ledger_id, dimension_id, name, is_unnamed, color FROM tags WHERE id = ? AND ledger_id = ?'
      ).get(id, ledgerId));
    },

    /** 取 tag（按维度 + 名称） */
    tagByName(ledgerId, dimensionKey, name) {
      return plain(db.prepare(
        `SELECT t.id, t.ledger_id, t.dimension_id, t.name, t.is_unnamed, t.color
         FROM tags t JOIN dimensions d ON d.id = t.dimension_id
         WHERE t.ledger_id = ? AND d.key = ? AND t.name = ?`
      ).get(ledgerId, dimensionKey, name));
    },

    /** 全维度按名称查（可能歧义 → 返回数组，由调用方处理） */
    findByName(ledgerId, name) {
      return plainAll(db.prepare(
        `SELECT t.id, t.ledger_id, t.dimension_id, t.name, t.is_unnamed, t.color
         FROM tags t WHERE t.ledger_id = ? AND t.name = ?`
      ).all(ledgerId, name));
    },

    /** 维度内特殊默认「未标注」tag */
    unnamedTag(ledgerId, dimensionKey) {
      return plain(db.prepare(
        `SELECT t.id, t.dimension_id, t.name, t.is_unnamed
         FROM tags t JOIN dimensions d ON d.id = t.dimension_id
         WHERE t.ledger_id = ? AND d.key = ? AND t.is_unnamed = 1`
      ).get(ledgerId, dimensionKey));
    },

    /** 建维度 */
    createDimension(ledgerId, key, name, position = 0) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO dimensions (ledger_id, key, name, position) VALUES (?, ?, ?, ?)'
      ).run(ledgerId, key, name, position);
      return Number(lastInsertRowid);
    },

    /** 建 tag（维度内名称唯一） */
    createTag(ledgerId, dimensionId, name, { isUnnamed = 0, color = null, position = 0 } = {}) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO tags (ledger_id, dimension_id, name, is_unnamed, color, position) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(ledgerId, dimensionId, name, isUnnamed ? 1 : 0, color, position);
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

    /** 同维度内是否已存在同名 tag（改名查重用，排除自身） */
    nameExistsInDimension(dimensionId, name, exceptTagId = null) {
      const r = exceptTagId === null
        ? db.prepare('SELECT COUNT(*) AS n FROM tags WHERE dimension_id = ? AND name = ?').get(dimensionId, name)
        : db.prepare('SELECT COUNT(*) AS n FROM tags WHERE dimension_id = ? AND name = ? AND id != ?').get(dimensionId, name, exceptTagId);
      return Number(r.n) > 0;
    },
  };
}
