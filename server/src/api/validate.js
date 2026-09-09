// 入参校验辅助：id / 时间窗 / 请求体字段
import { BizError } from '../services/ledgerService.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 路径参数 → 正整数 id，否则 400 */
export function idOf(raw, name = 'id') {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new BizError(`参数 ${name} 须为正整数`, 'INVALID_ID');
  return n;
}

/** query → 时间窗 { from?, to?, type? }（from<=to 校验） */
export function windowFrom(query = {}) {
  const win = {};
  for (const k of ['from', 'to']) {
    if (query[k] !== undefined) {
      if (!DATE_RE.test(query[k])) throw new BizError(`日期 ${k} 须为 YYYY-MM-DD`, 'INVALID_DATE');
      win[k] = query[k];
    }
  }
  if (query.type) {
    if (query.type !== 'expense' && query.type !== 'income') {
      throw new BizError('type 须为 expense 或 income', 'INVALID_TYPE');
    }
    win.type = query.type;
  }
  if (win.from && win.to && win.from > win.to) throw new BizError('from 不能晚于 to', 'INVALID_RANGE');
  return win;
}

/** 必填数字字段 */
export function requireInt(body, name, { min = null } = {}) {
  const v = body[name];
  if (v === undefined || v === null) throw new BizError(`缺少字段 ${name}`, 'MISSING_FIELD');
  const n = Number(v);
  if (!Number.isInteger(n) || (min !== null && n < min)) {
    throw new BizError(`字段 ${name} 须为整数${min !== null ? `（≥${min}）` : ''}`, 'INVALID_FIELD');
  }
  return n;
}

/** 必填字符串字段 */
export function requireStr(body, name, { trim = true } = {}) {
  const v = body[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new BizError(`缺少字段 ${name}`, 'MISSING_FIELD');
  }
  return trim ? String(v).trim() : String(v);
}

/** 可选字符串 */
export function optStr(body, name) {
  const v = body[name];
  if (v === undefined || v === null) return undefined;
  return String(v).trim() === '' ? undefined : String(v).trim();
}
