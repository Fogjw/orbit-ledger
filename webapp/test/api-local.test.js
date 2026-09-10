// 本地版 OrbitAPI（浏览器直连 core）与 REST 版（HTTP）的一致性。
// 两边跑同一串操作，断言返回的形状与数据相同 —— web/ 的 UI 同时吃这两种实现，
// 一旦分叉，桌面端与纯前端版就会出现「同一个界面、两种行为」这种最难查的问题。
// 这个测试在 Node 里就能跑（sql.js 在 Node 下同样工作），所以它能进 CI；
// 浏览器里真正需要人眼确认的只剩 UI 与文件存储两条路径。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../server/src/db/database.js';
import { migrate } from '../../core/schema.js';
import { createLocalApi } from '../api-local.js';
import { createApp } from '../../server/src/api/app.js';
import { createLedgerService } from '../../core/services/ledgerService.js';
import { createTagService } from '../../core/services/tagService.js';
import { createExpenseService } from '../../core/services/expenseService.js';
import { createReportService } from '../../core/services/reportService.js';
import { createExportService } from '../../core/services/exportService.js';
import { createImportService } from '../../core/services/importService.js';

let base = '';
let server;

before(async () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    reports: createReportService(db),
    exports: createExportService(db),
    imports: createImportService(db),
  };
  server = createApp(svc).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((r) => server.close(r)));

const qs = (w) => {
  const p = new URLSearchParams();
  if (w.from) p.set('from', w.from);
  if (w.to) p.set('to', w.to);
  if (w.type) p.set('type', w.type);
  const s = p.toString();
  return s ? `?${s}` : '';
};
async function req(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const e = new Error(data?.message || `HTTP ${res.status}`);
    e.code = data?.error;
    throw e;
  }
  return data;
}
/** REST 客户端（与 web/api.js 同形的最小版） */
const rest = {
  createLedger: (name) => req('POST', '/ledgers', { name }),
  getLedgerDims: (id) => req('GET', `/ledgers/${id}/dimensions`),
  createTag: (id, data) => req('POST', `/ledgers/${id}/tags`, data),
  addExpense: (id, data) => req('POST', `/ledgers/${id}/expenses`, data),
  listExpenses: (id, w = {}) => req('GET', `/ledgers/${id}/expenses${qs(w)}`),
  getStats: (id, w = {}) => req('GET', `/ledgers/${id}/stats${qs(w)}`),
  exportLedger: (id) => req('GET', `/ledgers/${id}/export`),
};

/** 同一串操作，分别喂给两种实现 */
async function scenario(api) {
  const l = await api.createLedger('生活费');
  const dims = await api.getLedgerDims(l.id);
  const food = dims.dimensions.find((d) => d.key === 'category').tags.find((t) => t.name === '餐饮');
  await api.createTag(l.id, { dimensionKey: 'category', name: '夜宵', parentTagId: food.id });
  await api.addExpense(l.id, {
    amountCents: 4560, date: '2026-06-07', note: '撸串',
    primary: { category: '餐饮', context: '和朋友' }, tags: ['夜宵'],
  });
  await api.addExpense(l.id, { amountCents: 1200, date: '2026-06-06', primary: { category: '交通', context: '通勤' } });
  return {
    l,
    list: await api.listExpenses(l.id, { from: '2026-06-01', to: '2026-06-30' }),
    stats: await api.getStats(l.id, { from: '2026-06-01', to: '2026-06-30' }),
    snap: await api.exportLedger(l.id),
  };
}

const shapeOf = (e) => Object.keys(e).sort();
const keyOf = (e) => [e.type, e.amount_cents, e.date, e.note].join('|');

describe('本地版 API 与 REST 版一致性', () => {
  test('同一串操作，两种实现返回相同的形状与数据', async () => {
    const local = await createLocalApi();
    const a = await scenario(rest);
    const b = await scenario(local);

    assert.equal(b.l.id, a.l.id, '主键应一致（同样的插入顺序）');
    assert.equal(b.list.count, a.list.count);
    assert.equal(b.list.count, 2);
    assert.deepEqual(shapeOf(b.list.items[0]), shapeOf(a.list.items[0]), '花销对象的字段集合应一致');
    assert.deepEqual(b.stats.totals, a.stats.totals);
    assert.deepEqual(b.stats.byDimension, a.stats.byDimension, '各维聚合应一致');
    assert.deepEqual(b.stats.monthly, a.stats.monthly, '月度序列应一致');
    assert.equal(b.snap.expenses.length, a.snap.expenses.length);
    assert.equal(b.snap.expense_tag_links.length, a.snap.expense_tag_links.length, '关联行数应一致');
    assert.deepEqual(b.snap.expenses.map(keyOf).sort(), a.snap.expenses.map(keyOf).sort());
    local.close();
  });

  test('业务错误也同形：两边都抛带 code 的 Error', async () => {
    const local = await createLocalApi();
    const ledL = await local.createLedger('本地');
    const ledR = await rest.createLedger('远端');
    const badAdd = { amountCents: 100, date: '2026-06-01', primary: { category: '餐饮' }, tags: ['根本不存在的副标签'] };

    const errL = await local.addExpense(ledL.id, badAdd).then(() => null, (e) => e);
    const errR = await rest.addExpense(ledR.id, badAdd).then(() => null, (e) => e);

    assert.ok(errL && errR, '两边都应当抛错');
    assert.equal(errL.code, errR.code, '错误码应当一致');
    local.close();
  });
});
