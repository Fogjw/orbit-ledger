// 账本业务服务：账本顶级隔离（D-07）+ 维度初始化
import { createLedgerRepo } from '../repos/ledgerRepo.js';
import { createTagRepo } from '../repos/tagRepo.js';
import { transaction } from '../db/database.js';

// 业务错误（api 层映射 HTTP 状态）
export class BizError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 新账本默认维度（MVP：品类 + 情境；品类种子常用类，情境含「未标注」）
const DEFAULT_DIMENSIONS = [
  {
    key: 'category', name: '品类', tags: [
      ['餐饮', '#ff9f5a'], ['交通', '#5ad7ff'], ['娱乐', '#b48cff'],
      ['居住', '#ff7a9e'], ['日用', '#6fe3a8'], ['学习', '#ffd166'],
    ],
  },
  {
    key: 'context', name: '情境', tags: [
      ['和朋友', '#5ad7ff'], ['独处', '#9fb8d0'], ['和对象', '#ff9fb0'], ['通勤', '#b48cff'],
    ],
    unnamed: '未标注',
  },
];

export function createLedgerService(db) {
  const ledgers = createLedgerRepo(db);
  const tags = createTagRepo(db);

  return {
    list() { return ledgers.list(); },

    byId(id) {
      const l = ledgers.byId(id);
      if (!l) throw new BizError(`账本不存在: ${id}`, 'NOT_FOUND', 404);
      return l;
    },

    /** 建账本（含默认维度与 tag 体系），单事务 */
    create(name) {
      if (!name || !String(name).trim()) throw new BizError('账本名不能为空', 'INVALID_NAME');
      const clean = String(name).trim();
      return transaction(db, () => {
        const ledger = ledgers.create(clean);
        DEFAULT_DIMENSIONS.forEach((dim, i) => {
          const dimId = tags.createDimension(ledger.id, dim.key, dim.name, i);
          for (const [tname, color] of dim.tags) {
            tags.createTag(ledger.id, dimId, tname, { color });
          }
          if (dim.unnamed) {
            tags.createTag(ledger.id, dimId, dim.unnamed, { isUnnamed: 1, position: 999 });
          }
        });
        return ledger;
      });
    },

    rename(id, name) {
      this.byId(id); // 存在性
      if (!name || !String(name).trim()) throw new BizError('账本名不能为空', 'INVALID_NAME');
      return ledgers.rename(id, String(name).trim());
    },

    remove(id) {
      this.byId(id);
      ledgers.remove(id);
    },

    /** 账本视图（含维度+tag 树） */
    describe(id) {
      this.byId(id);
      return { ledger: ledgers.byId(id), dimensions: tags.dimensions(id) };
    },
  };
}
