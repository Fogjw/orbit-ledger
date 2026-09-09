// 路由：账本 CRUD + 维度/tag 管理
import { Router } from 'express';
import { idOf, requireStr, optStr } from '../validate.js';

export function ledgersRouter(svc) {
  const r = Router();

  r.get('/', (req, res) => res.json(svc.ledgers.list()));

  r.post('/', (req, res) => {
    const name = requireStr(req.body ?? {}, 'name');
    res.status(201).json(svc.ledgers.create(name));
  });

  r.get('/:id', (req, res) => res.json(svc.ledgers.byId(idOf(req.params.id))));

  // 账本视图：维度 + tag 树（前端录入下拉/图谱数据源）
  r.get('/:id/dimensions', (req, res) => {
    const id = idOf(req.params.id);
    res.json({ ledger: svc.ledgers.byId(id), dimensions: svc.tags.dimensions(id) });
  });

  r.patch('/:id', (req, res) => {
    const name = requireStr(req.body ?? {}, 'name');
    res.json(svc.ledgers.rename(idOf(req.params.id), name));
  });

  r.delete('/:id', (req, res) => {
    svc.ledgers.remove(idOf(req.params.id));
    res.status(204).end();
  });

  // ---- tag 管理（建/改名改色/删） ----
  r.post('/:id/tags', (req, res) => {
    const ledgerId = idOf(req.params.id);
    const body = req.body ?? {};
    const dimensionKey = requireStr(body, 'dimensionKey');
    const name = requireStr(body, 'name');
    const color = optStr(body, 'color') ?? null;
    const tag = svc.tags.create(ledgerId, { dimensionKey, name, color });
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
