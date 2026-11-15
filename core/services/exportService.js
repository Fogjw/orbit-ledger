// 导出业务服务（D-13）：账本全量 JSON 快照（备份，供未来 import 回读）
// 结构：{ format:'orbit-ledger-backup', version:2, exportedAt, ledger, dimensions, tags, expenses, expense_tag_links, plans, expense_plan_links }
// v2 新增计划两表；v1 备份仍可导入（见 importService）。
// 行保留原始主键/外键（扁平），未来 import 可逐表回插重建
import { createExportRepo } from '../repos/exportRepo.js';

const BACKUP_FORMAT = 'orbit-ledger-backup';
const BACKUP_VERSION = 2;

export function createExportService(db) {
  const exportRepo = createExportRepo(db);

  return {
    /**
     * 账本全量快照（含壳字段）。账本不存在 → null（路由映射 404）。
     * @param {number} ledgerId
     */
    ledgerSnapshot(ledgerId) {
      const data = exportRepo.snapshot(ledgerId);
      if (!data) return null;
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        ...data,
      };
    },
  };
}
