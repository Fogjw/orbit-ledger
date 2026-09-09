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

// 1. 建补充 tag（夜宵=品类副 tag；收入·生活费=品类收入 tag）——409 已存在则跳过
await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name: '夜宵', color: '#ffb066' });
await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name: '收入·生活费', color: '#6fe3a8' });

// 2. 演示数据（月/日/品类/情境齐备；5-6 月为主，3-4 月少量供星轨跨月）
const SEED = [
  // 2026-03
  ['2026-03-08', 4600, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-03-15', 2000, { category: '交通', context: '通勤' }, []],
  ['2026-03-22', 8800, { category: '娱乐', context: '和朋友' }, []],
  // 2026-04
  ['2026-04-05', 1200, { category: '日用' }, []],
  ['2026-04-12', 15600, { category: '娱乐', context: '和对象' }, []],
  ['2026-04-20', 2400, { category: '餐饮', context: '独处' }, []],
  // 2026-05
  ['2026-05-02', 42000, { category: '居住' }, []],
  ['2026-05-06', 3600, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-05-10', 7800, { category: '娱乐', context: '和朋友' }, []],
  ['2026-05-14', 1500, { category: '交通', context: '通勤' }, []],
  ['2026-05-18', 2400, { category: '餐饮', context: '独处' }, []],
  ['2026-05-21', 6800, { category: '娱乐', context: '和朋友' }, []],
  ['2026-05-25', 2600, { category: '日用' }, []],
  ['2026-05-28', 3200, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-05-30', 900, { category: '交通' }, []],
  // 2026-06
  ['2026-06-01', 150000, { category: '居住' }, []],
  ['2026-06-02', 1600, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-06-03', 800, { category: '餐饮' }, []],
  ['2026-06-05', 3500, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-06-06', 1200, { category: '交通', context: '通勤' }, []],
  ['2026-06-07', 4560, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-06-08', 8800, { category: '娱乐', context: '和朋友' }, []],
  ['2026-06-10', 2100, { category: '交通', context: '通勤' }, []],
  ['2026-06-12', 660, { category: '日用' }, []],
  ['2026-06-15', 3200, { category: '餐饮', context: '独处' }, []],
  ['2026-06-18', 12800, { category: '娱乐', context: '和对象' }, []],
  ['2026-06-20', 45800, { category: '居住' }, []],
  ['2026-06-22', 1800, { category: '餐饮', context: '和朋友' }, ['夜宵']],
  ['2026-06-25', 2400, { category: '交通', context: '通勤' }, []],
  ['2026-06-28', 5600, { category: '娱乐', context: '和朋友' }, []],
  // 收入（每月一笔）
  ['2026-03-01', 250000, { category: '收入·生活费' }, []],
  ['2026-04-01', 250000, { category: '收入·生活费' }, []],
  ['2026-05-01', 250000, { category: '收入·生活费' }, []],
  ['2026-06-01', 250000, { category: '收入·生活费' }, []],
];
for (const [date, amountCents, primary, tags] of SEED) {
  const r = await call('POST', '/ledgers/1/expenses', { type: 'expense', amountCents, date, primary, tags });
  if (!ok(r)) console.log('WARN', date, r.status, JSON.stringify(r.data));
}
// 验证 6 月统计
const stats = await call('GET', '/ledgers/1/stats?from=2026-06-01&to=2026-06-30');
console.log('6月 expense 总额:', stats.data.totals.expense);
const cat = stats.data.byDimension.category || [];
for (const t of cat) console.log(`  ${t.name}: ¥${(t.amount_cents / 100).toFixed(0)}`);
console.log('种子完成 ✅');
