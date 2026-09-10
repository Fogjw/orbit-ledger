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
// 先把**收入类目**建出来（根级主 tag）—— 它们的副 tag 也走同一套 SUBTAGS 机制，
// 所以父必须先存在，否则下面挂副 tag 时会因为找不到父而跳过。
for (const [name, color] of [
  ['收入·生活费', '#6fe3a8'], ['收入·工资', '#22c55e'],
  ['收入·红包', '#84cc16'], ['收入·转账', '#14b8a6'],
]) {
  await call('POST', '/ledgers/1/tags', { dimensionKey: 'category', name, color });
}
ids = await tagIds();   // 重取，带上刚建的收入类目

// 副 tag 挂在主 tag 下（S6-v3）：本主 tag 的账单才可选它。
// 「餐饮」刻意做成**两个可交叉的组**：餐段（早/午/晚/夜宵，互斥）× 用餐方式（堂食/外卖/自己做，互斥）
//   ⇒ 一笔可以是「午餐 + 外卖」，共享线才有真实语义；
//   而「早餐 + 午餐」这种同一组内的组合必须被禁止（一顿饭不会既是早餐又是午餐）。
const SUBTAGS = {
  '餐饮': [
    ['早餐', '#ffd166'], ['午餐', '#ff9f5a'], ['晚餐', '#ff7a9e'], ['夜宵', '#ffb066'],
    ['堂食', '#a78bfa'], ['外卖', '#22d3ee'], ['自己做', '#6fe3a8'],
    ['奢侈一把', '#ef4444'],
  ],
  '交通': [['公交', '#5ad7ff'], ['地铁', '#3b82f6'], ['高铁', '#8b5cf6'], ['打车', '#22c55e']],
  '娱乐': [['电影', '#b48cff'], ['游戏', '#ec4899'], ['演出', '#f97316']],
  '日用': [['超市', '#6fe3a8'], ['日用百货', '#14b8a6']],
  '学习': [['书籍', '#f43f5e'], ['课程', '#eab308']],
  '居住': [['房租', '#ff7a9e'], ['水电', '#0ea5e9']],
  // 收入类目同样有细分（完全对标支出，只是星形不同）
  '收入·生活费': [['家用', '#6fe3a8'], ['零花', '#34d399']],
  '收入·工资': [['月薪', '#22c55e'], ['奖金', '#84cc16'], ['补贴', '#4ade80']],
  '收入·红包': [['节日', '#f43f5e'], ['亲友', '#fb7185']],
  '收入·转账': [['收款', '#14b8a6'], ['还款', '#0ea5e9']],
};

/** 演示数据的合理性约束：同组细分不该同时出现在一笔账单上。
    注意 —— 这**只是生成器的口味，不是业务规则**：
    产品上用户完全可以记一笔「早餐 + 午餐」，后端不拦、也不该拦。
    这里只是别让演示数据出现一眼假的组合。 */
