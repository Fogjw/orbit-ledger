// Orbit MCP Server —— 暴露记账能力给 Agent（MCP 2026-07-28 协议，SDK v2 stateless）
// 对齐需求基线 §7 "MCP 接口范围（add_expense / create_tag / 查询）"：
// 复用 server/services 的同一批规则（事务/Σ 守恒/隔离），不绕开业务层。
// 接入形态：createMcpHandler(factory) → toNodeHandler 挂 Express POST /mcp（同进程同端口）。
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';

// 工具入参 schema（zod v4 = Standard Schema，SDK 自动转 JSON Schema 暴露给客户端）
const amount = (label) => z.number().int().positive().describe(`${label}（分）`);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const schemas = {
  createLedger: { name: z.string().min(1).describe('账本名') },
  listLedgers: {},
  listDimensions: { ledgerId: z.number().int().positive() },
  createTag: {
    ledgerId: z.number().int().positive(),
    dimensionKey: z.enum(['category', 'context', 'payment']),
    name: z.string().min(1),
    color: z.string().optional(),
  },
  addExpense: {
    ledgerId: z.number().int().positive(),
    type: z.enum(['expense', 'income']).optional().describe('缺省 expense'),
    amountCents: amount('金额'),
    date: dateStr,
    note: z.string().optional(),
    category: z.union([z.number().int(), z.string()]).optional().describe('品类主 tag（名称或 id；业务层校验必填，与 REST 同源）'),
    context: z.union([z.number().int(), z.string()]).optional().describe('情境主 tag（缺省未标注）'),
    payment: z.union([z.number().int(), z.string()]).optional().describe('支付方式主 tag（若已启用）'),
    tags: z.array(z.union([z.number().int(), z.string()])).optional().describe('副 tag 列表'),
  },
  getStats: {
    ledgerId: z.number().int().positive(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    type: z.enum(['expense', 'income']).optional(),
  },
  exportLedger: { ledgerId: z.number().int().positive() },
};

/** 工具执行错误 → MCP 内错误消息（保留 BizError 语义供客户端读取） */
function fail(err) {
  const code = err?.code ?? 'ERROR';
  const msg = err?.message ?? String(err);
  return { content: [{ type: 'text', text: `[${code}] ${msg}` }], isError: true };
}

/**
 * 构建 McpServer 工厂。factory 每次被调用返回同一注册好的实例（工具注册一次；
 * 服务无请求级状态，stateless HTTP per-request envelope 下复用安全）。
 * @param {{ledgers, tags, expenses, reports, exports}} svc 与 REST 相同的 services 注入
 */
export function createOrbitMcpServerFactory(svc) {
  let server = null;

  /** 懒构建并注册全部工具（首次调用时） */
  function build() {
    const s = new McpServer({ name: 'orbit-ledger', version: '1.0.0' });
    const $ = schemas;

    s.registerTool('create_ledger', { title: '建账本', description: '新建账本（自动初始化品类/情境维度与默认 tag 体系）', inputSchema: z.object($.createLedger) }, ({ name }) => {
      const l = svc.ledgers.create(name);
      return { content: [{ type: 'text', text: JSON.stringify({ id: l.id, name: l.name }) }] };
    });

    s.registerTool('list_ledgers', { title: '账本列表', description: '列出全部账本', inputSchema: z.object($.listLedgers) }, () => {
      const rows = svc.ledgers.list();
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    });

    s.registerTool('list_dimensions', { title: '维度视图', description: '账本的维度 + tag 树（录入下拉/查询可用取值）', inputSchema: z.object($.listDimensions) }, ({ ledgerId }) => {
      try {
        const dims = svc.tags.dimensions(ledgerId);
        return { content: [{ type: 'text', text: JSON.stringify(dims) }] };
      } catch (err) { return fail(err); }
    });

    s.registerTool('create_tag', { title: '建 tag', description: '维度内建 tag（名称唯一）', inputSchema: z.object($.createTag) }, ({ ledgerId, dimensionKey, name, color }) => {
      try {
        const t = svc.tags.create(ledgerId, { dimensionKey, name, color: color ?? null });
        return { content: [{ type: 'text', text: JSON.stringify(t) }] };
      } catch (err) { return fail(err); }
    });

    s.registerTool('add_expense', {
      title: '记一笔', description: '记录一笔支出/收入（走记账事务，Σ 守恒/品类必填/账本隔离同 REST）',
      inputSchema: z.object($.addExpense),
    }, ({ ledgerId, type, amountCents, date, note, category, context, payment, tags }) => {
      try {
        const primary = { category };
        if (context !== undefined) primary.context = context;
        if (payment !== undefined) primary.payment = payment;
        const e = svc.expenses.add({
          ledgerId, type, amountCents, date, note: note ?? null, primary, tags: tags ?? [],
        });
        return { content: [{ type: 'text', text: JSON.stringify(e) }] };
      } catch (err) { return fail(err); }
    });

    s.registerTool('get_stats', { title: '统计', description: '时间窗聚合（总额/分维/月度/每日）', inputSchema: z.object($.getStats) }, ({ ledgerId, from, to, type }) => {
      try {
        const view = svc.reports.windowView(ledgerId, { from, to, type });
        return { content: [{ type: 'text', text: JSON.stringify(view) }] };
      } catch (err) { return fail(err); }
    });

    s.registerTool('export_ledger', { title: '导出快照', description: '账本全量 JSON 快照（备份）', inputSchema: z.object($.exportLedger) }, ({ ledgerId }) => {
      const snap = svc.exports.ledgerSnapshot(ledgerId);
      if (!snap) return fail({ code: 'NOT_FOUND', message: `账本不存在: ${ledgerId}` });
      return { content: [{ type: 'text', text: JSON.stringify(snap) }] };
    });

    return s;
  }

  return () => {
    if (!server) server = build();
    return server;
  };
}
