// tag 业务服务：维度内建 tag / 改名改色 / 删除保护 / 维度视图
import { createTagRepo } from '../repos/tagRepo.js';
import { BizError } from './ledgerService.js';

export function createTagService(db) {
  const tags = createTagRepo(db);

  /** 取账本内 tag（不存在/跨账本 → 抛 404） */
  function requireTag(ledgerId, tagId) {
    const tag = tags.tagById(ledgerId, tagId);
    if (!tag) throw new BizError(`tag 不存在或不属于该账本: ${tagId}`, 'NOT_FOUND', 404);
    return tag;
  }

  /** 「未标注」是系统占位 tag：锁定编辑/删除（产品弱化节点，见需求基线 5.3） */
  function assertEditable(tag) {
    if (tag.is_unnamed === 1) {
      throw new BizError('「未标注」tag 锁定，不可改名/改色/删除', 'UNNAMED_TAG_LOCKED', 409);
    }
  }

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

    /**
     * 改 tag 名/色（部分更新：只更给定字段；color: null 清除覆盖色）。
     * 校验：同维重名（排除自身）→ TAG_EXISTS；「未标注」锁定。
     */
    update(ledgerId, tagId, { name, color } = {}) {
      const tag = requireTag(ledgerId, tagId);
      assertEditable(tag);
      if (name !== undefined) {
        if (!name || !String(name).trim()) throw new BizError('tag 名不能为空', 'MISSING_FIELD');
        const clean = String(name).trim();
        if (tags.nameExistsInDimension(tag.dimension_id, clean, tagId)) {
          throw new BizError(`维度内已存在同名 tag: ${clean}`, 'TAG_EXISTS', 409);
        }
        name = clean;
      }
      tags.updateTag(tagId, { name, color });
      return tags.tagById(ledgerId, tagId);
    },

    /**
     * 删 tag。删除保护（D-11）：
     * 「未标注」锁定；被任一花销引用（primary/secondary）→ TAG_IN_USE（防级联删 links 破坏 Σ）。
     */
    remove(ledgerId, tagId) {
      const tag = requireTag(ledgerId, tagId);
      assertEditable(tag);
      if (tags.referenceCount(tagId) > 0) {
        throw new BizError(`tag 正被花销引用，无法删除: ${tag.name}`, 'TAG_IN_USE', 409);
      }
      tags.removeTag(tagId);
    },
  };
}