const EXCLUSIVE_GROUPS = {
  '餐饮': [
    ['早餐', '午餐', '晚餐', '夜宵'],   // 餐段
    ['堂食', '外卖', '自己做'],          // 用餐方式
  ],
  '交通': [['公交', '地铁', '高铁', '打车']],   // 一次出行只用一种方式
  '娱乐': [['电影', '游戏', '演出']],
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

// ---------- 2. 逐日生成 ----------
/* 常见搭配：让「共享线」集中在少数几对上，而不是散成几百条只出现一次的细线。
   注意只写**跨组**组合（餐段 × 用餐方式）—— 同组互斥，不能写进这里。 */
const PAIR_BIAS = {
  '餐饮': [
    ['午餐', '外卖'], ['午餐', '堂食'], ['晚餐', '外卖'], ['晚餐', '堂食'],
    ['早餐', '外卖'], ['早餐', '堂食'], ['晚餐', '自己做'], ['夜宵', '外卖'],
    ['奢侈一把', '堂食'],
  ],
  '日用': [['超市', '日用百货']],
  '学习': [['书籍', '课程']],
  '居住': [['房租', '水电']],
};

/**
 * 构造一笔账单的副 tag 列表：主细分 + 概率追加**不互斥**的搭子。
 * 副 tag 必须挂在本笔主 tag 下（S6-v3），且不能与已有细分同属一个互斥组
 * —— 所以一笔可以是「午餐 + 外卖」，绝不会是「早餐 + 午餐」。
 * @param {string} cat 主 tag 名
 * @param {string} mainSub 本笔的主要细分
 * @param {number} extraChance 追加搭子的概率
 */
function subTags(cat, mainSub, extraChance) {
  const all = (SUBTAGS[cat] || []).map(s => s[0]);
  const groups = EXCLUSIVE_GROUPS[cat] || [];
  const out = [mainSub];
  const blocked = new Set();
  /** 封锁该细分本身 + 它所在互斥组的其他成员
      （「本身」必须一起封：不属任何组的细分否则会在后续挑选里再被选中 → 同笔重复挂载） */
  const blockGroupOf = (name) => {
    blocked.add(name);
    for (const g of groups) if (g.includes(name)) for (const n of g) blocked.add(n);
  };
  blockGroupOf(mainSub);
  const pool = () => all.filter(n => !blocked.has(n));

  if (rand() >= extraChance || !pool().length) return out;

  // 优先取常见搭配里的另一个（跨组）
  const bias = (PAIR_BIAS[cat] || []).find(p => p.includes(mainSub));
  const partner = bias ? bias.find(n => n !== mainSub && !blocked.has(n)) : null;
  const second = (partner && pool().includes(partner) && rand() < 0.8) ? partner : pick(pool());
  out.push(second);
  blockGroupOf(second);            // 封掉第二个及其同组，第三个才不会撞组或重复

  const rest = pool();
  if (rest.length && rand() < 0.18) out.push(pick(rest));
  return out;
}

const today = new Date().toISOString().slice(0, 10);
const CTX_WORK = ['通勤', '独处', '加班'];
const CTX_WEEKEND = ['和朋友', '和对象', '独处', '旅行'];
const CTX_ANY = ['和朋友', '独处', '和对象', '加班', '出差', '旅行'];

/** 一笔：[date, amountCents, primary, subTagNames] */
function meals(iso) {
  const out = [];
  // [餐段, 金额下界, 上界, 追加「用餐方式」的概率] —— 餐段与方式可交叉，故概率给高
  const slot = [['早餐', 6, 15, 0.62], ['午餐', 12, 35, 0.72], ['晚餐', 15, 60, 0.75]];
  // 早/午/晚按概率出现（不是每天都三餐齐全，更像真实记账）
  for (const [name, lo, hi, extra] of slot) {
    if (rand() < 0.72) {
      const ctx = name === '早餐' ? pick(['独处', '通勤']) : pick(CTX_ANY);
      out.push([iso, yuan(lo, hi), { category: '餐饮', context: ctx }, subTags('餐饮', name, extra)]);
    }
  }
  // 夜宵：周末与加班后更常见
  if (rand() < 0.22) out.push([iso, yuan(20, 80), { category: '餐饮', context: pick(['和朋友', '加班', '独处']) }, subTags('餐饮', '夜宵', 0.7)]);
  // 奢侈一把：搭子优先取「堂食」（跨组，语义成立）
  if (rand() < 0.09) {
    out.push([iso, yuan(120, 420), { category: '餐饮', context: pick(['和朋友', '和对象']) }, subTags('餐饮', '奢侈一把', 0.6)]);
  }
  return out;
}
function transport(iso, weekend) {
  if (weekend) return [iso, yuan(20, 60), { category: '交通', context: pick(CTX_WEEKEND) }, subTags('交通', '打车', 0.30)];
  const r = rand();
  if (r < 0.55) return [iso, yuan(3, 10), { category: '交通', context: '通勤' }, subTags('交通', '地铁', 0.34)];
  if (r < 0.82) return [iso, yuan(2, 6), { category: '交通', context: '通勤' }, subTags('交通', '公交', 0.34)];
  if (r < 0.94) return [iso, yuan(20, 60), { category: '交通', context: pick(CTX_ANY) }, subTags('交通', '打车', 0.30)];
  return [iso, yuan(80, 420), { category: '交通', context: pick(['出差', '旅行']) }, subTags('交通', '高铁', 0.30)];
}
function fun(iso, weekend) {
  const r = rand();
  if (r < 0.5) return [iso, yuan(30, 80), { category: '娱乐', context: pick(CTX_WEEKEND) }, subTags('娱乐', '电影', 0.34)];
  if (r < 0.85) return [iso, yuan(30, 200), { category: '娱乐', context: pick(['独处', '和朋友']) }, subTags('娱乐', '游戏', 0.30)];
  return [iso, yuan(100, 420), { category: '娱乐', context: pick(['和朋友', '和对象', '旅行']) }, subTags('娱乐', '演出', 0.34)];
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
  if (rand() < 0.22) SEED.push([iso, yuan(20, 150), { category: '日用', context: pick(['独处', '和朋友']) }, subTags('日用', pick(['超市', '日用百货']), 0.40)]);
  if (rand() < 0.09) SEED.push([iso, yuan(20, 600), { category: '学习', context: '独处' }, subTags('学习', pick(['书籍', '课程']), 0.30)]);
  // 每月固定项
  if (day === 1) {
    SEED.push([iso, yuan(1200, 1800), { category: '居住' }, subTags('居住', '房租', 0.20)]);
    // 收入同样带细分（家用/零花）—— 与支出完全同构，只是星形不同
    SEED.push([iso, yuan(2500, 3500), { category: '收入·生活费' }, subTags('收入·生活费', '家用', 0.7)]);
  }
  if (day === 5) SEED.push([iso, yuan(60, 220), { category: '居住' }, subTags('居住', '水电', 0.20)]);
  if (day === 15 && rand() < 0.7) {
    const main = rand() < 0.72 ? '月薪' : (rand() < 0.6 ? '奖金' : '补贴');
    const lo = main === '月薪' ? 1200 : 200, hi = main === '月薪' ? 3200 : 900;
    SEED.push([iso, yuan(lo, hi), { category: '收入·工资' }, subTags('收入·工资', main, 0.35)]);
  }
  if (rand() < 0.05) SEED.push([iso, yuan(20, 800), { category: '收入·红包' }, subTags('收入·红包', pick(['节日', '亲友']), 0.3)]);
  if (rand() < 0.06) SEED.push([iso, yuan(50, 1500), { category: '收入·转账' }, subTags('收入·转账', pick(['收款', '还款']), 0.3)]);

  d = new Date(d.getTime() + 86400000);
}

// ---------- 3. 自检（生成阶段就把错误挡下来，别等灌进库才发现） ----------
{
  let bad = 0, dup = 0, sample = null;
  for (const [date, , , tags] of SEED) {
    // 同一笔内不得重复挂同一个细分（会被 links 的 UNIQUE(expense_id,tag_id,role) 拒绝）
    if (tags.length !== new Set(tags).size) { dup++; if (!sample) sample = `${date} 重复挂了 ${tags.join(' + ')}`; }
    for (const g of Object.values(EXCLUSIVE_GROUPS).flat()) {
      const hit = tags.filter(t => g.includes(t));
      if (hit.length > 1) { bad++; if (!sample) sample = `${date} 同时挂了 ${hit.join(' + ')}`; break; }
    }
  }
  if (dup || bad) {
    console.error(`❌ 自检失败：同笔重复 ${dup} 笔、同组互斥 ${bad} 笔（示例：${sample}）—— 演示数据不合格，不是业务错误`);
    process.exit(1);
  }
  console.log('自检通过：无同笔重复、无同组互斥细分（不会出现「早餐 + 午餐」这种一眼假的组合）');
}

// ---------- 4. 逐笔记账（走 REST，等价于人工录入，规则同源） ----------
let sent = 0, failed = 0;
for (const [date, amountCents, primary, tags] of SEED) {
  const type = String(primary.category || '').startsWith('收入') ? 'income' : 'expense';
  const r = await call('POST', '/ledgers/1/expenses', { type, amountCents, date, primary, tags });
  if (ok(r)) sent++;
  else {
    failed++;
    if (failed <= 5) console.log('WARN', date, JSON.stringify(primary), 'tags=' + JSON.stringify(tags), r.status, JSON.stringify(r.data));
  }
}

// ---------- 5. 摘要 ----------
const stats = await call('GET', '/ledgers/1/stats');
const totals = stats.data.totals || {};
const multi = SEED.filter(s => s[3] && s[3].length > 1).length;
console.log(`生成 ${SEED.length} 笔，成功 ${sent}，失败 ${failed}`);
console.log(`其中多副 tag 账单 ${multi} 笔（${Math.round(multi / SEED.length * 100)}%）—— 下钻图的共享线由这些产生`);
console.log(`累计支出 ¥${Math.round((totals.expense || 0) / 100).toLocaleString()}，收入 ¥${Math.round((totals.income || 0) / 100).toLocaleString()}`);
const monthly = (stats.data.monthly || []).filter(m => m.type === 'expense');
console.log(`覆盖 ${monthly.length} 个月：${monthly[0]?.month} ~ ${monthly[monthly.length - 1]?.month}`);
const top = (stats.data.byDimension.category || []).slice(0, 6);
for (const t of top) console.log(`  ${t.name}: ¥${Math.round(t.amount_cents / 100).toLocaleString()}`);
console.log('种子完成 ✅');
