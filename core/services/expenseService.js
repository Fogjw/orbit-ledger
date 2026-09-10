// 记账业务服务：记一笔 = 单事务（花销 + 每维主 tag + 副 tag）
// 规则（对齐需求基线 §3/§5.3）：
//  - type: expense | income（收入为支出变体）
//  - amount_cents > 0（schema CHECK 兜底）
//  - primary: 每维恰好一个主 tag（category 必填；context 缺省 → 该维「未标注」）
//  - tags: 副 tag 多选（任意维度，可跨维）
//  - 所有 tag 必须属于同一账本（隔离校验，防跨账本关联）
import { createExpenseRepo } from '../repos/expenseRepo.js';
import { createTagRepo } from '../repos/tagRepo.js';
import { transaction } from '../transaction.js';
import { BizError } from './ledgerService.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createExpenseService(db) {
  const expenses = createExpenseRepo(db);
  const tags = createTagRepo(db);

  /**
   * 解析维度主 tag。**所有维度都不强制必填**（产品规则：记一笔不要求用户选 tag）：
   * 未选 → 该维「未分类」占位主 tag，没有则当场创建。
   * @param {{id:number, key:string, name:string}} dim
   */
  function resolvePrimary(ledgerId, dim, ref) {
    if (ref === undefined || ref === null || ref === '') {
      return tags.tagById(ledgerId, tags.ensureUnnamedTag(ledgerId, dim.id));
    }
    const tag = typeof ref === 'number'
      ? tags.tagById(ledgerId, ref)
      : tags.rootTagByName(ledgerId, dim.key, String(ref));
    if (!tag) throw new BizError(`tag 不存在或不属于该账本: ${ref}（维度 ${dim.name}）`, 'TAG_NOT_FOUND', 404);
    // 主 tag 必须是根级：副 tag（主 tag 的细分）不能充当维度的主取值
    if (tag.parent_tag_id !== null && tag.parent_tag_id !== undefined) {
      throw new BizError(`「${tag.name}」是副 tag，不能作为维度「${dim.name}」的主 tag`, 'NOT_A_PRIMARY_TAG', 400);
    }
    return tag;
  }

  /**
   * 解析副 tag 引用列表并校验归属（S6-v3 规则）。
   * 规则：副 tag 必须挂在**本笔某个维度的主 tag** 下 —— 一笔账单的副 tag 只能取自它自己的主 tag，
   * 因此「交通通勤」下无法挂「午餐」（午餐挂在「餐饮」下）；维度之间也因此天然互不串味。
   * @param {Set<number>} primaryTagIds 本笔已确定的主 tag id 集合
   */
  function resolveSecondary(ledgerId, refs = [], primaryTagIds = new Set()) {
    const out = [];
    const seen = new Set();
    for (const ref of refs) {
      let tag;
      if (typeof ref === 'number') {
        tag = tags.tagById(ledgerId, ref);
      } else {
        const matches = tags.findByName(ledgerId, String(ref));
        if (matches.length > 1) throw new BizError(`副 tag「${ref}」重名（不同主 tag 下存在同名），请改用 tag id`, 'TAG_AMBIGUOUS');
        tag = matches[0] ?? null;
      }
      if (!tag) throw new BizError(`副 tag 不存在或不属于该账本: ${ref}`, 'TAG_NOT_FOUND', 404);
      if (tag.parent_tag_id === null || tag.parent_tag_id === undefined) {
        throw new BizError(`「${tag.name}」是主 tag，不能作为副 tag`, 'NOT_A_SUBTAG', 400);
      }
      if (!primaryTagIds.has(tag.parent_tag_id)) {
        throw new BizError(
          `副 tag「${tag.name}」不属于本笔的主 tag（副 tag 只能挂在本笔同维主 tag 下）`,
          'SUBTAG_NOT_UNDER_PRIMARY',
          400
        );
      }
      // 同一细分被引用多次 → 静默去重。links 的唯一键是 (expense_id, tag_id, role)，
      // 不去重会撞唯一约束变成 500；而这本质是输入冗余，不该让用户看到内部错误。
      if (seen.has(tag.id)) continue;
      seen.add(tag.id);
      out.push(tag);
    }
    return out;
  }

  /**
   * 记账输入 → 待写 expense 字段 + links 列表（add/update 共用，规则单一来源）。
   * 校验不变量：金额正整数、日期 YYYY-MM-DD、每维恰一 primary、全部 tag 属于同一账本。
   *
   * 缺省兜底（产品规则：记一笔不要求用户选任何 tag）：
   *  - 某维主 tag 未选 → 该维「未分类」主 tag（没有则当场创建）
   *  - 某主 tag 下一个副 tag 都没选 → 补该主 tag 的「未分类」副 tag（没有则当场创建）
   * 因此本函数**可能写库**（懒创建占位 tag），调用方必须包在事务内，保证与记账同生共死。
   */
  function plan(input) {
    const { ledgerId, amountCents, date } = input;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BizError('金额必须为正整数（分）', 'INVALID_AMOUNT');
    }
    if (!DATE_RE.test(date)) throw new BizError('日期格式须为 YYYY-MM-DD', 'INVALID_DATE');
    const type = input.type === 'income' ? 'income' : 'expense';

    // 主 tag：遍历账本全部维度，每维恰一个（未选 → 「未分类」）
    const primaries = tags.dimensions(ledgerId).map(dim => ({
      dimensionId: dim.id,
      tag: resolvePrimary(ledgerId, dim, input.primary ? input.primary[dim.key] : undefined),
    }));

    // 副 tag：归属校验的基准 = 本笔各维主 tag
    const primaryTagIds = new Set(primaries.map(p => p.tag.id));
    const secondaries = resolveSecondary(ledgerId, input.tags, primaryTagIds);

    // 副 tag 兜底：某主 tag 下若一个副 tag 都没选 → 补它的「未分类」副 tag
    const parentsWithSecondary = new Set(secondaries.map(t => t.parent_tag_id));
    for (const p of primaries) {
      if (!parentsWithSecondary.has(p.tag.id)) {
        const id = tags.ensureUnnamedTag(ledgerId, p.dimensionId, { parentTagId: p.tag.id });
        secondaries.push(tags.tagById(ledgerId, id));
      }
    }

    return {
      fields: { ledgerId, type, amountCents, date, note: input.note ?? null },
      links: [
        ...primaries.map(p => ({ tagId: p.tag.id, role: 'primary' })),
        ...secondaries.map(t => ({ tagId: t.id, role: 'secondary' })),
      ],
    };
  }

  const api = {
    /**
     * 记一笔（支出/收入）。单事务，任一步失败整体回滚（含缺省占位 tag 的懒创建）。
     * @param {object} input
     * @param {number} input.ledgerId
     * @param {'expense'|'income'} [input.type]
     * @param {number} input.amountCents 金额（分）
     * @param {string} input.date YYYY-MM-DD
     * @param {string|null} [input.note]
     * @param {object} [input.primary] 各维主 tag { category?: name|id, context?: name|id }；全部可缺省
     * @param {Array<number|string>} [input.tags] 副 tag（须挂在本笔某主 tag 下；缺省自动补「未分类」）
     */
    add(input) {
      return transaction(db, () => {
        const p = plan(input);
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
     * 更新事实行 + 清空旧 links + 重写全部主/副 tag（含缺省占位 tag 的懒创建），任一步失败整体回滚。
     * @param {number} ledgerId 路径账本（隔离校验基准）
     * @param {number} expenseId 目标花销
     * @param {object} input 同 add 的记账输入（不含 ledgerId，由路径参数决定归属）
     */
    update(ledgerId, expenseId, input) {
      const existing = expenses.byId(expenseId);
      if (!existing || existing.ledger_id !== ledgerId) {
        throw new BizError(`花销不存在: ${expenseId}`, 'NOT_FOUND', 404);
      }
      return transaction(db, () => {
        const p = plan({ ...input, ledgerId });
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
