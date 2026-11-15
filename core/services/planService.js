// 计划业务服务：账本内的一段时间 + 预算；余额 = 预算 + 入账 − 已用（允许为负）。
// 计划名称不唯一（「生活费」可以每月一个，靠日期区分）；API 只用 id 引用。
import { createPlanRepo } from '../repos/planRepo.js';
import { BizError } from './ledgerService.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_MAX = 40;

export function createPlanService(db) {
  const repo = createPlanRepo(db);

  function normalizeName(v) {
    const name = String(v ?? '').trim();
    if (!name || name.length > NAME_MAX) throw new BizError(`计划名称须为 1–${NAME_MAX} 字`, 'INVALID_FIELD');
    return name;
  }

  function normalizeBudget(v, fallback) {
    if (v === undefined && fallback !== undefined) return fallback;
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < 0) throw new BizError('预算须为非负整数（分）', 'INVALID_FIELD');
    return n;
  }

  function normalizeRange(startDate, endDate, fallback = {}) {
    const s = String(startDate ?? fallback.startDate ?? '');
    const e = String(endDate ?? fallback.endDate ?? '');
    if (!DATE_RE.test(s) || !DATE_RE.test(e)) throw new BizError('日期格式须为 YYYY-MM-DD', 'INVALID_DATE');
    if (e < s) throw new BizError('结束日期不能早于开始日期', 'INVALID_DATE');
    return { startDate: s, endDate: e };
  }

  function withTotals(plan) {
    if (!plan) return null;
    const t = repo.totalsOf(plan.ledger_id, plan.id)
      || { spent_cents: 0, income_cents: 0, bill_count: 0 };
    return {
      ...plan,
      spent_cents: t.spent_cents,
      income_cents: t.income_cents,
      bill_count: t.bill_count,
      remaining_cents: plan.budget_cents + t.income_cents - t.spent_cents,
    };
  }

  return {
    /** 账本内全部计划 + 余额（一次聚合查询） */
    list(ledgerId) {
      const totals = new Map(repo.totalsAll(ledgerId).map(t => [t.plan_id, t]));
      return repo.list(ledgerId).map((p) => {
        const t = totals.get(p.id) || { spent_cents: 0, income_cents: 0, bill_count: 0 };
        return {
          ...p,
          spent_cents: t.spent_cents,
          income_cents: t.income_cents,
          bill_count: t.bill_count,
          remaining_cents: p.budget_cents + t.income_cents - t.spent_cents,
        };
      });
    },

    create(ledgerId, input = {}) {
      const name = normalizeName(input.name);
      const budgetCents = normalizeBudget(input.budgetCents, 0);
      const { startDate, endDate } = normalizeRange(input.startDate, input.endDate);
      const id = repo.insert({ ledgerId, name, budgetCents, startDate, endDate });
      return withTotals(repo.byId(ledgerId, id));
    },

    update(ledgerId, planId, fields = {}) {
      const cur = repo.byId(ledgerId, planId);
      if (!cur) throw new BizError(`计划不存在: ${planId}`, 'PLAN_NOT_FOUND', 404);
      const name = fields.name === undefined ? cur.name : normalizeName(fields.name);
      const budgetCents = fields.budgetCents === undefined ? cur.budget_cents : normalizeBudget(fields.budgetCents);
      const { startDate, endDate } = normalizeRange(fields.startDate, fields.endDate, {
        startDate: cur.start_date, endDate: cur.end_date,
      });
      repo.update(planId, { name, budgetCents, startDate, endDate });
      return withTotals(repo.byId(ledgerId, planId));
    },

    /** 删除计划：外键级联只清链接，账单保留 */
    remove(ledgerId, planId) {
      const cur = repo.byId(ledgerId, planId);
      if (!cur) throw new BizError(`计划不存在: ${planId}`, 'PLAN_NOT_FOUND', 404);
      repo.remove(planId);
    },

    /**
     * 记账/编辑时的计划归属校验。
     * - 所有计划必须属于该账本（跨账本 404）。
     * - 新增的计划要求账单日期落在跨度内（越界 400）；`existingPlanIds` 里的
     *   已关联计划豁免日期校验 —— 改日期不应静默丢链接。
     * @returns {number[]} 去重后的计划 id
     */
    assertLinkable(ledgerId, date, planIds = [], existingPlanIds = []) {
      const existing = new Set((existingPlanIds || []).map(Number));
      const seen = new Set();
      const out = [];
      for (const raw of planIds || []) {
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0) throw new BizError('计划 id 非法', 'INVALID_FIELD');
        if (seen.has(id)) continue;
        seen.add(id);
        const plan = repo.byId(ledgerId, id);
        if (!plan) throw new BizError(`计划不存在或不属于该账本: ${id}`, 'PLAN_NOT_FOUND', 404);
        if (!existing.has(id) && (date < plan.start_date || date > plan.end_date)) {
          throw new BizError(`日期 ${date} 不在计划「${plan.name}」的跨度内`, 'PLAN_OUT_OF_RANGE', 400);
        }
        out.push(id);
      }
      return out;
    },
  };
}
