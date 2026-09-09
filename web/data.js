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
  cats: [],
  ctxs: [],
  months: [],
  days: [],
  monthAmounts: {},
  monthAmountsByDim: {}, // {category: {tagId: 元}, context: {tagId: 元}} 两份维度口径，渲染层按需取
  monthTotal: 0,
  prevMonthTotal: 0,
  monthRange: { from: null, to: null },

  // —— 维度原始缓存（渲染层不直接用）——
  _currentMonthY: null,
  _currentMonthM: null,

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
    this.monthTotal = 0;
    this.prevMonthTotal = 0;
    this.monthAmountsByDim = { category: {}, context: {} };
    this.monthAmounts = {};
    this.days = [];
  },

  // ===== 月选择 =====
  async selectMonth({ year, month }) {
    const from = monthStart(year, month);
    const to = monthEnd(year, month);
    this.monthRange = { from, to };
    this._currentMonthY = year;
    this._currentMonthM = month;

    const [periodStats, allStats] = await Promise.all([
      API.getStats(this.ledgerId, { from, to, type: 'expense' }),
      API.getStats(this.ledgerId, { from, to }),
    ]);

    this.monthTotal = centsToYuan(periodStats.totals.expense || 0);

    // 两份维度口径
    this.monthAmountsByDim = { category: {}, context: {} };
    const byDim = periodStats.byDimension || {};
    if (byDim.category) for (const r of byDim.category) this.monthAmountsByDim.category[r.tag_id] = centsToYuan(r.amount_cents);
    if (byDim.context) for (const r of byDim.context) this.monthAmountsByDim.context[r.tag_id] = centsToYuan(r.amount_cents);
    this.monthAmounts = this.monthAmountsByDim.category;

    // 日序列（expense only，按日期排序）
    const dailyExpense = (allStats.daily || []).filter(d => d.type === 'expense');
    this.days = dailyExpense.map(d => {
      const [, mm, dd] = d.date.split('-').map(Number);
      return {
        label: mm + '月' + dd + '日',
        date: d.date,
        total: centsToYuan(d.amount_cents),
      };
    });

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

  // ===== 定位最新月 =====
  gotoToday() {
    if (!this.months.length) return Promise.resolve();
    const last = this.months[this.months.length - 1];
    return this.selectMonth({ year: last.y, month: last.m });
  },

  // ===== 变更后刷新 =====
  async afterChange() {
    await this._loadMonths();
    if (this._currentMonthY && this._currentMonthM) {
      await this.selectMonth({ year: this._currentMonthY, month: this._currentMonthM });
    }
  },

  // ===== 建账本（建后入列表并选中，含默认维度）=====
  async createLedger(name) {
    const l = await API.createLedger(name);
    this.ledgers.push(l);
    await this.selectLedger(l.id); // 拉维度/月序列/最新月
    return l;
  },

  // ===== 当前账本内建 tag（建后刷新本地维度缓存）=====
  async createTag(dimensionKey, name, color) {
    const t = await API.createTag(this.ledgerId, { dimensionKey, name, color });
    await this._loadDims(); // 重拉维度（含新建 tag）
    return t;
  },

  // —— 私有方法 ——

  async _loadDims() {
    const { dimensions } = await API.getLedgerDims(this.ledgerId);
    this.cats = [];
    this.ctxs = [];
    for (const dim of dimensions) {
      const mapped = (dim.tags || []).map(t => ({
        id: t.id,
        name: t.name,
        color: t.color || hashColor(t.name),
        is_unnamed: !!t.is_unnamed,
      }));
      if (dim.key === 'category') this.cats = mapped;
      else if (dim.key === 'context') this.ctxs = mapped;
    }
  },

  async _loadMonths() {
    const raw = await API.getStats(this.ledgerId);
    const monthly = raw.monthly || [];

    // 按月聚合 expense
    const byMonth = {};
    for (const r of monthly) {
      if (r.type !== 'expense') continue;
      if (!byMonth[r.month]) byMonth[r.month] = 0;
      byMonth[r.month] += r.amount_cents;
    }

    this.months = Object.keys(byMonth)
      .sort()
      .map(m => {
        const [y, mo] = m.split('-').map(Number);
        return {
          label: monthLabel(mo),
          full: monthFull(y, mo),
          total: centsToYuan(byMonth[m]),
          topName: '',
          topColor: '',
          y,
          m: mo,
        };
      });
  },
};

// —— 挂载（唯一对外出口）——
(typeof window !== 'undefined' ? window : globalThis).OrbitData = Data;

})();
