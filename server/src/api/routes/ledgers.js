// 路由：账本 CRUD + 维度/tag 管理 + 导出
import { Router } from 'express';
import { idOf, requireStr, optStr, optInt } from '../validate.js';
import { BizError } from '../../services/ledgerService.js';

export function ledgersRouter(svc) {
  const r = Router();

  r.get('/', (req, res) => res.json(svc.ledgers.list()));

  r.post('/', (req, res) => {
    const name = requireStr(req.body ?? {}, 'name');
    res.status(201).json(svc.ledgers.create(name));
  });

  /**
   * POST /import —— 用备份快照回读为**新账本**（GET /:id/export 的对称面，D-13）
   * body = 快照本身（与导出的 JSON 同构）；校验失败 → 400 INVALID_BACKUP / BACKUP_INCOMPLETE。
   * 注意：路由须在 /:id 之前声明，否则 'import' 会被当成账本 id。
   */
  r.post('/import', (req, res) => {
    res.status(201).json(svc.imports.importSnapshot(req.body));
  });

  r.get('/:id', (req, res) => res.json(svc.ledgers.byId(idOf(req.params.id))));

  /** GET /:id/export —— 账本全量 JSON 快照（备份，D-13） */
  r.get('/:id/export', (req, res) => {
    const snapshot = svc.exports.ledgerSnapshot(idOf(req.params.id));
    if (!snapshot) throw new BizError('账本不存在', 'NOT_FOUND', 404);
    res.json(snapshot);
  });

  // 账本视图：维度 + tag 树（前端录入下拉/图谱数据源）
  r.get('/:id/dimensions', (req, res) => {
    const id = idOf(req.params.id);
    res.json({ ledger: svc.ledgers.byId(id), dimensions: svc.tags.dimensions(id) });
  });

  /** POST /:id/dimensions —— 启用扩展维度 {key, name?}（自动建「未标注」） */
  r.post('/:id/dimensions', (req, res) => {
    const ledgerId = idOf(req.params.id);
    const body = req.body ?? {};
    const key = requireStr(body, 'key');
    const name = optStr(body, 'name');
    const dim = svc.ledgers.enableDimension(ledgerId, key, name);
    res.status(201).json(dim);
  });

  r.patch('/:id', (req, res) => {
    const name = requireStr(req.body ?? {}, 'name');
    res.json(svc.ledgers.rename(idOf(req.params.id), name));
  });

  r.delete('/:id', (req, res) => {
    svc.ledgers.remove(idOf(req.params.id));
    res.status(204).end();
  });

  /**
   * PATCH /:id/dimensions/:key/tags/order —— 重排 tag 顺序（tags.position）
   * body { orderedIds: number[], parentTagId?: number }
   * 省略 parentTagId = 排该维主 tag；给定 = 排该主 tag 下的副 tag。
   * 整组全量重写：orderedIds 必须恰好覆盖该层级全部 tag。
   */
  r.patch('/:id/dimensions/:key/tags/order', (req, res) => {
    const ledgerId = idOf(req.params.id);
    const body = req.body ?? {};
    if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
      throw new BizError('缺少字段 orderedIds（须为非空数组）', 'MISSING_FIELD');
    }
    const orderedIds = body.orderedIds.map(Number);
    if (orderedIds.some(n => !Number.isInteger(n) || n <= 0)) {
      throw new BizError('orderedIds 须为正整数数组', 'INVALID_FIELD');
    }
    const parentTagId = optInt(body, 'parentTagId', { min: 1 }) ?? null;
    res.json(svc.tags.reorder(ledgerId, req.params.key, parentTagId, orderedIds));
  });

  // ---- tag 管理（建/改名改色/删） ----
  /** POST /:id/tags —— 建 tag；带 parentTagId 则在其下建副 tag（两级结构，S6-v3） */
  r.post('/:id/tags', (req, res) => {
    const ledgerId = idOf(req.params.id);
    const body = req.body ?? {};
    const dimensionKey = requireStr(body, 'dimensionKey');
    const name = requireStr(body, 'name');
    const color = optStr(body, 'color') ?? null;
    const parentTagId = optInt(body, 'parentTagId', { min: 1 }) ?? null;
    const tag = svc.tags.create(ledgerId, { dimensionKey, name, color, parentTagId });
    res.status(201).json(tag);
  });

  /** PATCH /:id/tags/:tagId —— 改名/改色（{name?, color?}；color: null 清除覆盖色） */
  r.patch('/:id/tags/:tagId', (req, res) => {
    const ledgerId = idOf(req.params.id);
    const tagId = idOf(req.params.tagId, 'tagId');
    const body = req.body ?? {};
    // 显式区分「未提供」(undefined) 与「清空」(null)：color 支持传 null
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name);
    if (body.color !== undefined) patch.color = body.color === null ? null : String(body.color);
    res.json(svc.tags.update(ledgerId, tagId, patch));
  });

  /** DELETE /:id/tags/:tagId —— 删除（「未标注」与被引用 tag 受保护） */
  r.delete('/:id/tags/:tagId', (req, res) => {
    const ledgerId = idOf(req.params.id);
    const tagId = idOf(req.params.tagId, 'tagId');
    svc.tags.remove(ledgerId, tagId);
    res.status(204).end();
  });

  return r;
}
