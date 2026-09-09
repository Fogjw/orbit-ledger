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

  /**
   * 记账输入 → 待写 expense 字段 + links 列表（add/update 共用，规则单一来源）。
   * 校验不变量：金额正整数、日期 YYYY-MM-DD、品类 primary 必填、每维恰一 primary、
   * 全部 tag 属于同一账本。不改库；写库由调用方在事务内执行。
   */
  function plan(input) {
    const { ledgerId, amountCents, date } = input;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BizError('金额必须为正整数（分）', 'INVALID_AMOUNT');
    }
    if (!DATE_RE.test(date)) throw new BizError('日期格式须为 YYYY-MM-DD', 'INVALID_DATE');
    const type = input.type === 'income' ? 'income' : 'expense';

    const links = [];
    // 主 tag：遍历账本全部维度；required 维主 tag 必填，其余维缺省 → 该维「未标注」
    const dims = tags.dimensions(ledgerId);
    for (const dim of dims) {
      const ref = input.primary ? input.primary[dim.key] : undefined;
      if (dim.required && (ref === undefined || ref === null || ref === '')) {
        throw new BizError(`维度「${dim.name}」主 tag 必填`, 'REQUIRED_TAG');
      }
      const tag = resolvePrimary(ledgerId, dim.key, ref, dim.name);
      links.push({ tagId: tag.id, role: 'primary' });
    }
    for (const t of resolveSecondary(ledgerId, input.tags)) {
      links.push({ tagId: t.id, role: 'secondary' });
    }

    return {
      fields: { ledgerId, type, amountCents, date, note: input.note ?? null },
      links,
    };
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
      const p = plan(input);
      return transaction(db, () => {
        const expenseId = expenses.insert(p.fields);
        expenses.linkTags(expenseId, p.links);
        return api.byId(expenseId);
      });
    },

    /** 完整花销（含 tag 明细） */
    byId(id) {
      const e = expenses.byId(id);
      if (!e) return null;
      return { ...e, tags: expenses.tagsOf(id) };
    },

    /**
     * 账本内单笔读取（含 tag 明细）。花销不存在或不属于该账本 → null。
     * 账本隔离：跨账本访问与"不存在"同语义（路由映射 404，不泄露资源归属）。
     */
    getInLedger(ledgerId, expenseId) {
      const e = expenses.byId(expenseId);
      if (!e || e.ledger_id !== ledgerId) return null;
      return api.byId(expenseId);
    },

    /** 时间窗内花销（含各自 tag 明细） */
    listByWindow(ledgerId, win = {}) {
      const rows = expenses.listByWindow(ledgerId, win);
      return rows.map(e => ({ ...e, tags: expenses.tagsOf(e.id) }));
    },

    /**
     * 编辑花销（D-10 PUT 全量替换，规则与 add 同源）。单事务：
     * 更新事实行 + 清空旧 links + 重写全部主/副 tag，任一步失败整体回滚。
     * @param {number} ledgerId 路径账本（隔离校验基准）
     * @param {number} expenseId 目标花销
     * @param {object} input 同 add 的记账输入（不含 ledgerId，由路径参数决定归属）
     */
    update(ledgerId, expenseId, input) {
      const existing = expenses.byId(expenseId);
      if (!existing || existing.ledger_id !== ledgerId) {
        throw new BizError(`花销不存在: ${expenseId}`, 'NOT_FOUND', 404);
      }
      const p = plan({ ...input, ledgerId });
      return transaction(db, () => {
        expenses.update(expenseId, p.fields);
        expenses.replaceLinks(expenseId, p.links);
        return api.byId(expenseId);
      });
    },

    /** 删除账本内花销；不存在或跨账本 → 返回 false（路由映射 404） */
    removeInLedger(ledgerId, expenseId) {
      const e = expenses.byId(expenseId);
      if (!e || e.ledger_id !== ledgerId) return false;
      expenses.remove(expenseId);
      return true;
    },

    remove(id) {
      expenses.remove(id);
    },
  };
  return api;
}
