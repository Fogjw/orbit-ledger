// 星轨节点与看板共用的结余口径：
// 节点金额 = |收入 − 支出|；结余为正或零显示红色，为负显示绿色。
// 这里从数据层公开入口（OrbitData.init）取数，断言月份/日期的结余与展示规则；
// 期望值按分独立手算，不复用实现里的 total（total 仍是节点大小用的「有账总额」）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

// 手算账本（单位：分）：
// 2026-01：收入 25000 − 支出 10000 = +15000 分（+¥150）
// 2026-02：收入  5000 − 支出 30000 = -25000 分（-¥250）
const monthly = [
  { month: '2026-01', type: 'expense', amount_cents: 10000, top_name: '餐饮', top_color: '#f00' },
  { month: '2026-01', type: 'income', amount_cents: 25000, top_name: '收入·工资', top_color: '#0f0' },
  { month: '2026-02', type: 'expense', amount_cents: 30000, top_name: '居住', top_color: '#00f' },
  { month: '2026-02', type: 'income', amount_cents: 5000, top_name: '收入·红包', top_color: '#0f0' },
];
const daily = [
  { date: '2026-01-03', type: 'expense', amount_cents: 10000, top_name: '餐饮', top_color: '#f00' },
  { date: '2026-01-03', type: 'income', amount_cents: 25000, top_name: '收入·工资', top_color: '#0f0' },
  { date: '2026-02-04', type: 'expense', amount_cents: 30000, top_name: '居住', top_color: '#00f' },
  { date: '2026-02-04', type: 'income', amount_cents: 5000, top_name: '收入·红包', top_color: '#0f0' },
];

// 只实现 data.js 初始化会走到的三个公开方法；时间窗统计固定返回 2026-02，
// 日序列固定返回全量 —— 与真实 API 的契约相同，测试不依赖内部实现。
const API = {
  listLedgers: async () => [{ id: 1, name: '测试账本' }],
  getLedgerDims: async () => ({ dimensions: [] }),
  getStats: async (_ledgerId, opts = {}) => {
    if (!opts.from && !opts.to && !opts.type) return { monthly, daily };
    if (opts.type === 'income') {
      return { totals: { expense: 0, income: 5000 }, byDimension: { category: [], context: [] } };
    }
    return { totals: { expense: 30000, income: 0 }, byDimension: { category: [], context: [] } };
  },
};

async function loadData() {
  const sandbox = { window: { OrbitAPI: API } };
  vm.runInNewContext(readFileSync(join(here, '../data.js'), 'utf8'), sandbox, { filename: 'data.js' });
  await sandbox.window.OrbitData.init();
  return sandbox.window.OrbitData;
}

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
const isRed = (hex) => { const [r, g, b] = rgb(hex); return r > g && r > b; };
const isGreen = (hex) => { const [r, g, b] = rgb(hex); return g > r && g > b; };

describe('星轨/看板的结余口径', () => {
  test('月份结余 = 收入 − 支出；total 仍是节点大小用的有账总额', async () => {
    const Data = await loadData();
    const jan = Data.months.find((m) => m.y === 2026 && m.m === 1);
    const feb = Data.months.find((m) => m.y === 2026 && m.m === 2);

    assert.equal(jan.balance, 150, '1 月结余应为 +¥150');
    assert.equal(feb.balance, -250, '2 月结余应为 −¥250');
    // total 没被改成结余：星等/节点大小仍按「这个月记了多少账」。
    assert.equal(jan.total, 350);
    assert.equal(feb.total, 350);
  });

  test('日结余逐日 = 当日收入 − 当日支出；total 不被改写', async () => {
    const Data = await loadData();
    const byDate = new Map(Data.days.map((d) => [d.date, d]));

    assert.equal(byDate.get('2026-01-03').balance, 150);
    assert.equal(byDate.get('2026-02-04').balance, -250);
    assert.equal(byDate.get('2026-01-03').total, 350);
  });

  test('结余正/零显示红色，为负显示绿色；金额只取绝对值', async () => {
    const Data = await loadData();

    assert.ok(isRed(Data.INCOME_RED), '收入/结余正数应为红色');
    assert.ok(isGreen(Data.EXPENSE_GREEN), '支出/结余负数应为绿色');
    assert.equal(Data.balanceColor(150), Data.INCOME_RED);
    assert.equal(Data.balanceColor(0), Data.INCOME_RED, '收入=支出（相等）也显示红色');
    assert.equal(Data.balanceColor(-250), Data.EXPENSE_GREEN);
    // 一分以下的浮点毛刺不能把 0 判成负数。
    assert.equal(Data.balanceColor(-1e-9), Data.INCOME_RED);

    assert.equal(Data.balanceAbs(150), 150);
    assert.equal(Data.balanceAbs(-250), 250, '读取的是绝对值，不能带负号');
    assert.equal(Data.balanceAbs(0), 0);
    assert.equal(Data.balanceAbs(0.1 + 0.2), 0.3, '按分取整后再取绝对值');
  });
});
