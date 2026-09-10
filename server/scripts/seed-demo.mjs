// 演示数据种子（经 REST，供前端开发/验收；在服务运行后执行）
// 用法：npm run seed:demo —— 需先 npm run dev 起服务
// 幂等说明：tag 建重（409）自动跳过；花销会叠加，干净库 = 删 data/orbit.db 后重启服务再跑
const base = 'http://localhost:5310/api';
const H = { 'Content-Type': 'application/json' };
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}
const ok = (r) => r.status >= 200 && r.status < 300;

/** 账本 1 的「tag 名 → id」表（主 tag 与副 tag 都在内） */
async function tagIds() {
  const r = await call('GET', '/ledgers/1/dimensions');
  const map = {};
  if (ok(r)) for (const d of r.data.dimensions) for (const t of d.tags) map[t.name] = t.id;
  return map;
}

const ids = await tagIds();
if (!ids['餐饮']) {
  console.error('账本 1 不存在或未初始化 —— 请先 `npm run dev` 起服务（首次会自动建演示库）');
  process.exit(1);
}

// 1. 副 tag 体系（S6-v3：副 tag 挂在主 tag 下，只在本主 tag 的账单里可选）
//    对应产品场景：餐饮 → 早餐/午餐/晚餐/夜宵；交通通勤 → 公交/地铁/高铁
const SUBTAGS = {
  '餐饮': [['早餐', '#ffd166'], ['午餐', '#ff9f5a'], ['晚餐', '#ff7a9e'], ['夜宵', '#ffb066'], ['奢侈一把', '#ef4444']],
  '交通': [['公交', '#5ad7ff'], ['地铁', '#3b82f6'], ['高铁', '#8b5cf6']],
  '娱乐': [['电影', '#b48cff'], ['游戏', '#ec4899']],
};
for (const [parent, subs] of Object.entries(SUBTAGS)) {
  for (const [name, color] of subs) {
    await call('POST', '/ledgers/1/tags', {
      dimensionKey: 'category', name, color, parentTagId: ids[parent],
    }); // 409 已存在则跳过
  }
}
// 收入类目（根级主 tag）
await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name: '收入·生活费', color: '#6fe3a8' });

// 2. 演示数据（月/日/品类/情境齐备；3-6 月供星轨跨月）
//    [日期, 金额分, 主 tag, 副 tag 名数组]
const SEED = [
  // 2026-03
  ['2026-03-08', 4600, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-03-15', 2000, { category: '交通', context: '通勤' }, ['地铁']],
  ['2026-03-22', 8800, { category: '娱乐', context: '和朋友' }, ['电影']],
  // 2026-04
  ['2026-04-05', 1200, { category: '日用' }, []],
  ['2026-04-12', 15600, { category: '娱乐', context: '和对象' }, ['电影']],
  ['2026-04-20', 2400, { category: '餐饮', context: '独处' }, ['午餐']],
  // 2026-05
  ['2026-05-02', 42000, { category: '居住' }, []],
  ['2026-05-06', 3600, { category: '餐饮', context: '和朋友' }, ['晚餐']],
  ['2026-05-10', 7800, { category: '娱乐', context: '和朋友' }, ['游戏']],
  ['2026-05-14', 1500, { category: '交通', context: '通勤' }, ['公交']],
  ['2026-05-18', 2400, { category: '餐饮', context: '独处' }, ['早餐']],
  ['2026-05-21', 6800, { category: '娱乐', context: '和朋友' }, ['电影']],
  ['2026-05-25', 2600, { category: '日用' }, []],
  ['2026-05-28', 3200, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-05-30', 900, { category: '交通' }, ['公交']],
  // 2026-06
  ['2026-06-01', 150000, { category: '居住' }, []],
  ['2026-06-02', 1600, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-06-03', 800, { category: '餐饮' }, ['早餐']],
  ['2026-06-05', 3500, { category: '餐饮', context: '和朋友' }, ['夜宵', '奢侈一把']],
  ['2026-06-06', 1200, { category: '交通', context: '通勤' }, ['地铁']],
  ['2026-06-07', 4560, { category: '餐饮', context: '和朋友' }, ['午餐']],
  ['2026-06-08', 8800, { category: '娱乐', context: '和朋友' }, ['电影']],
  ['2026-06-10', 2100, { category: '交通', context: '通勤' }, ['高铁']],
  ['2026-06-12', 660, { category: '日用' }, []],
  // 什么都没选 → 各维落「未分类」占位（演示缺省兜底）
  ['2026-06-13', 1500, {}, []],
  ['2026-06-15', 3200, { category: '餐饮', context: '独处' }, ['晚餐']],
  ['2026-06-18', 12800, { category: '娱乐', context: '和对象' }, ['电影']],
  ['2026-06-20', 45800, { category: '居住' }, []],
  ['2026-06-22', 1800, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-06-25', 2400, { category: '交通', context: '通勤' }, ['地铁']],
  ['2026-06-28', 5600, { category: '娱乐', context: '和朋友' }, ['游戏']],
  // 收入（每月一笔）
  ['2026-03-01', 250000, { category: '收入·生活费' }, []],
  ['2026-04-01', 250000, { category: '收入·生活费' }, []],
  ['2026-05-01', 250000, { category: '收入·生活费' }, []],
  ['2026-06-01', 250000, { category: '收入·生活费' }, []],
];
for (const [date, amountCents, primary, tags] of SEED) {
  // 收入行主 tag 是「收入·生活费」→ 记 income，其余记 expense
  const type = primary.category === '收入·生活费' ? 'income' : 'expense';
  const r = await call('POST', '/ledgers/1/expenses', { type, amountCents, date, primary, tags });
  if (!ok(r)) console.log('WARN', date, r.status, JSON.stringify(r.data));
}
// 验证 6 月统计
const stats = await call('GET', '/ledgers/1/stats?from=2026-06-01&to=2026-06-30');
console.log('6月 expense 总额:', stats.data.totals.expense);
const cat = stats.data.byDimension.category || [];
for (const t of cat) console.log(`  ${t.name}: ¥${(t.amount_cents / 100).toFixed(0)}`);
console.log('种子完成 ✅');
