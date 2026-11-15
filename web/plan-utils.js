/**
 * 计划口径的纯函数（不碰 DOM、不碰数据层）。
 * 余额符号只决定标签：remaining < 0 = 「超支」；颜色与绝对值由 web/data.js 的
 * balanceColor / balanceAbs 统一给出（全项目一个出口）。
 * 普通 <script>，挂 window.OrbitPlanUtils；日期一律按 UTC 天计算，避免时区偏移。
 */
(function () {
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const msOf = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  const isoOf = (ms) => {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  };
  const dayDiff = (a, b) => Math.round((msOf(b) - msOf(a)) / DAY);
  const addDays = (ymd, n) => isoOf(msOf(ymd) + n * DAY);
  const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /** 'upcoming' | 'active' | 'ended'（字符串比较即可，ISO 日期天然有序） */
  function planStatus(plan, today) {
    if (today < plan.start_date) return 'upcoming';
    if (today > plan.end_date) return 'ended';
    return 'active';
  }

  /**
   * 计划读数。elapsed 含今天（今天也算已过一天），daysLeft 不含今天
   * （与「剩 15 天 / 日均可用」的设计口径一致）。
   */
  function planMetrics(plan, today) {
    const budget = Number(plan.budget_cents) || 0;
    const spent = Number(plan.spent_cents) || 0;
    const income = Number(plan.income_cents) || 0;
    const remaining = budget + income - spent;
    const status = planStatus(plan, today);
    const totalDays = Math.max(1, dayDiff(plan.start_date, plan.end_date) + 1);
    const elapsed = status === 'ended' ? totalDays
      : (status === 'active' ? Math.min(totalDays, dayDiff(plan.start_date, today) + 1) : 0);
    const timePct = clamp(elapsed / totalDays * 100, 0, 100);
    const daysLeft = status === 'ended' ? 0
      : (status === 'upcoming' ? totalDays : Math.max(0, dayDiff(today, plan.end_date)));
    // 预算 0 = 纯信封（靠入账），「已用 / 预算」没有分母：按 0 处理，不显示满格
    const rawUsedPct = budget > 0 ? spent / budget * 100 : 0;
    const usedPct = clamp(rawUsedPct, 0, 100);
    const dailyLeftCents = daysLeft > 0 ? Math.floor(remaining / daysLeft) : 0;
    let projectedOverspendCents = 0;
    if (status === 'active' && elapsed > 0) {
      projectedOverspendCents = Math.max(0, Math.round(spent / elapsed * totalDays) - budget - income);
    }
    return {
      status,
      remainingCents: remaining,
      remainingLabel: remaining < 0 ? '超支' : '剩余',
      budgetCents: budget,
      spentCents: spent,
      incomeCents: income,
      usedPct,
      rawUsedPct,
      timePct,
      daysLeft,
      dailyLeftCents,
      projectedOverspendCents,
      totalDays,
      elapsedDays: elapsed,
    };
  }

  /** 进行中（含未开始）+ 已结束；顺序稳定，供横向轨道渲染 */
  function planGroups(plans, today) {
    const active = [], ended = [];
    for (const p of plans || []) (planStatus(p, today) === 'ended' ? ended : active).push(p);
    // 正在进行的排前面（未开始的排后），同组内开始晚的在前：最近开始的计划最常被看
    active.sort((a, b) => {
      const sa = planStatus(a, today) === 'active' ? 0 : 1;
      const sb = planStatus(b, today) === 'active' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.start_date === b.start_date ? a.id - b.id : (a.start_date > b.start_date ? -1 : 1);
    });
    ended.sort((a, b) => (a.end_date === b.end_date ? b.id - a.id : (a.end_date > b.end_date ? -1 : 1)));
    return { active, ended };
  }

  /**
   * 一键续期：整月区间顺延到下一个自然月；否则从 end+1 起、长度（含首尾）不变。
   * @returns {{startDate:string, endDate:string}}
   */
  function nextRange(plan) {
    const s = plan.start_date, e = plan.end_date;
    const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    if (d === 1 && e === y + '-' + pad(m) + '-' + pad(lastDayOf(y, m))) {
      const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
      return {
        startDate: ny + '-' + pad(nm) + '-01',
        endDate: ny + '-' + pad(nm) + '-' + pad(lastDayOf(ny, nm)),
      };
    }
    const len = dayDiff(s, e);
    const ns = addDays(e, 1);
    return { startDate: ns, endDate: addDays(ns, len) };
  }

  /** localStorage.orbit.startPage 的 JSON → {ledgerId, planId|null}，坏数据返回 null */
  function parseStartPage(raw) {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || o.ledgerId == null || !Number.isFinite(Number(o.ledgerId))) return null;
      return { ledgerId: Number(o.ledgerId), planId: o.planId == null ? null : Number(o.planId) };
    } catch {
      return null;
    }
  }

  const api = { planStatus, planMetrics, planGroups, nextRange, parseStartPage };
  (typeof window !== 'undefined' ? window : globalThis).OrbitPlanUtils = api;
})();
