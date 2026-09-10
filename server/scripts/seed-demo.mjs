// 演示数据种子（经 REST，供前端开发/验收；在服务运行后执行）
// 用法：npm run seed:demo —— 需先 npm run dev 起服务
//
// 数据由**确定性伪随机**生成（固定种子）：同一份脚本每次产出完全相同的数据，
// 便于对着图讨论「这一处不对」时能复现。时间跨度 2025-01 ~ 今天，
// 金额跨 ¥2 ~ ¥1800（检验星图的 √ 金额编码），并刻意制造多副 tag 共存的账单
// （一笔同时挂两个细分 → 下钻图里会出现共享线）。
//
// 幂等说明：tag 建重（409）自动跳过；花销会叠加。
// 干净重来 = 删 server/data/orbit.db* → 起服务 → npm run seed:demo。
const base = 'http://localhost:5310/api';
const H = { 'Content-Type': 'application/json' };
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}
const ok = (r) => r.status >= 200 && r.status < 300;

/* ---------- 确定性伪随机 ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260910);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
/** 元 → 分（区间随机，保留到元） */
const yuan = (a, b) => Math.round(a + rand() * (b - a)) * 100;

/** 账本 1 的「tag 名 → id」表 */
async function tagIds() {
  const r = await call('GET', '/ledgers/1/dimensions');
  const map = {};
  if (ok(r)) for (const d of r.data.dimensions) for (const t of d.tags) map[t.name] = t.id;
  return map;
}

let ids = await tagIds();
if (!ids['餐饮']) {
  console.error('账本 1 不存在或未初始化 —— 请先 `npm run dev` 起服务（首次会自动建演示库）');
  process.exit(1);
}

// ---------- 1. 标签体系 ----------
// 副 tag 挂在主 tag 下（S6-v3）：本主 tag 的账单才可选它。
const SUBTAGS = {
  '餐饮': [['早餐', '#ffd166'], ['午餐', '#ff9f5a'], ['晚餐', '#ff7a9e'], ['夜宵', '#ffb066'], ['奢侈一把', '#ef4444']],
  '交通': [['公交', '#5ad7ff'], ['地铁', '#3b82f6'], ['高铁', '#8b5cf6'], ['打车', '#22c55e']],
  '娱乐': [['电影', '#b48cff'], ['游戏', '#ec4899'], ['演出', '#f97316']],
  '日用': [['超市', '#6fe3a8'], ['日用百货', '#14b8a6']],
  '学习': [['书籍', '#f43f5e'], ['课程', '#eab308']],
  '居住': [['房租', '#ff7a9e'], ['水电', '#0ea5e9']],
};
for (const [parent, subs] of Object.entries(SUBTAGS)) {
  if (!ids[parent]) continue;
  for (const [name, color] of subs) {
    await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name, color, parentTagId: ids[parent] });
  }
}
// 情境维补几个常用场景（原种子只有 4 个）
for (const [name, color] of [['加班', '#8b5cf6'], ['出差', '#0ea5e9'], ['旅行', '#f97316']]) {
  await call('POST', '/ledgers/1/tags', { dimensionKey: 'context', name, color });
}
// 收入类目（根级主 tag）
await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name: '收入·生活费', color: '#6fe3a8' });
await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name: '收入·工资', color: '#22c55e' });
await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name: '收入·红包', color: '#84cc16' });

// ---------- 2. 逐日生成 ----------
const today = new Date().toISOString().slice(0, 10);
const CTX_WORK = ['通勤', '独处', '加班'];
const CTX_WEEKEND = ['和朋友', '和对象', '独处', '旅行'];
const CTX_ANY = ['和朋友', '独处', '和对象', '加班', '出差', '旅行'];

