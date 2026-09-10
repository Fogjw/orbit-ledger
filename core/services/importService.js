// 导入业务服务：把一个备份快照回读为**新账本**（exportService 的对称面，D-13）
// 语义决策：
//  - 不覆盖、不合并：快照带原始主键，覆盖语义要处理 id 冲突与级联删除，风险远大于收益；
//    导入 = 新建账本，源账本与导入结果互不影响（账本隔离不变量不破）
//  - 主键全部重新分配：旧 id 只用于快照内部相互引用，服务内建 old→new 映射
//  - 整批单事务：任一步失败整体回滚，绝不留「半个账本」
import { createImportRepo } from '../repos/importRepo.js';
import { createLedgerRepo } from '../repos/ledgerRepo.js';
import { transaction } from '../transaction.js';
import { BizError } from './ledgerService.js';

const BACKUP_FORMAT = 'orbit-ledger-backup';
const SUPPORTED_VERSIONS = new Set([1]);
/** 快照必须携带的扁平表（与 exportRepo.snapshot 的输出对齐） */
const TABLES = ['dimensions', 'tags', 'expenses', 'expense_tag_links'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIM_KEYS = new Set(['category', 'context', 'payment']);
const EXPENSE_TYPES = new Set(['expense', 'income']);
const LINK_ROLES = new Set(['primary', 'secondary']);

export function createImportService(db) {
  const repo = createImportRepo(db);
  const ledgers = createLedgerRepo(db);

  const bad = (why) => new BizError(`备份不合法：${why}`, 'INVALID_BACKUP', 400);
  const incomplete = (why) => new BizError(`备份不完整：${why}`, 'BACKUP_INCOMPLETE', 400);

  const isPosInt = (v) => Number.isInteger(v) && v > 0;
  const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;

  /**
   * 快照结构与引用校验（只读，不碰库）。
   * 字段级校验前置的意义：schema 的 CHECK 约束虽然也能挡住脏值，但那会变成 500；
   * 这里统一收敛成 400 + 可读原因，且**先校验后写库**，坏备份不会连事务都不用开。
   * @returns {string} 账本名（已 trim）
   */
  function validate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw bad('内容不是对象');
    if (snapshot.format !== BACKUP_FORMAT) throw bad(`format 应为 ${BACKUP_FORMAT}`);
    if (!SUPPORTED_VERSIONS.has(snapshot.version)) throw bad(`不支持的版本 ${snapshot.version}`);
    if (!snapshot.ledger || typeof snapshot.ledger !== 'object') throw bad('缺少 ledger');
    const name = isNonEmptyStr(snapshot.ledger.name) ? snapshot.ledger.name.trim() : '';
    if (!name) throw bad('账本名为空');
    for (const t of TABLES) if (!Array.isArray(snapshot[t])) throw bad(`缺少数组 ${t}`);

    // 字段级
    for (const d of snapshot.dimensions) {
      if (!DIM_KEYS.has(d.key)) throw bad(`未知维度 key「${d.key}」`);
      if (!isNonEmptyStr(d.name)) throw bad(`维度「${d.key}」名称为空`);
    }
    for (const t of snapshot.tags) {
      if (!isNonEmptyStr(t.name)) throw bad('tag 名称为空');
      if (t.is_unnamed !== undefined && t.is_unnamed !== 0 && t.is_unnamed !== 1) {
        throw bad(`tag「${t.name}」的 is_unnamed 应为 0 或 1`);
      }
    }
    for (const e of snapshot.expenses) {
      if (e.type !== undefined && !EXPENSE_TYPES.has(e.type)) throw bad(`未知花销类型「${e.type}」`);
      if (!isPosInt(e.amount_cents)) throw bad('花销金额应为正整数（分）');
      if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) throw bad(`日期格式应为 YYYY-MM-DD：「${e.date}」`);
    }
    for (const l of snapshot.expense_tag_links) {
      if (l.role !== undefined && !LINK_ROLES.has(l.role)) throw bad(`未知关联角色「${l.role}」`);
    }

    // 引用完整性（快照必须自洽，否则重建出来的图会缺边）
    const dimIds = new Set(snapshot.dimensions.map(d => d.id));
    const tagIds = new Set(snapshot.tags.map(t => t.id));
    const expIds = new Set(snapshot.expenses.map(e => e.id));
    const parentOf = new Map(snapshot.tags.map(t => [t.id, t.parent_tag_id ?? null]));
    for (const t of snapshot.tags) {
      if (!dimIds.has(t.dimension_id)) throw incomplete(`tag「${t.name}」的维度不在备份里`);
      if (t.parent_tag_id != null) {
        if (!tagIds.has(t.parent_tag_id)) throw incomplete(`副 tag「${t.name}」的父 tag 不在备份里`);
        // 只支持两级（D-14）：父本身不能再有父
        if (parentOf.get(t.parent_tag_id) != null) throw incomplete(`副 tag「${t.name}」的父 tag 自身是副 tag（不支持三级）`);
      }
    }
    for (const l of snapshot.expense_tag_links) {
      if (!expIds.has(l.expense_id)) throw incomplete(`关联引用了不存在的花销 ${l.expense_id}`);
      if (!tagIds.has(l.tag_id)) throw incomplete(`关联引用了不存在的 tag ${l.tag_id}`);
    }
    return name;
  }

  return {
    /**
     * 回读备份快照为**新账本**（单事务）。
     * @param {object} snapshot exportService.ledgerSnapshot 的产物
     * @returns {{ledger: object, counts: {dimensions:number, tags:number, expenses:number, links:number}}}
     */
    importSnapshot(snapshot) {
      const name = validate(snapshot);

      return transaction(db, () => {
        const ledgerId = repo.insertLedger(name, snapshot.ledger.created_at ?? null);

        // 维度：旧 id → 新 id
        const dimMap = new Map();
        for (const d of snapshot.dimensions) {
          dimMap.set(d.id, repo.insertDimension(ledgerId, {
            key: d.key, name: d.name, position: d.position, required: d.required,
          }));
        }

        // tag：**先主后副** —— parent_tag_id 是自引用外键，父必须已存在
        const tagMap = new Map();
        const roots = snapshot.tags.filter(t => t.parent_tag_id == null);
        const subs = snapshot.tags.filter(t => t.parent_tag_id != null);
        for (const t of [...roots, ...subs]) {
          tagMap.set(t.id, repo.insertTag(ledgerId, {
            dimensionId: dimMap.get(t.dimension_id),
            name: t.name,
            isUnnamed: t.is_unnamed,
            color: t.color,
            position: t.position,
            parentTagId: t.parent_tag_id == null ? null : tagMap.get(t.parent_tag_id),
          }));
        }

        // 花销
        const expMap = new Map();
        for (const e of snapshot.expenses) {
          expMap.set(e.id, repo.insertExpense(ledgerId, {
            type: e.type, amountCents: e.amount_cents, date: e.date,
            note: e.note, createdAt: e.created_at,
          }));
        }

        // 关联（每维一个 primary 的结构随快照原样恢复）
        for (const l of snapshot.expense_tag_links) {
          repo.insertLink(expMap.get(l.expense_id), tagMap.get(l.tag_id), l.role);
        }

        return {
          ledger: ledgers.byId(ledgerId),
          counts: {
            dimensions: snapshot.dimensions.length,
            tags: snapshot.tags.length,
            expenses: snapshot.expenses.length,
            links: snapshot.expense_tag_links.length,
          },
        };
      });
    },
  };
}
