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
     * 建 tag。不传 parentTagId → 建主 tag（维度取值）；传 → 在该主 tag 下建副 tag（两级结构）。
     * 名称唯一的作用域是「同维度 + 同父」：主 tag 之间唯一，副 tag 在同父下唯一
     * （不同主 tag 下允许同名，如 餐饮→其他 与 交通通勤→其他）。
     */
    create(ledgerId, { dimensionKey, name, color = null, parentTagId = null }) {
      const dim = tags.dimensionByKey(ledgerId, dimensionKey);
      if (!dim) throw new BizError(`账本无维度「${dimensionKey}」`, 'DIMENSION_NOT_FOUND', 404);

      let parentId = null;
      if (parentTagId !== null && parentTagId !== undefined) {
        const parent = tags.tagById(ledgerId, parentTagId);
        if (!parent) throw new BizError(`父 tag 不存在或不属于该账本: ${parentTagId}`, 'NOT_FOUND', 404);
        if (parent.dimension_id !== dim.id) {
          throw new BizError(`父 tag「${parent.name}」不属于维度「${dimensionKey}」`, 'PARENT_DIMENSION_MISMATCH', 400);
        }
        if (parent.parent_tag_id !== null && parent.parent_tag_id !== undefined) {
          throw new BizError('副 tag 之下不能再建下级（只支持「主 tag → 副 tag」两级）', 'SUBTAG_DEPTH_EXCEEDED', 400);
        }
        if (parent.is_unnamed === 1) {
          throw new BizError('「未标注」下不能建副 tag', 'UNNAMED_TAG_LOCKED', 409);
        }
        parentId = parent.id;
      }

      const existing = tags.nameExistsUnder(dim.id, parentId, name);
      if (existing) {
        throw new BizError(
          parentId === null ? `维度「${dimensionKey}」下主 tag 已存在: ${name}` : `该主 tag 下副 tag 已存在: ${name}`,
          'TAG_EXISTS',
          409
        );
      }
      const id = tags.createTag(ledgerId, dim.id, name, { color, parentTagId: parentId });
      return tags.tagById(ledgerId, id);
    },

    /**
     * 改 tag 名/色（部分更新：只更给定字段；color: null 清除覆盖色）。
     * 校验：同作用域重名（同维主 tag 之间 / 同父副 tag 之间，排除自身）→ TAG_EXISTS；「未标注」锁定。
     */
    update(ledgerId, tagId, { name, color } = {}) {
      const tag = requireTag(ledgerId, tagId);
      assertEditable(tag);
      if (name !== undefined) {
        if (!name || !String(name).trim()) throw new BizError('tag 名不能为空', 'MISSING_FIELD');
        const clean = String(name).trim();
        if (tags.nameExistsUnder(tag.dimension_id, tag.parent_tag_id, clean, tagId)) {
          throw new BizError(`同层级已存在同名 tag: ${clean}`, 'TAG_EXISTS', 409);
        }
        name = clean;
      }
      tags.updateTag(tagId, { name, color });
      return tags.tagById(ledgerId, tagId);
    },

    /**
     * 删 tag。删除保护（D-11 + S6-v3）：
     * 「未标注」锁定；自身被任一花销引用（primary/secondary）→ TAG_IN_USE；
     * 删**主 tag** 时其副 tag 若被引用也拒删 —— 否则 ON DELETE CASCADE 会静默删掉副 tag 及其 links，
     * 造成历史断裂（与 Σ 守恒不变量同源的保护）。
     */
    remove(ledgerId, tagId) {
      const tag = requireTag(ledgerId, tagId);
      assertEditable(tag);
      if (tags.referenceCount(tagId) > 0) {
        throw new BizError(`tag 正被花销引用，无法删除: ${tag.name}`, 'TAG_IN_USE', 409);
      }
      const usedChild = tags.childrenOf(ledgerId, tagId).find(c => tags.referenceCount(c.id) > 0);
      if (usedChild) {
        throw new BizError(`其副 tag「${usedChild.name}」正被花销引用，无法删除`, 'TAG_IN_USE', 409);
      }
      tags.removeTag(tagId);
    },
  };
}
