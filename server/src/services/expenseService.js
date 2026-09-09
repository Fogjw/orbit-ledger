// 记账业务服务：记一笔 = 单事务（花销 + 每维主 tag + 副 tag）
// 规则（对齐需求基线 §3/§5.3）：
//  - type: expense | income（收入为支出变体）
//  - amount_cents > 0（schema CHECK 兜底）
//  - primary: 每维恰好一个主 tag（category 必填；context 缺省 → 该维「未标注」）
//  - tags: 副 tag 多选（任意维度，可跨维）
//  - 所有 tag 必须属于同一账本（隔离校验，防跨账本关联）
import { createExpenseRepo } from '../repos/expenseRepo.js';
import { createTagRepo } from '../repos/tagRepo.js';
import { transaction } from '../db/database.js';
import { BizError } from './ledgerService.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createExpenseService(db) {
  const expenses = createExpenseRepo(db);
  const tags = createTagRepo(db);

  /** 解析维度主 tag 引用（数字 id 或名称）；缺省 → 该维「未标注」 */
  function resolvePrimary(ledgerId, dimKey, ref, dimName) {
    if (ref === undefined || ref === null || ref === '') {
      const unnamed = tags.unnamedTag(ledgerId, dimKey);
      if (unnamed) return unnamed;
      throw new BizError(`维度「${dimName}」缺少默认「未标注」tag，请补建`, 'NO_UNNAMED_TAG');
    }
    const tag = typeof ref === 'number'
      ? tags.tagById(ledgerId, ref)
      : tags.tagByName(ledgerId, dimKey, String(ref));
    if (!tag) throw new BizError(`tag 不存在或不属于该账本: ${ref}（维度 ${dimName}）`, 'TAG_NOT_FOUND', 404);
    return tag;
  }

  /** 解析副 tag 引用列表（名称歧义时要求用 id） */
  function resolveSecondary(ledgerId, refs = []) {
    const out = [];
    for (const ref of refs) {
      let tag;
      if (typeof ref === 'number') {
        tag = tags.tagById(ledgerId, ref);
      } else {
        const matches = tags.findByName(ledgerId, String(ref));
        if (matches.length > 1) throw new BizError(`副 tag「${ref}」跨维度重名，请改用 tag id`, 'TAG_AMBIGUOUS');
        tag = matches[0] ?? null;
      }
      if (!tag) throw new BizError(`副 tag 不存在或不属于该账本: ${ref}`, 'TAG_NOT_FOUND', 404);
      out.push(tag);
    }
    return out;
  }

  const api = {
    /**
     * 记一笔（支出/收入）。单事务，任一步失败整体回滚。
     * @param {object} input
     * @param {number} input.ledgerId
     * @param {'expense'|'income'} [input.type]
     * @param {number} input.amountCents 金额（分）
     * @param {string} input.date YYYY-MM-DD
     * @param {string|null} [input.note]
     * @param {object} input.primary { category: name|id, context?: name|id|null }
     * @param {Array<number|string>} [input.tags] 副 tag
     */
    add(input) {
      const { ledgerId, amountCents, date } = input;
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new BizError('金额必须为正整数（分）', 'INVALID_AMOUNT');
      }
      if (!DATE_RE.test(date)) throw new BizError('日期格式须为 YYYY-MM-DD', 'INVALID_DATE');
      const type = input.type === 'income' ? 'income' : 'expense';

      return transaction(db, () => {
        const expenseId = expenses.insert({
          ledgerId, type, amountCents, date, note: input.note ?? null,
        });

        const links = [];
        // 主 tag：遍历账本全部维度；category 必填，其余维缺省 → 该维「未标注」
        const dims = tags.dimensions(ledgerId);
        for (const dim of dims) {
          const ref = input.primary ? input.primary[dim.key] : undefined;
          if (dim.key === 'category' && (ref === undefined || ref === null || ref === '')) {
            throw new BizError('品类主 tag 必填（这是啥钱）', 'CATEGORY_REQUIRED');
          }
          const tag = resolvePrimary(ledgerId, dim.key, ref, dim.name);
          links.push({ tagId: tag.id, role: 'primary' });
        }
        for (const t of resolveSecondary(ledgerId, input.tags)) {
          links.push({ tagId: t.id, role: 'secondary' });
        }
        expenses.linkTags(expenseId, links);

        return api.byId(expenseId);
      });
    },

    /** 完整花销（含 tag 明细） */
    byId(id) {
      const e = expenses.byId(id);
      if (!e) return null;
      return { ...e, tags: expenses.tagsOf(id) };
    },

    /** 时间窗内花销（含各自 tag 明细） */
    listByWindow(ledgerId, win = {}) {
      const rows = expenses.listByWindow(ledgerId, win);
      return rows.map(e => ({ ...e, tags: expenses.tagsOf(e.id) }));
    },

    remove(id) {
      expenses.remove(id);
    },
  };
  return api;
}
