/**
 * Orbit 星账 · 星轨换档与视口保持（纯函数）
 *
 * 星轨从左到右 = 从更早到更近，右侧离当前时间最近。
 * 下钻（年→月→日）落到当前节点覆盖范围内最右的子节点：
 * 8 月 → 该月最晚的一天（有 8 月 31 日的账就是 8.31）。
 * 上卷落到包含当前节点的父周期，不按「离周期中心更近」滑到隔壁。
 *
 * 记账刷新会重排时间轴压缩坐标。只记住 pan 的数字不够：
 * 左侧插入节点后，后面所有点的轴坐标右移，画面会被拽向更早的一侧。
 * 所以视口用「中心对应的真实日期」交接，刷新后再换算回 pan。
 *
 * 普通 <script>，无 import/export。挂到 globalThis.OrbitTimeline，供 app.js 与 node:test 共用。
 */
(function (root) {
  const DAY_MS = 86400000;
  const RANK = { day: 0, month: 1, year: 2, all: 3 };

  /** 'YYYY-MM-DD' → 天序号（UTC，与 app.js dayNum 同一口径，避免时区把日期挤偏一天） */
  function dayNum(ymd) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** 该月最后一天的日号（8 月 → 31）。用 UTC，不吃本地时区。 */
  function lastDom(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /**
   * 真实天数 → 压缩轴坐标。与原先 app.js 的 axisDay 同一条规则：
   * 节点不足两个、或没有上限时原样返回；单步超过 maxGap 就按 maxGap 计。
   * @param {number} d 真实天序号
   * @param {number[]} nodes 当前档位节点的真实天序号（升序）
   * @param {number} maxGap 相邻节点在轴上允许的最大间距（天）
   */
  function axisDay(d, nodes, maxGap) {
    if (!nodes || nodes.length < 2 || !(maxGap > 0)) return d;
    let acc = 0;
    let prev = nodes[0];
    if (d <= prev) return d - prev;
    for (let i = 1; i < nodes.length; i++) {
      const step = Math.min(nodes[i] - prev, maxGap);
      if (d <= nodes[i]) return acc + Math.min(d - prev, maxGap);
      acc += step;
      prev = nodes[i];
    }
    return acc + Math.min(d - prev, maxGap);
  }

  /**
   * axisDay 的反函数：压缩轴坐标 → 真实天序号。
   * 节点落点精确还原；未压缩的区间内部也精确。压缩空档内部按比例摊回真实天数
   * （空档里没有节点，摊回只为了让视口中心还能对上同一段空白）。
   */
  function realDayAt(axis, nodes, maxGap) {
    if (!nodes || nodes.length < 2 || !(maxGap > 0)) return axis;
    if (axis <= 0) return nodes[0] + axis;
    let acc = 0;
    let prev = nodes[0];
    for (let i = 1; i < nodes.length; i++) {
      const gap = nodes[i] - prev;
      const step = Math.min(gap, maxGap);
      if (axis <= acc + step) {
        const t = step > 0 ? (axis - acc) / step : 0;
        return prev + t * gap;
      }
      acc += step;
      prev = nodes[i];
    }
    return prev + (axis - acc);
  }

  /**
   * 让某个真实日期继续落在视口中心所需的 pan。
   * anchorAxis 是当前锚点的压缩轴坐标（anchorCenter 的返回值）。
   */
  function panToHold(realDay, nodes, maxGap, anchorAxis) {
    return axisDay(realDay, nodes, maxGap) - anchorAxis;
  }

  /** 节点画在轴上的那一天：日=当天，月=15 日，年=7 月 1 日（与绘制锚点一致） */
  function focusRealDay(level, idx, days, months, years) {
    if (level === 'day' && days[idx]) return dayNum(days[idx].date);
    if (level === 'month' && months[idx]) {
      const m = months[idx];
      return dayNum(`${m.y}-${pad2(m.m)}-15`);
    }
    if ((level === 'year' || level === 'all') && years[idx]) {
      return dayNum(`${years[idx].y}-07-01`);
    }
    return null;
  }

  function selectionOf(fromLevel, selIdx, days, months, years) {
    if (fromLevel === 'day' && days[selIdx]) {
      const d = days[selIdx];
      return { y: d.y, m: d.m, date: d.date };
    }
    if (fromLevel === 'month' && months[selIdx]) {
      const m = months[selIdx];
      return { y: m.y, m: m.m };
    }
    if ((fromLevel === 'year' || fromLevel === 'all') && years[selIdx]) {
      return { y: years[selIdx].y };
    }
    return null;
  }

  /** 当前节点覆盖到的最后一天。下钻找不到子节点时，用它就近兜底，而不是退回下标 0。 */
  function periodEnd(sel, fromLevel) {
    if (!sel) return null;
    if (fromLevel === 'day') return sel.date;
    if (fromLevel === 'month') return `${sel.y}-${pad2(sel.m)}-${pad2(lastDom(sel.y, sel.m))}`;
    return `${sel.y}-12-31`;
  }

  function dayInScope(d, sel, fromLevel) {
    if (!sel || d.y !== sel.y) return false;
    if (fromLevel === 'month' || fromLevel === 'day') return d.m === sel.m;
    return true;
  }

  /** 满足条件的最右一项（key 越大越晚）。没有则 -1。 */
  function rightmostIndex(arr, pred, keyOf) {
    let best = -1;
    let bestKey = null;
    for (let i = 0; i < arr.length; i++) {
      if (!pred(arr[i])) continue;
      const key = keyOf(arr[i]);
      if (best < 0 || key > bestKey) {
        best = i;
        bestKey = key;
      }
    }
    return best;
  }

  /** 离 target 最近；距离相同取更晚的下标（右侧，离现在更近）。 */
  function nearestIndex(arr, dayOf, target) {
    if (!arr.length) return 0;
    const goal = dayNum(target);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const dist = Math.abs(dayOf(arr[i]) - goal);
      if (dist < bestDist || (dist === bestDist && i > best)) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function fallbackEnd(arr) {
    return Math.max(0, arr.length - 1);
  }

  function drillDown(fromLevel, toLevel, sel, days, months, years) {
    if (toLevel === 'day') {
      if (!sel) return fallbackEnd(days);
      const hit = rightmostIndex(days, (d) => dayInScope(d, sel, fromLevel), (d) => d.date);
      if (hit >= 0) return hit;
      return nearestIndex(days, (d) => dayNum(d.date), periodEnd(sel, fromLevel));
    }
    if (toLevel === 'month') {
      if (!sel) return fallbackEnd(months);
      const hit = rightmostIndex(months, (m) => m.y === sel.y, (m) => m.y * 100 + m.m);
      if (hit >= 0) return hit;
      return nearestIndex(
        months,
        (m) => dayNum(`${m.y}-${pad2(m.m)}-15`),
        periodEnd(sel, fromLevel),
      );
    }
    if (!sel) return fallbackEnd(years);
    const yi = years.findIndex((y) => y.y === sel.y);
    if (yi >= 0) return yi;
    return nearestIndex(years, (y) => dayNum(`${y.y}-07-01`), periodEnd(sel, fromLevel));
  }

  function zoomOut(toLevel, sel, days, months, years) {
    if (toLevel === 'month') {
      if (!sel) return fallbackEnd(months);
      const i = months.findIndex((m) => m.y === sel.y && m.m === sel.m);
      if (i >= 0) return i;
      return nearestIndex(months, (m) => dayNum(`${m.y}-${pad2(m.m)}-15`), sel.date || periodEnd(sel, 'month'));
    }
    if (toLevel === 'year' || toLevel === 'all') {
      if (!sel) return fallbackEnd(years);
      const i = years.findIndex((y) => y.y === sel.y);
      if (i >= 0) return i;
      const end = sel.date || (sel.m ? periodEnd(sel, 'month') : periodEnd(sel, 'year'));
      return nearestIndex(years, (y) => dayNum(`${y.y}-07-01`), end);
    }
    if (!sel || !sel.date) return fallbackEnd(days);
    const i = days.findIndex((d) => d.date === sel.date);
    return i >= 0 ? i : nearestIndex(days, (d) => dayNum(d.date), sel.date);
  }

  /**
   * 换档后应选中的下标。
   * @param {{fromLevel:string,toLevel:string,selIdx:number,days:object[],months:object[],years:object[]}} q
   * @returns {number}
   */
  function indexAfterZoom(q) {
    const fromRank = RANK[q.fromLevel];
    const toRank = RANK[q.toLevel];
    const sel = selectionOf(q.fromLevel, q.selIdx, q.days, q.months, q.years);
    if (toRank == null || fromRank == null) {
      const arr = q.toLevel === 'day' ? q.days : q.toLevel === 'month' ? q.months : q.years;
      return fallbackEnd(arr || []);
    }
    if (toRank < fromRank) return drillDown(q.fromLevel, q.toLevel, sel, q.days, q.months, q.years);
    if (toRank === fromRank) {
      const arr = q.toLevel === 'day' ? q.days : q.toLevel === 'month' ? q.months : q.years;
      return q.selIdx >= 0 && q.selIdx < arr.length ? q.selIdx : fallbackEnd(arr);
    }
    return zoomOut(q.toLevel, sel, q.days, q.months, q.years);
  }

  root.OrbitTimeline = {
    dayNum,
    axisDay,
    realDayAt,
    panToHold,
    focusRealDay,
    indexAfterZoom,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
