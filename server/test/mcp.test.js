// MCP 集成测试（S4）：官方 client v2 走真实协议连 Express /mcp，
// 验证工具注册/调用与业务规则（Σ 守恒/隔离/事务）在 MCP 链路上同样生效
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { createLedgerService } from '../src/services/ledgerService.js';
import { createTagService } from '../src/services/tagService.js';
import { createExpenseService } from '../src/services/expenseService.js';
import { createReportService } from '../src/services/reportService.js';
import { createExportService } from '../src/services/exportService.js';
import { createApp } from '../src/api/app.js';

const db = openDatabase(':memory:');
migrate(db);
const svc = {
  ledgers: createLedgerService(db),
  tags: createTagService(db),
  expenses: createExpenseService(db),
  reports: createReportService(db),
  exports: createExportService(db),
};
const app = createApp(svc);

let server;
let url;
before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});
after(() => new Promise(res => server.close(res)));

/** 连一个 client（每用例独立连接，stateless 下无共享会话） */
async function connectClient() {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: 'orbit-test', version: '1.0.0' }, {});
  await client.connect(transport);
  return { client, transport };
}

describe('MCP 服务（2026-07-28 stateless over HTTP）', () => {
  test('listTools 暴露 7 个记账工具', async () => {
    const { client, transport } = await connectClient();
    try {
      const res = await client.listTools();
      const names = res.tools.map(t => t.name).sort();
      assert.deepEqual(names, [
        'add_expense', 'create_ledger', 'create_tag', 'export_ledger',
        'get_stats', 'list_dimensions', 'list_ledgers',
      ]);
      // 工具含 JSON schema 描述（SDK 自动由 zod 转换）
      const add = res.tools.find(t => t.name === 'add_expense');
      assert.equal(add.inputSchema.type, 'object');
      assert.ok(add.inputSchema.properties.amountCents, 'amountCents 在 schema 中');
    } finally {
      await client.close();
      transport.close();
    }
  });

  test('create_ledger + add_expense + get_stats：记一笔后 Σ 守恒经 MCP 成立', async () => {
    const { client, transport } = await connectClient();
    try {
      // 建账本
      const l = await client.callTool({ name: 'create_ledger', arguments: { name: 'MCP 账本' } });
      const ledger = JSON.parse(l.content[0].text);
      assert.ok(ledger.id > 0);

      // 记两笔支出（一笔带情境）
      const a1 = await client.callTool({ name: 'add_expense', arguments: { ledgerId: ledger.id, amountCents: 3500, date: '2026-06-05', category: '餐饮' } });
      assert.notEqual(a1.isError, true, '成功不应标记 isError');
      const a2 = await client.callTool({ name: 'add_expense', arguments: { ledgerId: ledger.id, amountCents: 1200, date: '2026-06-06', category: '交通', context: '通勤' } });
      assert.notEqual(a2.isError, true);

      // 统计：品类 Σ=情境 Σ=总额
      const s = await client.callTool({ name: 'get_stats', arguments: { ledgerId: ledger.id } });
      const view = JSON.parse(s.content[0].text);
      assert.equal(view.totals.expense, 4700);
      const sumBy = (rows) => rows.reduce((x, r) => x + r.amount_cents, 0);
      assert.equal(sumBy(view.byDimension.category), 4700);
      assert.equal(sumBy(view.byDimension.context), 4700, '情境 Σ=总额（未标注参与）');
    } finally {
      await client.close();
      transport.close();
    }
  });

  test('add_expense 经 MCP 生效：什么 tag 都不选也能记账（自动落「未分类」）', async () => {
    const { client, transport } = await connectClient();
    try {
      const l = await client.callTool({ name: 'create_ledger', arguments: { name: '缺省账本' } });
      const ledger = JSON.parse(l.content[0].text);
      const r = await client.callTool({ name: 'add_expense', arguments: { ledgerId: ledger.id, amountCents: 100, date: '2026-06-01' } });
      assert.notEqual(r.isError, true, '缺 tag 不再报错（改为兜底占位）');
      const expense = JSON.parse(r.content[0].text);
      const primaries = expense.tags.filter(t => t.role === 'primary');
      assert.equal(primaries.length, 2, '两维各一个 primary');
      assert.ok(primaries.every(t => t.name === '未分类'), '缺省落到「未分类」占位主 tag');
    } finally {
      await client.close();
      transport.close();
    }
  });

  test('跨账本隔离经 MCP 生效：B 账本用 A 的 tag id → isError TAG_NOT_FOUND', async () => {
    const { client, transport } = await connectClient();
    try {
      const la = await client.callTool({ name: 'create_ledger', arguments: { name: '隔离A' } });
      const lb = await client.callTool({ name: 'create_ledger', arguments: { name: '隔离B' } });
      const A = JSON.parse(la.content[0].text);
      const B = JSON.parse(lb.content[0].text);
      // A 账本取「餐饮」tag id
      const dimsA = await client.callTool({ name: 'list_dimensions', arguments: { ledgerId: A.id } });
      const dimTreeA = JSON.parse(dimsA.content[0].text);
      const food = dimTreeA.find(d => d.key === 'category').tags.find(t => t.name === '餐饮');
      // B 记账引用 A 的 tag id → 拒
      const r = await client.callTool({ name: 'add_expense', arguments: { ledgerId: B.id, amountCents: 100, date: '2026-06-01', category: food.id } });
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, /TAG_NOT_FOUND/);
    } finally {
      await client.close();
      transport.close();
    }
  });

  test('list_dimensions / create_tag / export_ledger 走同一 services', async () => {
    const { client, transport } = await connectClient();
    try {
      const l = await client.callTool({ name: 'create_ledger', arguments: { name: '全功能账本' } });
      const ledger = JSON.parse(l.content[0].text);

      // 维度树
      const d = await client.callTool({ name: 'list_dimensions', arguments: { ledgerId: ledger.id } });
      const dims = JSON.parse(d.content[0].text);
      assert.equal(dims.length, 2);
      assert.equal(
        dims.find(x => x.key === 'context').tags.some(t => t.is_unnamed === 1), false,
        '不预设占位 tag（记账缺省时按需创建）'
      );

      // 建副 tag（须挂在主 tag 下，v3）+ 用其记账
      const food = dims.find(x => x.key === 'category').tags.find(t => t.name === '餐饮');
      assert.ok(food, '品类维含「餐饮」主 tag');
      const ct = await client.callTool({ name: 'create_tag', arguments: { ledgerId: ledger.id, dimensionKey: 'category', name: '夜宵', parentTagId: food.id } });
      const tag = JSON.parse(ct.content[0].text);
      assert.ok(tag.id > 0);
      assert.equal(tag.parent_tag_id, food.id, 'MCP 建副 tag 记录父引用');
      await client.callTool({ name: 'add_expense', arguments: { ledgerId: ledger.id, amountCents: 500, date: '2026-06-01', category: '餐饮', tags: ['夜宵'] } });

      // 导出快照含该笔
      const ex = await client.callTool({ name: 'export_ledger', arguments: { ledgerId: ledger.id } });
      const snap = JSON.parse(ex.content[0].text);
      assert.equal(snap.format, 'orbit-ledger-backup');
      assert.equal(snap.expenses.length, 1);
      assert.ok(snap.tags.some(t => t.name === '夜宵'));
    } finally {
      await client.close();
      transport.close();
    }
  });
});
