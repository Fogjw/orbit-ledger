// 本地版 OrbitAPI：接口与 web/api.js 的 REST 客户端**完全同形**，但内部直接调用共享 core 的
// services —— 浏览器里既没有 HTTP 也没有服务端，业务规则原样复用。
//
// 于是 web/ 那套星图 UI **一行都不用改**：它只认 window.OrbitAPI，
// 换掉实现就等于换掉了整个数据来源（REST → 本地 SQLite）。
//
// 两处必须与 REST 版逐一对齐（否则 UI 会察觉）：
//  - 响应形状：例如 listExpenses 要包成 {items, count}，getLedgerDims 要包成 {ledger, dimensions}
//  - 错误形状：api.js 抛出的是带 code 的 Error，这里把 BizError 转成同样的东西
import { migrate } from '../core/schema.js';
import { createLedgerService, BizError } from '../core/services/ledgerService.js';
import { createTagService } from '../core/services/tagService.js';
import { createExpenseService } from '../core/services/expenseService.js';
import { createReportService } from '../core/services/reportService.js';
import { createExportService } from '../core/services/exportService.js';
import { createImportService } from '../core/services/importService.js';
import { openBrowserDatabase } from './sqlite-browser.js';

/** 记账请求体归一化（对齐 REST 层 expenseBody 的默认值与形状） */
function normalizeExpense(data = {}) {
  return {
    type: data.type === 'income' ? 'income' : 'expense',
    amountCents: data.amountCents,
    date: data.date,
    note: data.note,
    primary: data.primary ?? {},
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

/** 时间窗参数（REST 版从 query 取，这里直接透传 UI 给的对象） */
function normalizeWindow(win = {}) {
  const out = {};
  if (win.from) out.from = win.from;
  if (win.to) out.to = win.to;
  if (win.type) out.type = win.type;
  return out;
}

/**
 * 建一个跑在浏览器里的 OrbitAPI。
 * @param {{ bytes?: Uint8Array|null, locateFile?: Function, persist?: (bytes: Uint8Array) => void }} opts
 *   bytes   已有的数据库字节（来自上次持久化），不传则新建空库
 *   persist 落盘回调：每次写操作之后收到整库字节（由 storage.js 提供）
 * @returns {Promise<object>} 与 web/api.js 同形的 API 对象
 */
export async function createLocalApi(opts = {}) {
  const { bytes = null, locateFile, wasmBinary, persist } = opts;
  const db = await openBrowserDatabase(bytes, { locateFile, wasmBinary });
  migrate(db);

  const svc = {
    ledgers: createLedgerService(db),
    tags: createTagService(db),
    expenses: createExpenseService(db),
    reports: createReportService(db),
    exports: createExportService(db),
    imports: createImportService(db),
  };

  /** 写操作后把整库导出交给 persist（落盘交给上层决定：文件或 IndexedDB） */
  const flush = () => {
    if (!persist) return;
    try { persist(db.export()); } catch (err) { console.error('[local-api] 落盘失败', err); }
  };

  /**
   * 统一出口：错误转成 UI 认识的形状；写操作顺带落盘。
   * 必须是 async —— REST 版的方法全部返回 Promise，如果这里同步返回，两边就会分叉成
   * 「同步抛出 vs 异步拒绝」：实测同步抛出的错误不会被 `.then` 的失败回调接住，
   * 于是同一个界面在两种数据源下表现不同。接口语义一致比省一个 Promise 重要得多。
   */
  async function call(fn, write = false) {
    try {
      const out = fn();
      if (write) flush();
      return out;
    } catch (err) {
      if (err instanceof BizError) {
        const e = new Error(err.message);
        e.code = err.code;
        throw e;
      }
      throw err;
    }
  }

  return {
    // ---- 账本 ----
    listLedgers: () => call(() => svc.ledgers.list()),
    createLedger: (name) => call(() => svc.ledgers.create(name), true),
    deleteLedger: (id) => call(() => svc.ledgers.remove(Number(id)), true),
    renameLedger: (id, name) => call(() => svc.ledgers.rename(Number(id), name), true),
    getLedger: (id) => call(() => svc.ledgers.byId(Number(id))),
    getLedgerDims: (id) => call(() => ({ ledger: svc.ledgers.byId(Number(id)), dimensions: svc.tags.dimensions(Number(id)) })),
    enableDimension: (id, key, name) => call(() => svc.ledgers.enableDimension(Number(id), key, name), true),

    // ---- tag ----
    createTag: (ledgerId, { dimensionKey, name, color, parentTagId } = {}) =>
      call(() => svc.tags.create(Number(ledgerId), { dimensionKey, name, color, parentTagId: parentTagId ?? null }), true),
    updateTag: (ledgerId, tagId, patch = {}) => {
      // 与 REST 的 PATCH 一致：显式区分「未提供」与「清空」（color 支持传 null）
      const p = {};
      if (patch.name !== undefined) p.name = String(patch.name);
      if (patch.color !== undefined) p.color = patch.color === null ? null : String(patch.color);
      return call(() => svc.tags.update(Number(ledgerId), Number(tagId), p), true);
    },
    deleteTag: (ledgerId, tagId) => call(() => svc.tags.remove(Number(ledgerId), Number(tagId)), true),
    reorderTags: (ledgerId, dimensionKey, orderedIds, parentTagId) =>
      call(() => svc.tags.reorder(Number(ledgerId), dimensionKey, parentTagId ?? null, orderedIds), true),

    // ---- 花销 ----
    addExpense: (ledgerId, data) => call(() => svc.expenses.add({ ledgerId: Number(ledgerId), ...normalizeExpense(data) }), true),
    updateExpense: (ledgerId, expenseId, data) =>
      call(() => svc.expenses.update(Number(ledgerId), Number(expenseId), normalizeExpense(data)), true),
    deleteExpense: (ledgerId, expenseId) => call(() => {
      const ok = svc.expenses.removeInLedger(Number(ledgerId), Number(expenseId));
      if (!ok) {
        const e = new Error('花销不存在');
        e.code = 'NOT_FOUND';
        throw e;
      }
      return null;
    }, true),
    listExpenses: async (ledgerId, win = {}) => {
      const list = await call(() => svc.expenses.listByWindow(Number(ledgerId), normalizeWindow(win)));
      return { items: list, count: list.length };   // 与 REST 的响应形状一致
    },

    // ---- 统计 / 备份 ----
    getStats: (ledgerId, win = {}) => call(() => svc.reports.windowView(Number(ledgerId), normalizeWindow(win))),
    exportLedger: (ledgerId) => call(() => {
      const snap = svc.exports.ledgerSnapshot(Number(ledgerId));
      if (!snap) {
        const e = new Error('账本不存在');
        e.code = 'NOT_FOUND';
        throw e;
      }
      return snap;
    }),
    importLedger: (snapshot) => call(() => svc.imports.importSnapshot(snapshot), true),

    // ---- 非 UI 接口：给存储层与调试用 ----
    flush,
    exportBytes: () => db.export(),
    close: () => db.close(),
  };
}
