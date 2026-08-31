/**
 * 交易组视图模型 —— 刻意做薄的一层。
 *
 * 后端契约（CustomerLedgerDto / PoolEntry 的类注释）：
 *   1. 每个资金池独立记自己的账，余额 = 池内条目金额之和；
 *   2. 同一笔跨池流转的所有条目共享同一个 transferGroupId，组内金额之和 = 0。
 *
 * 所以前端要做的只有两件事：按 transferGroupId 归并、按 direction 拆出入金腿。
 * 不推导连边、不猜对手方、不做可信度降级 —— 配对是后端权威结论，
 * 缺腿的情况后端已在 metadata.pairingStatus / groupVerifySummary 里如实标注。
 *
 * 金额统一按「分」整数累加，避免浮点漂移让守恒差出 0.01。
 */

import { number, type FundPool, type LedgerEntry } from './api';
import { poolIcon } from './charts/icons';
import { groupTypeInfo, poolTypeInfo, type GroupTypeInfo } from './codes';

export interface TxnGroup {
  /** transferGroupId 原值；后端兜底组为 GRP_INTERNAL_ 前缀 */
  groupId: string;
  /** groupType 对应的动作语义 */
  info: GroupTypeInfo;
  /** 出金腿（direction=OUTFLOW） */
  outLegs: LedgerEntry[];
  /** 入金腿（direction=INFLOW） */
  inLegs: LedgerEntry[];
  /** 组内全部腿，按时间正序 */
  legs: LedgerEntry[];
  /** 这次操作的金额口径 = max(入金合计, 出金合计)，单位元 */
  amount: number;
  /** 入金合计 − 出金合计，单位元。后端契约下应为 0，不为 0 时如实呈现 */
  diff: number;
  /** 组内最早/最晚完成时间 */
  startTime: string;
  endTime: string;
  /** 是否含未到账明细（LedgerEntryStatus.EXECUTING） */
  hasExecuting: boolean;
  /** 后端标注的未配对原因（metadata.pairingReason），已配对时为空 */
  pairingReason: string;
}

/** 元 → 分，避免累加漂移。 */
function cents(value: unknown): number {
  return Math.round(number(value) * 100);
}

function timeKey(entry: LedgerEntry): string {
  return String(entry.finishTime ?? '');
}

/** 从接口返回的池列表里取出全部明细（groupByPool=true 时明细挂在池上）。 */
export function allEntries(pools: FundPool[], flat?: LedgerEntry[]): LedgerEntry[] {
  const source = flat?.length ? flat : pools.flatMap((pool) => pool.entries ?? []);
  return source.slice().sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
}

/**
 * 按 transferGroupId 归并成交易组，时间倒序（最近的操作在最前）。
 * 没有 transferGroupId 的条目各自成组，如实标为未识别，不与其他条目合并。
 */
export function buildGroups(entries: LedgerEntry[]): TxnGroup[] {
  const buckets = new Map<string, LedgerEntry[]>();
  entries.forEach((entry, index) => {
    const key = entry.transferGroupId || `__UNGROUPED_${entry.entryId ?? index}`;
    const list = buckets.get(key) ?? [];
    list.push(entry);
    buckets.set(key, list);
  });

  const groups = [...buckets.entries()].map(([groupId, list]) => {
    const legs = list.slice().sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
    const outLegs = legs.filter((e) => e.direction === 'OUTFLOW');
    const inLegs = legs.filter((e) => e.direction === 'INFLOW');
    const outCents = outLegs.reduce((sum, e) => sum + cents(e.amount), 0);
    const inCents = inLegs.reduce((sum, e) => sum + cents(e.amount), 0);
    const first = legs[0];
    const last = legs[legs.length - 1];
    return {
      groupId,
      info: groupTypeInfo(first?.groupType),
      outLegs,
      inLegs,
      legs,
      amount: Math.max(outCents, inCents) / 100,
      diff: (inCents - outCents) / 100,
      startTime: timeKey(first),
      endTime: timeKey(last),
      hasExecuting: legs.some((e) => e.status === 'EXECUTING'),
      pairingReason: String(first?.metadata?.pairingReason ?? ''),
    };
  });

  return groups.sort((a, b) => b.startTime.localeCompare(a.startTime));
}

// ============ 资金池展示 ============

