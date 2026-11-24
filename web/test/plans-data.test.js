// 计划作用域：进入计划后所有统计请求都带 planId，月份序列只剩计划内月份。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const statsCalls = [];
const PLAN = {
  id: 7, name: '生活费', budget_cents: 200000, spent_cents: 131950, income_cents: 0,
  remaining_cents: 68050, start_date: '2026-11-01', end_date: '2026-11-30', bill_count: 23,
};
const API = {
  listLedgers: async () => [{ id: 1, name: 'L' }],
  getLedgerDims: async () => ({ dimensions: [] }),
  listPlans: async () => ({ items: [PLAN], count: 1 }),
  listExpenses: async () => ({ items: [], count: 0 }),
  getStats: async (_ledgerId, opts = {}) => {
    statsCalls.push({ ...opts });
    if (opts.planId) {
      if (opts.type === 'income') return { totals: { expense: 0, income: 0 }, byDimension: { category: [], context: [] } };
      return {
        totals: { expense: 131950, income: 0 },
        byDimension: { category: [], context: [] },
        monthly: [{ month: '2026-11', type: 'expense', amount_cents: 131950 }],
        daily: [{ date: '2026-11-05', type: 'expense', amount_cents: 1000 }],
      };
    }
    return { totals: { expense: 0, income: 0 }, byDimension: { category: [], context: [] }, monthly: [], daily: [] };
  },
};

async function loadData() {
  const sandbox = { window: { OrbitAPI: API } };
  vm.runInNewContext(readFileSync(join(here, '../data.js'), 'utf8'), sandbox, { filename: 'data.js' });
  await sandbox.window.OrbitData.init();
  return sandbox.window.OrbitData;
}

describe('计划作用域', () => {
  test('selectPlan：scope 切换、统计带 planId、月份只剩计划内', async () => {
    const Data = await loadData();
    assert.equal(Data.scope.kind, 'ledger');
    const before = statsCalls.length;

    assert.equal(await Data.selectPlan(7), true);
    assert.equal(Data.scope.kind, 'plan');
    assert.equal(Data.scope.planId, 7);
    assert.equal(Data.currentPlan().remaining_cents, 68050);
    assert.deepEqual([...Data.months.map(m => m.m)], [11], '月份序列只剩计划内月份');
    assert.ok(statsCalls.slice(before).every(c => c.planId === 7), '进入计划后的统计都带 planId');
  });

  test('exitPlan 回到账本作用域', async () => {
    const Data = await loadData();
    await Data.selectPlan(7);
    await Data.exitPlan();
    assert.equal(Data.scope.kind, 'ledger');
    assert.equal(Data.scope.planId, null);
  });

  test('计划不存在时 selectPlan 返回 false 且不改 scope', async () => {
    const Data = await loadData();
    assert.equal(await Data.selectPlan(999), false);
    assert.equal(Data.scope.kind, 'ledger');
  });
});
