// tag 业务服务：维度内建 tag / 维度视图
import { createTagRepo } from '../repos/tagRepo.js';
import { BizError } from './ledgerService.js';

export function createTagService(db) {
  const tags = createTagRepo(db);

  return {
    /** 账本维度视图（含 tags 树） */
    dimensions(ledgerId) {
      return tags.dimensions(ledgerId);
    },

    /**
     * 维度内建 tag（同一维度名称唯一）。
     * 维度需已存在（dimensionKey ∈ category/context/…；由账本初始化或扩展 API 创建）
     */
    create(ledgerId, { dimensionKey, name, color = null }) {
      const dim = tags.dimensionByKey(ledgerId, dimensionKey);
      if (!dim) throw new BizError(`账本无维度「${dimensionKey}」`, 'DIMENSION_NOT_FOUND', 404);
      const existing = tags.tagByName(ledgerId, dimensionKey, name);
      if (existing) throw new BizError(`维度「${dimensionKey}」下 tag 已存在: ${name}`, 'TAG_EXISTS', 409);
      const id = tags.createTag(ledgerId, dim.id, name, { color });
      return tags.tagById(ledgerId, id);
    },
  };
}
