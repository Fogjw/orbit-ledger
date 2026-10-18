// 星轨换档与视口保持。
// 左 = 更早，右 = 离当前时间更近。
// 这两条曾经靠「离周期中心最近」和「把选中下标改写成月档下标」，结果下钻落到最早的节点、记账后星轨跳到最左侧。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = {};
vm.runInNewContext(
  readFileSync(join(here, '../timeline-nav.js'), 'utf8'),
  sandbox,
  { filename: 'timeline-nav.js' },
);
const T = sandbox.OrbitTimeline;

const days = [
  { date: '2026-01-05', y: 2026, m: 1 },
  { date: '2026-08-01', y: 2026, m: 8 },
  { date: '2026-08-31', y: 2026, m: 8 },
  { date: '2026-11-02', y: 2026, m: 11 },
  { date: '2026-12-31', y: 2026, m: 12 },
  { date: '2027-01-04', y: 2027, m: 1 },
];
const months = [
  { y: 2026, m: 1 },
  { y: 2026, m: 8 },
  { y: 2026, m: 11 },
  { y: 2026, m: 12 },
  { y: 2027, m: 1 },
];
const years = [{ y: 2026 }, { y: 2027 }];

function zoom(fromLevel, toLevel, selIdx) {
  return T.indexAfterZoom({ fromLevel, toLevel, selIdx, days, months, years });
}

describe('下钻落到当前节点最右的子节点', () => {
  test('8 月下钻到日，选中 8 月 31 日，而不是更靠近月中的 8 月 1 日', () => {
    const aug = months.findIndex((m) => m.y === 2026 && m.m === 8);
    const idx = zoom('month', 'day', aug);
    assert.equal(days[idx].date, '2026-08-31');
    // 旧算法以 8 月 15 日为锚找最近的一天：8/1 距它 14 天，8/31 距它 16 天，会落到最左的 8/1
    const mid = T.dayNum('2026-08-15');
    const aug1 = Math.abs(T.dayNum('2026-08-01') - mid);
    const aug31 = Math.abs(T.dayNum('2026-08-31') - mid);
    assert.ok(aug1 < aug31, '用例必须能区分新旧算法');
  });

  test('2026 年下钻到月，选中 12 月，而不是更靠近年中的 8 月', () => {
    const idx = zoom('year', 'month', years.findIndex((y) => y.y === 2026));
    assert.equal(months[idx].y, 2026);
    assert.equal(months[idx].m, 12);
    const july = T.dayNum('2026-07-01');
    const aug = Math.abs(T.dayNum('2026-08-15') - july);
    const dec = Math.abs(T.dayNum('2026-12-15') - july);
    assert.ok(aug < dec, '8 月比 12 月更靠近 7 月 1 日，旧算法会停在更早的月');
  });

  test('年档直接下钻到日，落在该年最右的一天', () => {
    const idx = zoom('year', 'day', 0);
    assert.equal(days[idx].date, '2026-12-31');
  });

  test('这一档里没有子节点时，靠向该周期的末端，不退回全轴最左', () => {
    const onlyLater = [
      { date: '2026-01-05', y: 2026, m: 1 },
      { date: '2026-09-01', y: 2026, m: 9 },
    ];
    const idx = T.indexAfterZoom({
      fromLevel: 'month',
      toLevel: 'day',
      selIdx: 0,
      days: onlyLater,
      months: [{ y: 2026, m: 8 }],
      years,
    });
    assert.equal(onlyLater[idx].date, '2026-09-01');
  });
});

describe('上卷落到包含当前节点的父周期', () => {
  test('12 月 31 日上卷到年，仍是 2026，而不是离 7 月 1 日更近的 2027', () => {
    const idx = zoom('day', 'year', days.findIndex((d) => d.date === '2026-12-31'));
    assert.equal(years[idx].y, 2026);
    const dec31 = T.dayNum('2026-12-31');
    const to2026 = Math.abs(T.dayNum('2026-07-01') - dec31);
    const to2027 = Math.abs(T.dayNum('2027-07-01') - dec31);
    assert.ok(to2027 < to2026, '用例必须能区分新旧算法');
  });

  test('8 月 1 日上卷到月，仍是 8 月', () => {
    const idx = zoom('day', 'month', days.findIndex((d) => d.date === '2026-08-01'));
    assert.equal(months[idx].m, 8);
    assert.equal(months[idx].y, 2026);
  });
});

describe('下钻后的视口对准选中节点', () => {
  test('8 月 31 日在 8 月 15 日锚点的右侧，pan 把它拉回中心', () => {
    const aug = months.findIndex((m) => m.y === 2026 && m.m === 8);
    const idx = zoom('month', 'day', aug);
    const real = T.focusRealDay('day', idx, days, months, years);
    assert.equal(real, T.dayNum('2026-08-31'));
    const nodes = days.map((d) => T.dayNum(d.date));
    const maxGap = 1000;
    const anchor = T.axisDay(T.dayNum('2026-08-15'), nodes, maxGap);
    const pan = T.panToHold(real, nodes, maxGap, anchor);
    assert.ok(pan > 0, '8 月 31 日在月中锚点右侧');
    assert.equal(T.realDayAt(anchor + pan, nodes, maxGap), real);
  });
});

describe('记账刷新后视口中心的真实日期不变', () => {
  test('节点坐标可往返；左侧插入更早的节点后，同一天仍停在中心', () => {
    const maxGap = 40;
    const before = [T.dayNum('2026-08-01'), T.dayNum('2026-08-31'), T.dayNum('2026-12-31')];
    for (const d of before) {
      assert.equal(T.realDayAt(T.axisDay(d, before, maxGap), before, maxGap), d);
    }
    const focus = T.dayNum('2026-08-31');
    const anchorBefore = T.axisDay(T.dayNum('2026-08-15'), before, maxGap);
    const centerAxis = anchorBefore + T.panToHold(focus, before, maxGap, anchorBefore);
    assert.equal(T.realDayAt(centerAxis, before, maxGap), focus);

    // 补记一笔更早的账：新节点插在最左侧，压缩轴上后面的点全部右移
    const after = [T.dayNum('2020-01-01'), ...before];
    const anchorAfter = T.axisDay(T.dayNum('2026-08-15'), after, maxGap);
    const pan = T.panToHold(T.realDayAt(centerAxis, before, maxGap), after, maxGap, anchorAfter);
    assert.equal(T.realDayAt(anchorAfter + pan, after, maxGap), focus);
    assert.notEqual(
      T.axisDay(focus, before, maxGap),
      T.axisDay(focus, after, maxGap),
      '插入左侧节点后轴坐标必须变化，否则这组用例区分不了「只留着旧 pan」',
    );
  });
});

describe('记账保存的接线', () => {
  test('保存不再把星轨选中态写成月档下标，并在刷新后交还视口', () => {
    const src = readFileSync(join(here, '../app.js'), 'utf8');
    assert.equal(src.includes("TL.sel={level:'month',idx:mi}"), false);
    assert.match(src, /Timeline\.indexAfterZoom/);
    assert.equal((src.match(/releaseRail\(held\)/g) || []).length, 2);
  });
});
