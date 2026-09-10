// 账本业务服务：账本顶级隔离（D-07）+ 维度初始化
import { createLedgerRepo } from '../repos/ledgerRepo.js';
import { createTagRepo } from '../repos/tagRepo.js';
import { transaction } from '../transaction.js';

// 业务错误（api 层映射 HTTP 状态）
export class BizError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 新账本默认维度（MVP：品类 + 情境）
// 注意：**不预设任何占位 tag** ——「未分类」由记账缺省时按需创建
//（见 expenseService 的兜底逻辑 / tagRepo.ensureUnnamedTag），账本里不留没人用过的占位行。
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
  },
];

// 可选扩展维度模板：key → 默认显示名。
// schema key CHECK 白名单（category/context/payment）见 db/schema.js；
// 账本初始化自动建 category+context，payment 保留给 enableDimension 后期启用。
const EXTENSIBLE_DIMENSIONS = { payment: '支付方式' };

// schema 允许的全部维度 key（与 db/schema.js CHECK 对齐；未来演进只改两处同步）
const ALLOWED_DIMENSION_KEYS = ['category', 'context', ...Object.keys(EXTENSIBLE_DIMENSIONS)];

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
          // required 列保留（记录「该维为建议必填」的历史语义），当前不参与记账校验：
          // 所有维度均可缺省，缺省由记账层落到「未分类」占位 tag
          const required = dim.key === 'category' ? 1 : 0;
          const dimId = tags.createDimension(ledger.id, dim.key, dim.name, i, required);
          for (const [tname, color] of dim.tags) {
            tags.createTag(ledger.id, dimId, tname, { color });
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

    /**
     * 账本启用扩展维度（如 payment）。单事务：建维度 + 种子 tag。
     * 不预设占位 tag（同建账本）：缺省值由记账层按需创建。
     * 校验：key 须在 schema 白名单（ALLOWED_DIMENSION_KEYS）→ INVALID_DIMENSION_KEY；
     * 维度已存在 → DIMENSION_EXISTS。
     * @param {number} ledgerId
     * @param {string} key 扩展维度 key（如 'payment'）
     * @param {string} [name] 显示名（缺省用模板默认名）
     */
    enableDimension(ledgerId, key, name) {
      this.byId(ledgerId);
      if (!ALLOWED_DIMENSION_KEYS.includes(key)) {
        throw new BizError(`未知维度 key: ${key}（允许: ${ALLOWED_DIMENSION_KEYS.join(', ')}）`, 'INVALID_DIMENSION_KEY', 400);
      }
      if (tags.dimensionByKey(ledgerId, key)) {
        throw new BizError(`账本已启用维度「${key}」`, 'DIMENSION_EXISTS', 409);
      }
      const displayName = name ?? EXTENSIBLE_DIMENSIONS[key] ?? key;
      return transaction(db, () => {
        const position = tags.dimensions(ledgerId).length;
        tags.createDimension(ledgerId, key, displayName, position);
        return tags.dimensionByKey(ledgerId, key);
      });
    },
  };
}
