// 开发种子数据（可选）：建默认账本 + MVP 维度（品类/情境）+ tag 体系
// 对应需求基线：品类必填（6 常用类）；情境可选（含特殊默认「未标注」）
import { transaction } from './database.js';

/**
 * 注入种子（若库为空）。幂等：已存在同名账本则跳过。
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ seeded: boolean }}
 */
export function seedIfEmpty(db) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM ledgers').get();
  if (existing.n > 0) return { seeded: false };

  return transaction(db, () => {
    const insLedger = db.prepare('INSERT INTO ledgers (name) VALUES (?)');
    const { lastInsertRowid: ledgerId } = insLedger.run('生活费');

    const insDim = db.prepare('INSERT INTO dimensions (ledger_id, key, name, position, required) VALUES (?, ?, ?, ?, ?)');
    const insTag = db.prepare(
      'INSERT INTO tags (ledger_id, dimension_id, name, is_unnamed, color, position) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // 品类维度（required=1：主 tag 必填）
    const { lastInsertRowid: catDimId } = insDim.run(ledgerId, 'category', '品类', 0, 1);
    const categories = [
      ['餐饮', '#ff9f5a'], ['交通', '#5ad7ff'], ['娱乐', '#b48cff'],
      ['居住', '#ff7a9e'], ['日用', '#6fe3a8'], ['学习', '#ffd166'],
    ];
    categories.forEach(([name, color], i) => insTag.run(ledgerId, catDimId, name, 0, color, i));

    // 情境维度（required=0 可选主 tag，含特殊默认「未标注」）
    const { lastInsertRowid: ctxDimId } = insDim.run(ledgerId, 'context', '情境', 1, 0);
    const contexts = [
      ['和朋友', '#5ad7ff'], ['独处', '#9fb8d0'], ['和对象', '#ff9fb0'], ['通勤', '#b48cff'],
    ];
    contexts.forEach(([name, color], i) => insTag.run(ledgerId, ctxDimId, name, 0, color, i));
    // 「未标注」= 数据层合法取值，产品层弱化（is_unnamed=1）
    insTag.run(ledgerId, ctxDimId, '未标注', 1, '#666a75', 99);

    return { seeded: true };
  });
}
