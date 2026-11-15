// 计划口径的纯函数：剩余/超支标签、进度、续期、启动页解析。
// 颜色由 web/data.js 的 balanceColor 决定；这里只锁「标签 + 绝对值 + 不产生 NaN」。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = {};
vm.runInNewContext(readFileSync(join(here, '../plan-utils.js'), 'utf8'), sandbox, { filename: 'plan-utils.js' });
const U = sandbox.OrbitPlanUtils;

describe('计划余额口径', () => {
  test('剩余/超支只由符号决定，标签与绝对值', () => {
    const m1 = U.planMetrics({
      budget_cents: 200000, spent_cents: 131950, income_cents: 0,
      start_date: '2026-11-01', end_date: '2026-11-30', bill_count: 23,
    }, '2026-11-15');
    assert.equal(m1.remainingCents, 68050);
    assert.equal(m1.remainingLabel, '剩余');
    assert.equal(Math.round(m1.usedPct), 66);
    assert.equal(m1.timePct, 50);
    assert.equal(m1.daysLeft, 15);
    assert.equal(m1.dailyLeftCents, 4536);

    const m2 = U.planMetrics({
      budget_cents: 100000, spent_cents: 124000, income_cents: 0,
      start_date: '2026-11-01', end_date: '2026-11-15',
    }, '2026-11-15');
    assert.equal(m2.remainingCents, -24000);
    assert.equal(m2.remainingLabel, '超支');
  });

  test('预算为 0 / 无账单不产生 NaN', () => {
    const m = U.planMetrics({
      budget_cents: 0, spent_cents: 0, income_cents: 0,
      start_date: '2026-11-01', end_date: '2026-11-30', bill_count: 0,
    }, '2026-11-15');
    assert.equal(m.usedPct, 0);
    assert.ok(Number.isFinite(m.dailyLeftCents));
    assert.ok(Number.isFinite(m.projectedOverspendCents));
  });
});

describe('计划分组与续期', () => {
  test('未开始并入进行中，结束的按结束日倒序', () => {
    const g = U.planGroups([
      { id: 1, start_date: '2026-11-01', end_date: '2026-11-30' },
      { id: 2, start_date: '2026-12-01', end_date: '2026-12-31' },
      { id: 3, start_date: '2026-09-01', end_date: '2026-09-30' },
    ], '2026-11-15');
    assert.deepEqual([...g.active.map(p => p.id)], [1, 2]);
    assert.deepEqual([...g.ended.map(p => p.id)], [3]);
  });

  test('一键续期：整月顺延到下一个自然月，非整月按天数平移', () => {
    // VM 沙箱里创建的数组/对象原型与宿主不同，展开成宿主对象再深比较
    assert.deepEqual({ ...U.nextRange({ start_date: '2026-11-01', end_date: '2026-11-30' }) },
      { startDate: '2026-12-01', endDate: '2026-12-31' });
    assert.deepEqual({ ...U.nextRange({ start_date: '2026-11-10', end_date: '2026-11-20' }) },
      { startDate: '2026-11-21', endDate: '2026-12-01' });
  });

  test('启动页 JSON 解析容错', () => {
    assert.equal(U.parseStartPage('{"ledgerId":1,"planId":2}').planId, 2);
    assert.equal(U.parseStartPage('bad'), null);
    assert.equal(U.parseStartPage(null), null);
  });
});
