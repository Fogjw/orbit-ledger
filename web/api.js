/**
 * Orbit 星账 · web/ REST 客户端
 * 零依赖、普通 <script> 可用的全局对象 window.OrbitAPI
 * 作用域隔离：包在 IIFE 内（顶层 const 与其它 script 共享全局词法环境，
 * 撞名即 SyntaxError 中断整页），仅暴露 window.OrbitAPI。
 */
(function () {

const BASE = ((typeof window !== 'undefined' ? window : globalThis).ORBIT_API_BASE) || 'http://localhost:5310/api';

// 统一请求函数
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const e = new Error(data.message || ('HTTP ' + res.status));
    e.code = data.error || ('HTTP_' + res.status);
    throw e;
  }

  if (res.status === 204) return null;
  return res.json();
}

const API = {
  // 账本相关

  // 列出所有账本
  listLedgers: () => request('/ledgers'),

  // 创建账本
  createLedger: (name) => request('/ledgers', { method: 'POST', body: { name } }),

  // 删除账本（连带该账本全部花销/维度/tag）
  deleteLedger: (id) => request(`/ledgers/${id}`, { method: 'DELETE' }),

  // 重命名账本
  renameLedger: (id, name) => request(`/ledgers/${id}`, { method: 'PATCH', body: { name } }),

  // 获取单个账本
  getLedger: (id) => request(`/ledgers/${id}`),

  // 获取账本维度
  getLedgerDims: (id) => request(`/ledgers/${id}/dimensions`),

  // 启用扩展维度
  enableDimension: (id, key, name) => request(`/ledgers/${id}/dimensions`, {
    method: 'POST',
    body: { key, ...(name ? { name } : {}) },
  }),

  // Tag 相关

  // 创建 tag
  createTag: (ledgerId, { dimensionKey, name, color }) =>
    request(`/ledgers/${ledgerId}/tags`, {
      method: 'POST',
      body: { dimensionKey, name, color },
    }),

  // 更新 tag（部分更新）
  updateTag: (ledgerId, tagId, { name, color } = {}) => {
    const body = {};
    if (name !== undefined) body.name = name;
    if (color !== undefined) body.color = color;   // null 也原样传（=清除）
    return request(`/ledgers/${ledgerId}/tags/${tagId}`, { method: 'PATCH', body });
  },

  // 删除 tag
  deleteTag: (ledgerId, tagId) =>
    request(`/ledgers/${ledgerId}/tags/${tagId}`, { method: 'DELETE' }),

  // 花销相关

  // 记一笔
  addExpense: (ledgerId, { type, amountCents, date, note, primary, tags }) =>
    request(`/ledgers/${ledgerId}/expenses`, {
      method: 'POST',
      body: { type, amountCents, date, note, primary, tags },
    }),

  // 更新花销（全量替换）
  updateExpense: (ledgerId, expenseId, data) =>
    request(`/ledgers/${ledgerId}/expenses/${expenseId}`, {
      method: 'PUT',
      body: data,
    }),

  // 删除花销
  deleteExpense: (ledgerId, expenseId) =>
    request(`/ledgers/${ledgerId}/expenses/${expenseId}`, { method: 'DELETE' }),

  // 列出花销（支持时间窗和类型过滤）
  listExpenses: (ledgerId, { from, to, type } = {}) => {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (type) params.append('type', type);
    const query = params.toString();
    return request(`/ledgers/${ledgerId}/expenses${query ? '?' + query : ''}`);
  },

  // 获取统计数据
  getStats: (ledgerId, { from, to, type } = {}) => {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (type) params.append('type', type);
    const query = params.toString();
    return request(`/ledgers/${ledgerId}/stats${query ? '?' + query : ''}`);
  },

  // 导出账本（备份快照）
  exportLedger: (ledgerId) => request(`/ledgers/${ledgerId}/export`),
};

// 挂载到全局对象（兼容浏览器和 Node.js）
(typeof window !== 'undefined' ? window : globalThis).OrbitAPI = API;

})();