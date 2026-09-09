// 路由：聚合统计（图谱/星轨数据源）—— 挂 /api/ledgers/:ledgerId，处理 /stats
import { Router } from 'express';
import { idOf, windowFrom } from '../validate.js';

export function statsRouter(svc) {
  const r = Router({ mergeParams: true });

  /** GET /api/ledgers/:ledgerId/stats?from&to&type */
  r.get('/stats', (req, res) => {
    const ledgerId = idOf(req.params.ledgerId);
    const win = windowFrom(req.query);
    res.json(svc.reports.windowView(ledgerId, win));
  });

  return r;
}
