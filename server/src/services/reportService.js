// 报表业务服务：装配图谱/星轨视图所需数据
import { createStatsRepo } from '../repos/statsRepo.js';
import { createTagRepo } from '../repos/tagRepo.js';

export function createReportService(db) {
  const stats = createStatsRepo(db);
  const tags = createTagRepo(db);

  return {
    /**
     * 时间窗聚合视图（L1/L2 数据源）：
     * { totals: {expense, income}, series: {byDimension: {category: [...], context: [...]}}, monthly, daily }
     * byDimension 键 = 账本真实维度（遍历 dimensions 表，未来扩展维度自动入列，无需改码）。
     * @param {number} ledgerId
     * @param {{from?: string, to?: string, type?: 'expense'|'income'|null}} win
     */
    windowView(ledgerId, win = {}) {
      const byDimension = {};
      for (const dim of tags.dimensions(ledgerId)) {
        const rows = stats.tagSums(ledgerId, dim.key, win);
        if (rows.length) byDimension[dim.key] = rows;
      }
      return {
        totals: stats.totals(ledgerId, win),
        byDimension,
        monthly: stats.monthlySeries(ledgerId, win),
        daily: stats.dailySeries(ledgerId, win),
      };
    },

    /** 星轨月度序列（日/月/年粒度的数据基础；月总额 = 该月 expense+income？星轨语义=花销总量） */
    monthlySeries(ledgerId, win = {}) {
      return stats.monthlySeries(ledgerId, win);
    },

    dailySeries(ledgerId, win = {}) {
      return stats.dailySeries(ledgerId, win);
    },
  };
}
