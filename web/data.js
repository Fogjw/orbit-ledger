/**
 * Orbit 星账 · 真实数据加载层
 * 依赖 window.OrbitAPI（web/api.js），产出前端渲染所需的统一数据结构。
 * 普通 <script>，无 import/export。
 * 作用域隔离：全部包在 IIFE 内（顶层 const 会与其它 script 共享全局词法环境，
 * 撞名即 SyntaxError 中断整页），仅暴露 window.OrbitData。
 */
(function () {

const API = (typeof window !== 'undefined' ? window : globalThis).OrbitAPI;
if (!API) throw new Error('[OrbitData] 请先加载 web/api.js');

// —— 工具 ——

function centsToYuan(c) { return Math.round(c) / 100; }

function hashColor(str) {
  const PALETTE = [
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e',
  ];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function monthLabel(m) { return m + '月'; }
function monthFull(y, m) { return y + '年' + m + '月'; }

function monthEnd(y, m) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
}

function monthStart(y, m) {
  return y + '-' + String(m).padStart(2, '0') + '-01';
}

// —— Data 对象 ——

const Data = {
  ledgers: [],
  ledgerId: null,
  cats: [],   // 品类维**主 tag**（副 tag 见 dims.category.roots[i].children）
  ctxs: [],   // 情境维**主 tag**
  dims: {},   // dimKey → { id, name, all, roots }；roots[i].children = 该主 tag 的副 tag
  months: [],
  days: [],
  monthAmounts: {},
  monthAmountsByDim: {}, // {category: {tagId: 元}, context: {tagId: 元}} 两份维度口径，渲染层按需取
  monthTotal: 0,
  incomeTotal: 0,      // 当前窗口的收入合计（星图收入节点 / 汇总展示）
  incomeRows: [],      // 当前窗口各收入类目 [{tagId,name,amount}]
  prevMonthTotal: 0,
  monthRange: { from: null, to: null },

  // —— 维度原始缓存（渲染层不直接用）——
  _currentMonthY: null,
  _currentMonthM: null,
  _window: null,   // 当前时间窗 {kind:'day'|'month'|'year', ...}，见 selectDay/selectMonth/selectYear

  // ===== 初始化 =====
  async init() {
    this.ledgers = await API.listLedgers();
    if (!this.ledgers.length) {
      const created = await API.createLedger('我的账本');
      this.ledgers = [created];
    }
    await this.selectLedger(this.ledgers[0].id);
    return this.ledgerId;
  },

  // ===== 账本切换 =====
  async selectLedger(id) {
    this.ledgerId = id;
    await this._loadDims();
    await this._loadMonths();
    if (this.months.length) {
      const last = this.months[this.months.length - 1];
      await this.selectMonth({ year: last.y, month: last.m });
    } else {
      // 无数据账本：复位当月视图，避免残留上一账本统计
      this._resetMonthView();
    }
  },

  /** 复位"当前选中月"的全部统计（空账本/切账本兜底用） */
  _resetMonthView() {
    this.monthRange = { from: null, to: null };
    this._currentMonthY = null;
    this._currentMonthM = null;
    this._window = null;
    this.monthTotal = 0;
    this.incomeTotal = 0;
    this.incomeRows = [];
    this.prevMonthTotal = 0;
    this.monthAmountsByDim = { category: {}, context: {} };
    this.monthAmounts = {};
    this.days = [];
  },

  // ===== 时间窗（日 / 月 / 年，统一入口）=====
  // _window 记录当前档位：{kind:'day',date,year,month} | {kind:'month',year,month} | {kind:'year',year}
  // UI 据此决定标题与环比是否适用。

  /**
   * 拉取一个时间窗的统计（三个档位共用）。
   * 日序列固定取**全量**：星轨日档要能左右拖到任意时间，若只覆盖当前窗口，
   * 一拖出窗口就没数据了。
   */
  async _loadWindow(from, to) {
    this.monthRange = { from, to };
    const [periodStats, dailyStats, incomeStats] = await Promise.all([
      API.getStats(this.ledgerId, { from, to, type: 'expense' }),
      API.getStats(this.ledgerId, {}),                              // 日序列取全量：星轨要能拖到任意时间
      API.getStats(this.ledgerId, { from, to, type: 'income' }),    // 收入：星图里的独立样式节点（需求基线 §5.3）
    ]);

    this.monthTotal = centsToYuan(periodStats.totals.expense || 0);
    // 收入：总额 + 各收入类目（"收入·生活费 / 工资 / 红包"）
    this.incomeTotal = centsToYuan(incomeStats.totals.income || 0);
    this.incomeRows = (incomeStats.byDimension?.category || []).map(r => ({
      tagId: r.tag_id,
      name: r.name,
      amount: centsToYuan(r.amount_cents),
    }));

    // 两份维度口径
    this.monthAmountsByDim = { category: {}, context: {} };
    const byDim = periodStats.byDimension || {};
    if (byDim.category) for (const r of byDim.category) this.monthAmountsByDim.category[r.tag_id] = centsToYuan(r.amount_cents);
    if (byDim.context) for (const r of byDim.context) this.monthAmountsByDim.context[r.tag_id] = centsToYuan(r.amount_cents);
    this.monthAmounts = this.monthAmountsByDim.category;

    // 日序列（expense only，按日期排序）；topColor = 该日金额最大的品类 tag 色（星轨日节点上色）
    const dailyExpense = (dailyStats.daily || []).filter(d => d.type === 'expense');
    this.days = dailyExpense.map(d => {
      const [yy, mm, dd] = d.date.split('-').map(Number);
      return {
        label: mm + '月' + dd + '日', date: d.date, y: yy, m: mm, d: dd,
        total: centsToYuan(d.amount_cents),
        topName: d.top_name || '',
        topColor: d.top_color || hashColor(d.top_name || ''),
      };
    });
  },

  // ===== 月选择 =====
  async selectMonth({ year, month }) {
    const from = monthStart(year, month);
    const to = monthEnd(year, month);
    this._window = { kind: 'month', year, month };
    this._currentMonthY = year;
    this._currentMonthM = month;

    await this._loadWindow(from, to);

    // 保证星轨连续：所选月无任何 expense 也入列（total 0）
    let idx = this.months.findIndex(m => m.y === year && m.m === month);
    if (idx === -1) {
      this.months.push({
        label: monthLabel(month),
        full: monthFull(year, month),
        total: 0,
        topName: '',
        topColor: '',
        y: year,
        m: month,
      });
      this.months.sort((a, b) => a.y - b.y || a.m - b.m);
      idx = this.months.findIndex(m => m.y === year && m.m === month);
    }

    // prevMonthTotal：从 months 数组中找前一格
    this.prevMonthTotal = idx > 0 ? this.months[idx - 1].total : 0;
  },

  // ===== 日选择 =====
  // 统计窗口＝当天；日序列现在是全量，星轨日档可自由拖动到任意时间
  async selectDay(date) {
    const [y, m] = date.split('-').map(Number);
    this._window = { kind: 'day', date, year: y, month: m };
    this._currentMonthY = y;
    this._currentMonthM = m;
    await this._loadWindow(date, date);

    // 日档的「上期」＝该月内有支出日序列里的前一天
    const i = this.days.findIndex(d => d.date === date);
    this.prevMonthTotal = i > 0 ? this.days[i - 1].total : 0;
  },

  // ===== 年选择 =====
  async selectYear(year) {
    this._window = { kind: 'year', year };
    this._currentMonthY = year;
    this._currentMonthM = null;
    await this._loadWindow(year + '-01-01', year + '-12-31');
    this.prevMonthTotal = 0; // 年环比需要跨年全量，UI 层在年档不显示环比
  },

  // ===== 定位最新月 =====
  gotoToday() {
    if (!this.months.length) return Promise.resolve();
    const last = this.months[this.months.length - 1];
    return this.selectMonth({ year: last.y, month: last.m });
  },

  // ===== 变更后刷新（按当前档位重新加载）=====
  async afterChange() {
    await this._loadMonths();
    const w = this._window;
    if (!w) return;
    if (w.kind === 'day' && w.date) await this.selectDay(w.date);
    else if (w.kind === 'year' && w.year) await this.selectYear(w.year);
    else if (w.year && w.month) await this.selectMonth({ year: w.year, month: w.month });
  },

  // ===== 建账本（建后入列表并选中，含默认维度）=====
  async createLedger(name) {
    const l = await API.createLedger(name);
    this.ledgers.push(l);
    await this.selectLedger(l.id); // 拉维度/月序列/最新月
    return l;
  },

  // ===== 当前账本内建 tag（建后刷新本地维度缓存）=====
  // parentTagId 给定 → 建为该主 tag 下的副 tag（S6-v3 两级结构）
  async createTag(dimensionKey, name, color, parentTagId = null) {
    const t = await API.createTag(this.ledgerId, { dimensionKey, name, color, parentTagId });
    await this._loadDims(); // 重拉维度（含新建 tag）
    return t;
  },

  // ===== 重排 tag 顺序（同层级整组全量重写）=====
  // parentTagId 省略 → 排该维主 tag；给定 → 排该主 tag 下的副 tag
  async reorderTags(dimensionKey, orderedIds, parentTagId = null) {
    const dim = await API.reorderTags(this.ledgerId, dimensionKey, orderedIds, parentTagId);
    await this._loadDims(); // 重拉维度（含新顺序）
    return dim;
  },

  // —— 私有方法 ——

  async _loadDims() {
    const { dimensions } = await API.getLedgerDims(this.ledgerId);
    this.dims = {};
    this.cats = [];
    this.ctxs = [];
    for (const dim of dimensions) {
      const all = (dim.tags || []).map(t => ({
        id: t.id,
        name: t.name,
        color: t.color || hashColor(t.name),
        is_unnamed: !!t.is_unnamed,
        parent_tag_id: t.parent_tag_id ?? null,
      }));
      // tag 是两级结构（S6-v3）：主 tag 之下挂副 tag。
      // cats/ctxs 只保留**主 tag** —— 副 tag 不能混进维度取值，否则星图会多出细分节点。
      const roots = all.filter(t => t.parent_tag_id === null);
      for (const r of roots) r.children = all.filter(t => t.parent_tag_id === r.id);
      this.dims[dim.key] = { id: dim.id, name: dim.name, all, roots };
      if (dim.key === 'category') this.cats = roots;
      else if (dim.key === 'context') this.ctxs = roots;
    }
  },

  async _loadMonths() {
    const raw = await API.getStats(this.ledgerId);
    const monthly = raw.monthly || [];

    // 按月聚合 expense；同时记录该月主导 tag（星轨月节点上色用）
    const byMonth = {};
    const topOf = {};
    for (const r of monthly) {
      if (r.type !== 'expense') continue;
      byMonth[r.month] = (byMonth[r.month] || 0) + r.amount_cents;
      if (r.top_name) topOf[r.month] = { name: r.top_name, color: r.top_color || hashColor(r.top_name) };
    }

    this.months = Object.keys(byMonth)
      .sort()
      .map(m => {
        const [y, mo] = m.split('-').map(Number);
        const top = topOf[m] || { name: '', color: '' };
        return {
          label: monthLabel(mo),
          full: monthFull(y, mo),
          total: centsToYuan(byMonth[m]),
          topName: top.name,
          topColor: top.color,
          y,
          m: mo,
        };
      });
  },
};

// —— 挂载（唯一对外出口）——
(typeof window !== 'undefined' ? window : globalThis).OrbitData = Data;

})();