export interface PoolDisplay {
  /** 行内单色 SVG 图标，HTML 与 SVG 上下文都能直接插 */
  icon: string;
  /** 池类型键，SVG 里需要自己定位图标时用 poolIcon(iconType, {x, y}) */
  iconType: string;
  /** 业务名：整装款项用款项名，其余用池类型描述 */
  name: string;
  /** 缩略单号，完整值放 title */
  shortId: string;
  fullId: string;
  /** 次要说明：所属 CT 单等 */
  note: string;
  scope: 'INTERNAL' | 'EXTERNAL';
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 5)}…${id.slice(-4)}` : id;
}

/** poolId → 池信息，供腿反查所属池。 */
export function poolIndex(pools: FundPool[]): Map<string, FundPool> {
  return new Map(pools.filter((p) => p.poolId).map((p) => [p.poolId as string, p]));
}

/**
 * 池的展示信息。优先用接口给的 poolTypeDesc / fundName，
 * 接口没给才回落到本地码表。
 */
export function poolDisplay(poolId: string, poolType?: string, pool?: FundPool): PoolDisplay {
  const type = poolTypeInfo(poolType ?? pool?.poolType);
  const typeName = pool?.poolTypeDesc || type.label;
  const external = type.scope === 'EXTERNAL';
  // FUND 池的 poolTypeDesc 与 fundName 常常是同一个值（都为「工程款」），只拼一次
  const name = pool?.fundName && pool.fundName !== typeName ? `${typeName}·${pool.fundName}` : typeName;
  const iconType = poolType ?? pool?.poolType ?? 'OTHER';
  return {
    icon: poolIcon(iconType),
    iconType,
    name,
    // 客户钱包/开发商这类系统外虚拟池，poolId 就是类型名本身，没有单号可显示
    shortId: external ? '' : shortId(poolId),
    fullId: poolId,
    note: pool?.compositOrderNo ? `所属 ${pool.compositOrderNo}` : '',
    scope: type.scope,
  };
}

/** 腿 → 池展示信息。 */
export function legDisplay(entry: LedgerEntry, index: Map<string, FundPool>): PoolDisplay {
  const id = entry.accountId ?? '';
  return poolDisplay(id, entry.accountType, index.get(id));
}

/** 按池类型分组，保持给定的类型顺序。 */
export function poolsByType(pools: FundPool[], order: string[]): Array<{ type: string; list: FundPool[] }> {
  const map = new Map<string, FundPool[]>();
  pools.forEach((pool) => {
    const key = pool.poolType ?? 'OTHER';
    map.set(key, [...(map.get(key) ?? []), pool]);
  });
  const known = order.filter((type) => map.has(type)).map((type) => ({ type, list: map.get(type) as FundPool[] }));
  const rest = [...map.keys()].filter((type) => !order.includes(type))
    .map((type) => ({ type, list: map.get(type) as FundPool[] }));
  return [...known, ...rest];
}

/** 池余额合计（元）。 */
export function totalBalance(pools: FundPool[]): number {
  return pools.reduce((sum, pool) => sum + cents(pool.balance), 0) / 100;
}

// ============ 池间连边 ============

export interface PoolEdge {
  /** 出金池 poolId */
  from: string;
  /** 入金池 poolId */
  to: string;
  /** 金额（元），取自某条腿的原值，没有做任何拆分或分摊 */
  amount: number;
}

/**
 * 一个交易组的池间连边。
 *
 * 账本记的是「这些池出了多少、那些池进了多少」，并没有记「哪一笔出金对应哪一笔入金」。
 * 所以只有当一侧只涉及 1 个资金池时，连边才被账本唯一确定 —— 另一侧每条腿的原始金额
 * 就是那条边的金额。两侧都涉及 ≥2 个池时，一对一的对应关系账本里不存在，
 * 返回 null 表示「画不出来」，由调用方如实告知并引导到流水明细，绝不按比例瞎分。
 *
 * 实测 2872 / 1111 两单共 23 个组，需要返回 null 的是 0 个。
 */
export function groupEdges(group: TxnGroup): PoolEdge[] | null {
  const fromIds = new Set(group.outLegs.map((leg) => leg.accountId ?? ''));
  const toIds = new Set(group.inLegs.map((leg) => leg.accountId ?? ''));
  if (!fromIds.size || !toIds.size) return [];         // 单边组/断链组：本来就没有边
  if (fromIds.size > 1 && toIds.size > 1) return null; // 多对多：账本无法确定

  if (fromIds.size === 1) {
    const from = [...fromIds][0];
    return group.inLegs.map((leg) => ({ from, to: leg.accountId ?? '', amount: number(leg.amount) }));
  }
  const to = [...toIds][0];
  return group.outLegs.map((leg) => ({ from: leg.accountId ?? '', to, amount: number(leg.amount) }));
}