/** 一笔：[date, amountCents, primary, subTagNames] */
function meals(iso) {
  const out = [];
  const slot = [['早餐', 6, 15], ['午餐', 12, 35], ['晚餐', 15, 60]];
  // 早/午/晚按概率出现（不是每天都三餐齐全，更像真实记账）
  for (const [name, lo, hi] of slot) {
    if (rand() < 0.72) {
      const ctx = name === '早餐' ? pick(['独处', '通勤']) : pick(CTX_ANY);
      out.push([iso, yuan(lo, hi), { category: '餐饮', context: ctx }, [name]]);
    }
  }
  // 夜宵：周末与加班后更常见
  if (rand() < 0.22) out.push([iso, yuan(20, 80), { category: '餐饮', context: pick(['和朋友', '加班', '独处']) }, ['夜宵']]);
  // 偶尔奢侈一把：同时挂晚餐/夜宵 → 制造多副 tag 共存（下钻图里的共享线）
  if (rand() < 0.07) {
    const withMeal = rand() < 0.6 ? [pick(['晚餐', '夜宵']), '奢侈一把'] : ['奢侈一把'];
    out.push([iso, yuan(120, 420), { category: '餐饮', context: pick(['和朋友', '和对象']) }, withMeal]);
  }
  return out;
}
function transport(iso, weekend) {
  if (weekend) return [iso, yuan(20, 60), { category: '交通', context: pick(CTX_WEEKEND) }, ['打车']];
  const r = rand();
  if (r < 0.62) return [iso, yuan(3, 10), { category: '交通', context: '通勤' }, ['地铁']];
  if (r < 0.88) return [iso, yuan(2, 6), { category: '交通', context: '通勤' }, ['公交']];
  if (r < 0.95) return [iso, yuan(20, 60), { category: '交通', context: pick(CTX_ANY) }, ['打车']];
  return [iso, yuan(80, 420), { category: '交通', context: pick(['出差', '旅行']) }, ['高铁']];
}
function fun(iso, weekend) {
  const r = rand();
  if (r < 0.55) return [iso, yuan(30, 80), { category: '娱乐', context: pick(CTX_WEEKEND) }, ['电影']];
  if (r < 0.88) return [iso, yuan(30, 200), { category: '娱乐', context: pick(['独处', '和朋友']) }, ['游戏']];
  return [iso, yuan(100, 420), { category: '娱乐', context: pick(['和朋友', '和对象', '旅行']) }, ['演出']];
}

const SEED = [];
let d = new Date(Date.UTC(2025, 0, 1));
const end = new Date(today + 'T00:00:00Z');
while (d <= end) {
  const iso = d.toISOString().slice(0, 10);
  const dow = d.getUTCDay();
  const weekend = (dow === 0 || dow === 6);
  const day = d.getUTCDate();

  SEED.push(...meals(iso, day));
  if (!weekend && rand() < 0.85) SEED.push(transport(iso, false));
  if (weekend && rand() < 0.6) SEED.push(transport(iso, true));
  if (rand() < (weekend ? 0.5 : 0.16)) SEED.push(fun(iso, weekend));
  if (rand() < 0.22) SEED.push([iso, yuan(20, 150), { category: '日用', context: pick(['独处', '和朋友']) }, [pick(['超市', '日用百货'])]]);
  if (rand() < 0.09) SEED.push([iso, yuan(20, 600), { category: '学习', context: '独处' }, [pick(['书籍', '课程'])]]);
  // 每月固定项
  if (day === 1) {
    SEED.push([iso, yuan(1200, 1800), { category: '居住' }, ['房租']]);
    SEED.push([iso, yuan(2500, 3500), { category: '收入·生活费' }, []]);
  }
  if (day === 5) SEED.push([iso, yuan(60, 220), { category: '居住' }, ['水电']]);
  if (day === 15 && rand() < 0.7) SEED.push([iso, yuan(50, 500), { category: '收入·工资' }, []]);
  if (rand() < 0.05) SEED.push([iso, yuan(20, 800), { category: '收入·红包' }, []]);

  d = new Date(d.getTime() + 86400000);
}

// ---------- 3. 逐笔记账（走 REST，等价于人工录入，规则同源） ----------
let sent = 0, failed = 0;
for (const [date, amountCents, primary, tags] of SEED) {
  const type = String(primary.category || '').startsWith('收入') ? 'income' : 'expense';
  const r = await call('POST', '/ledgers/1/expenses', { type, amountCents, date, primary, tags });
  if (ok(r)) sent++;
  else { failed++; if (failed <= 5) console.log('WARN', date, r.status, JSON.stringify(r.data)); }
}

// ---------- 4. 摘要 ----------
const stats = await call('GET', '/ledgers/1/stats');
const totals = stats.data.totals || {};
console.log(`生成 ${SEED.length} 笔，成功 ${sent}，失败 ${failed}`);
console.log(`累计支出 ¥${Math.round((totals.expense || 0) / 100).toLocaleString()}，收入 ¥${Math.round((totals.income || 0) / 100).toLocaleString()}`);
const monthly = (stats.data.monthly || []).filter(m => m.type === 'expense');
console.log(`覆盖 ${monthly.length} 个月：${monthly[0]?.month} ~ ${monthly[monthly.length - 1]?.month}`);
const top = (stats.data.byDimension.category || []).slice(0, 6);
for (const t of top) console.log(`  ${t.name}: ¥${Math.round(t.amount_cents / 100).toLocaleString()}`);
console.log('种子完成 ✅');
