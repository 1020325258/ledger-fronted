/**
 * 资金流向图 —— 连边推导。
 *
 * 把账本流水推导成「资金池 → 资金池」的有向边，保证每笔钱只算一次，
 * 并让每个池满足  Σ入边 - Σ出边 == pool.balance（可自校验）。
 *
 * 依据（读 CustomerLedgerService.java 源码得到，非推测）：
 *   L45   契约：跨池流转通过 transferGroupId 串联，组内金额之和 = 0
 *   L683  transferGroupId = "GRP_DEDUCT_" + deductTxn + "_" + deductCtNo
 *   L689  counterpartPoolId = deductCtNo
 *         → 预收款抵扣到 FU单 (deduct_type=10) 时 deductCtNo 为空串，于是
 *           groupId 以 "_" 结尾、counterpartPoolId === ""，而 counterpartType
 *           仍被写成 "SUB_ORDER_POOL"（真实目标是 FUND 池）。故 DEDUCT_OUT
 *           的候选目标类型把 FUND 排在 SUB_ORDER 之前。
 *   L665  transferGroupId = "GRP_CUST_PAY_" + payTransactionNo
 *         → payTransactionNo 为空时退化成裸前缀，不能用于配对。
 *
 * 金额全程用「分」整数运算，避免浮点漂移导致对账差 0.01。
 */

export type PoolTypeKey = 'CUSTOMER' | 'ADVANCE' | 'WALLET' | 'SUB_ORDER' | 'FUND' | 'EXTERNAL';

/** 连边可信度，由高到低。渲染时 INFERRED 用更淡的样式并标注「推断」。 */
export type Confidence = 'PAIRED' | 'MATCHED' | 'INFERRED';

export interface FlowEntry {
  direction?: string;
  amount?: number;
  fundActionType?: string;
  fundActionDesc?: string;
  groupType?: string | null;
  transferGroupId?: string | null;
  transactionNo?: string | null;
  finishTime?: number | string | null;
  cashierType?: number | null;
  metadata?: Record<string, unknown>;
}

export interface FlowPool {
  poolId?: string;
  poolType?: string;
  poolTypeDesc?: string;
  fundName?: string;
  compositOrderNo?: string;
  balance?: number;
  entries?: FlowEntry[];
}

export interface FlowEdge {
  /** 源节点 id：真实 poolId，或 `__TYPE__` 形式的虚拟节点 */
  src: string;
  dst: string;
  /** 金额，单位「分」 */
  amount: number;
  kind: 'FORWARD' | 'REFUND';
  confidence: Confidence;
  /** 该边聚合到的原始流水（用于下钻） */
  items: { desc: string; amount: number; transactionNo?: string | null; finishTime?: number | string | null }[];
}

export interface FlowNode {
  id: string;
  type: PoolTypeKey;
  /** 展示名 */
  label: string;
  /** 余额，单位「分」 */
  balance: number;
  inflow: number;
  outflow: number;
  /** 该节点聚合了多少个真实资金池 */
  poolCount: number;
  /** 明细池（仅类型级节点有） */
  pools: FlowPool[];
  /** 是否虚拟节点（外部/未匹配） */
  virtual: boolean;
  /** Σ入-Σ出 与 balance 的差额（分）。0 表示对账通过 */
  drift: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 对账不平的节点数 */
  driftCount: number;
  /** 各可信度的边数量 */
  confidenceStats: Record<Confidence, number>;
}

/** 退化的 transferGroupId：只有前缀、无业务键，不能用来配对 */
const DEGENERATE_GRP = new Set([
  'GRP_CUST_PAY_', 'GRP_CUST_REFUND_', 'GRP_DEDUCT_', 'GRP_REFUND_IN_',
  'GRP_WALLET_IN_', 'GRP_WALLET_DEDUCT_', 'GRP_FUND_DEDUCT_', 'GRP_DESTROY_',
  'GRP_INTERNAL_', 'GRP_REFUND_DEDUCT_', 'GRP_FUND_',
]);

/** OUTFLOW 的 fundActionType → 候选目标池类型（按优先级） */
const OUT_TARGETS: Record<string, PoolTypeKey[]> = {
  DEDUCT_OUT: ['FUND', 'SUB_ORDER'],
  CUSTOMER_PAY: ['ADVANCE', 'SUB_ORDER', 'FUND'],
  FUND_PAY_CUSTOMER: ['FUND'],
  WALLET_DEDUCT: ['SUB_ORDER', 'FUND'],
  REFUND_DEDUCT: ['ADVANCE'],
  ADVANCE_REFUND_OUT: ['CUSTOMER', 'WALLET'],
  FUND_REFUND: ['CUSTOMER', 'WALLET'],
  FUND_WRITEOFF: ['EXTERNAL'],
  REFUND_TO_CUSTOMER: ['CUSTOMER'],
};

/**
 * OUTFLOW 的 groupType（后端稳定枚举，LedgerGroupType）→ 候选目标池类型。
 * 优先于 fundActionType 规则：后端新增动作时 groupType 更稳定，规则表只做兜底。
 */
const GROUP_OUT_TARGETS: Record<string, PoolTypeKey[]> = {
  CUST_PAY: ['ADVANCE', 'SUB_ORDER', 'FUND'],
  ADVANCE_REFUND: ['CUSTOMER', 'WALLET'],
  ORDER_REFUND: ['ADVANCE', 'CUSTOMER', 'WALLET'],
  WALLET_DEDUCT: ['ADVANCE', 'SUB_ORDER', 'FUND'],
  FUND_REFUND: ['CUSTOMER', 'WALLET'],
  FUND_WRITEOFF: ['EXTERNAL'],
  REFUND_TO_CUSTOMER: ['CUSTOMER'],
};

/** INFLOW 的 fundActionType → 候选来源池类型 */
const IN_SOURCES: Record<string, PoolTypeKey[]> = {
  PAY_IN: ['CUSTOMER'],
  FUND_PAY: ['CUSTOMER', 'ADVANCE', 'WALLET'],
  FUND_DEDUCT_IN: ['ADVANCE', 'WALLET'],
  ADVANCE_DEDUCT: ['ADVANCE'],
  REFUND_TO_ADVANCE: ['SUB_ORDER'],
  WALLET_TRANSFER_IN: ['SUB_ORDER', 'ADVANCE', 'FUND'],
  FUND_REFUND_TO_CUSTOMER: ['FUND'],
  FUND_REFUND_TO_WALLET: ['FUND'],
  FUND_WARRANT: ['EXTERNAL'],
  FUND_PAID_DIFF: ['EXTERNAL'],
};

/** INFLOW 的 groupType → 候选来源池类型 */
const GROUP_IN_SOURCES: Record<string, PoolTypeKey[]> = {
  CUST_PAY: ['CUSTOMER'],
  ADVANCE_REFUND: ['ADVANCE'],
  ORDER_REFUND: ['SUB_ORDER'],
  WALLET_DEDUCT: ['WALLET'],
  FUND_PAY: ['CUSTOMER', 'ADVANCE', 'WALLET'],
  FUND_DEDUCT: ['ADVANCE', 'WALLET'],
};

export const POOL_TYPE_LABEL: Record<PoolTypeKey, string> = {
  CUSTOMER: '客户钱包',
  ADVANCE: '预收款池',
  WALLET: '客户余额池',
  SUB_ORDER: '商品子单池',
  FUND: '整装款项池',
  EXTERNAL: '外部/未匹配',
};

export const POOL_TYPE_ICON: Record<PoolTypeKey, string> = {
  CUSTOMER: '👤', ADVANCE: '🏦', WALLET: '💰', SUB_ORDER: '📦', FUND: '🏠', EXTERNAL: '❓',
};

export const POOL_TYPE_COLOR: Record<PoolTypeKey, string> = {
  CUSTOMER: '#eb2f96', ADVANCE: '#faad14', WALLET: '#1890ff',
  SUB_ORDER: '#52c41a', FUND: '#722ed1', EXTERNAL: '#8c8c8c',
};

export function toCents(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function formatYuan(cents: number): string {
  return fromCents(cents).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 带正负号的金额；0 不带符号，避免出现「−0.00」这种读起来别扭的写法 */
export function formatSigned(cents: number, sign: '+' | '−'): string {
  return `${cents === 0 ? '' : sign}${formatYuan(cents)}`;
}

/** 池 id 前缀推断类型（对手池不在返回结果里时用） */
export function typeFromPoolId(poolId: string | null | undefined): PoolTypeKey {
  if (!poolId) return 'EXTERNAL';
  if (poolId === 'CUSTOMER') return 'CUSTOMER';
  if (poolId === 'WALLET' || poolId.startsWith('WA')) return 'WALLET';
  if (poolId.startsWith('M1')) return 'ADVANCE';
  if (poolId.startsWith('FU')) return 'FUND';
  if (poolId.startsWith('S1') || poolId.startsWith('CT')) return 'SUB_ORDER';
  return 'EXTERNAL';
}

function normalizeType(poolType: string | undefined): PoolTypeKey {
  const t = (poolType ?? '') as PoolTypeKey;
  return t in POOL_TYPE_LABEL ? t : 'EXTERNAL';
}

/** 虚拟节点 id：对手方无法定位时的占位，`__V_<TYPE>__` */
function virtualId(type: PoolTypeKey): string {
  return `__V_${type}__`;
}

function isVirtualId(nodeId: string): boolean {
  return nodeId.startsWith('__V_');
}

/** 从虚拟节点 id 取出它「本该是」的类型，用于展示提示 */
function virtualType(nodeId: string): PoolTypeKey {
  const t = nodeId.slice(4, -2) as PoolTypeKey;
  return t in POOL_TYPE_LABEL ? t : 'EXTERNAL';
}

function isRefund(entry: FlowEntry): boolean {
  const at = entry.fundActionType ?? '';
  const gt = entry.groupType ?? '';
  const desc = entry.fundActionDesc ?? '';
  return at.includes('REFUND') || at.includes('WRITEOFF') || gt.includes('REFUND')
    || desc.includes('退款') || desc.includes('回流') || desc.includes('冲销');
}

function validGroup(grp: string | null | undefined): boolean {
  return !!grp && !DEGENERATE_GRP.has(grp) && !grp.endsWith('_');
}

interface Rec {
  pool: string;
  ptype: PoolTypeKey;
  dir: string;
  amt: number;
  grp: string | null;
  at: string;
  gt: string | null;
  desc: string;
  refund: boolean;
  used: number;
  txn: string | null | undefined;
  time: number | string | null | undefined;
}

/**
 * 推导资金池之间的流转边。
 * @param pools 接口返回的资金池数组
 * @param level 'type' 汇总到池类型（全局一眼看懂）；'pool' 保留到具体池
 */
export function buildFlowGraph(pools: FlowPool[], level: 'type' | 'pool' = 'type'): FlowGraph {
  const recs: Rec[] = [];
  for (const pool of pools) {
    for (const entry of pool.entries ?? []) {
      recs.push({
        pool: pool.poolId ?? '未知池',
        ptype: normalizeType(pool.poolType),
        dir: entry.direction ?? '',
        amt: toCents(entry.amount),
        grp: entry.transferGroupId ?? null,
        at: entry.fundActionType ?? '',
        gt: entry.groupType ?? null,
        desc: entry.fundActionDesc ?? '',
        refund: isRefund(entry),
        used: 0,
        txn: (entry.metadata?.['transactionNo'] as string | null | undefined) ?? entry.transactionNo,
        time: entry.finishTime,
      });
    }
  }

  const rawEdges: FlowEdge[] = [];
  const remain = (r: Rec) => r.amt - r.used;

  const emit = (src: string, dst: string, amt: number, kind: FlowEdge['kind'],
                confidence: Confidence, r: Rec) => {
    if (amt <= 0) return;
    rawEdges.push({
      src, dst, amount: amt, kind, confidence,
      items: [{ desc: r.desc, amount: amt, transactionNo: r.txn, finishTime: r.time }],
    });
  };

  const pairUp = (out: Rec, inn: Rec, amt: number, confidence: Confidence) => {
    out.used += amt;
    inn.used += amt;
    emit(out.pool, inn.pool, amt, (out.refund || inn.refund) ? 'REFUND' : 'FORWARD', confidence, out);
  };

  // ---- A. transferGroupId 有效组内配对（后端设计的主机制）----
  const groups = new Map<string, Rec[]>();
  for (const r of recs) {
    if (!validGroup(r.grp)) continue;
    const list = groups.get(r.grp!) ?? [];
    list.push(r);
    groups.set(r.grp!, list);
  }
  for (const members of groups.values()) {
    const outs = members.filter((r) => r.dir === 'OUTFLOW');
    const ins = members.filter((r) => r.dir === 'INFLOW');
    if (!outs.length || !ins.length) continue;
    let oi = 0;
    for (const inn of ins) {
      while (remain(inn) > 0 && oi < outs.length) {
        const out = outs[oi];
        if (remain(out) <= 0) { oi += 1; continue; }
        pairUp(out, inn, Math.min(remain(out), remain(inn)), 'PAIRED');
      }
    }
  }

  // ---- C. 语义规则表 + 等额优先匹配 ----
  const candidatesOf = (out: Rec): PoolTypeKey[] => {
    const byGroup = out.gt ? GROUP_OUT_TARGETS[out.gt] : undefined;
    return byGroup?.length ? byGroup : (OUT_TARGETS[out.at]?.length ? OUT_TARGETS[out.at] : ['EXTERNAL']);
  };
  for (const out of recs) {
    if (out.dir !== 'OUTFLOW' || remain(out) <= 0) continue;
    for (const tgtType of candidatesOf(out)) {
      if (remain(out) <= 0) break;
      const pick = recs.filter((r) => r.dir === 'INFLOW' && remain(r) > 0
        && r.ptype === tgtType && r.pool !== out.pool
        && (IN_SOURCES[r.at] ?? [out.ptype]).includes(out.ptype));
      const exact = pick.filter((r) => remain(r) === remain(out));
      for (const inn of (exact.length ? exact : pick)) {
        if (remain(out) <= 0) break;
        pairUp(out, inn, Math.min(remain(out), remain(inn)), 'MATCHED');
      }
    }
  }

  // ---- D. 只知一侧，另一侧落到虚拟节点 ----
  // 虚拟节点一律带 __V_ 前缀，绝不与同类型的真实池合并：
  // 「钱去了客户但定位不到具体池」与「客户钱包池」是两件事，合并会让真实边在
  // 类型级聚合时变成自环而被丢弃，对账凭空少一笔（已由 ledger-verify 样本复现）。
  for (const out of recs) {
    if (out.dir !== 'OUTFLOW' || remain(out) <= 0) continue;
    const tgt = virtualId(candidatesOf(out)[0]);
    const take = remain(out);
    out.used += take;
    emit(out.pool, tgt, take, out.refund ? 'REFUND' : 'FORWARD', 'INFERRED', out);
  }
  for (const inn of recs) {
    if (inn.dir !== 'INFLOW' || remain(inn) <= 0) continue;
    const byGroup = inn.gt ? GROUP_IN_SOURCES[inn.gt] : undefined;
    const srcType = (byGroup ?? IN_SOURCES[inn.at] ?? [])[0] ?? 'EXTERNAL';
    const take = remain(inn);
    inn.used += take;
    emit(virtualId(srcType), inn.pool, take, inn.refund ? 'REFUND' : 'FORWARD', 'INFERRED', inn);
  }

  return assemble(pools, rawEdges, level);
}

/** 把原始边聚合到指定粒度，并算出节点余额与自校验差额。 */
function assemble(pools: FlowPool[], rawEdges: FlowEdge[], level: 'type' | 'pool'): FlowGraph {
  const poolById = new Map(pools.map((p) => [p.poolId ?? '未知池', p]));

  const nodeIdOf = (raw: string): string => {
    // 虚拟节点在类型级全部折叠成一个「外部/未匹配」桶，明细级保留各自类型
    if (isVirtualId(raw)) return level === 'type' ? virtualId('EXTERNAL') : raw;
    if (level === 'pool') return raw;
    const pool = poolById.get(raw);
    return `__${pool ? normalizeType(pool.poolType) : typeFromPoolId(raw)}__`;
  };
  const typeOf = (nodeId: string): PoolTypeKey => {
    if (isVirtualId(nodeId)) return virtualType(nodeId);
    if (nodeId.startsWith('__')) {
      const t = nodeId.slice(2, -2) as PoolTypeKey;
      return t in POOL_TYPE_LABEL ? t : 'EXTERNAL';
    }
    const pool = poolById.get(nodeId);
    return pool ? normalizeType(pool.poolType) : typeFromPoolId(nodeId);
  };

  // 聚合边：同 (src,dst,kind) 合并，可信度取最低的那一档展示
  const CONF_RANK: Confidence[] = ['PAIRED', 'MATCHED', 'INFERRED'];
  const edgeMap = new Map<string, FlowEdge>();
  const confidenceStats: Record<Confidence, number> = { PAIRED: 0, MATCHED: 0, INFERRED: 0 };
  for (const e of rawEdges) {
    confidenceStats[e.confidence] += 1;
    const src = nodeIdOf(e.src);
    const dst = nodeIdOf(e.dst);
    if (src === dst) continue; // 同节点内部流转在该粒度下不显示
    const key = `${src} ${dst} ${e.kind}`;
    const hit = edgeMap.get(key);
    if (hit) {
      hit.amount += e.amount;
      hit.items.push(...e.items);
      if (CONF_RANK.indexOf(e.confidence) > CONF_RANK.indexOf(hit.confidence)) hit.confidence = e.confidence;
    } else {
      edgeMap.set(key, { ...e, src, dst, items: [...e.items] });
    }
  }
  const edges = [...edgeMap.values()].sort((a, b) => b.amount - a.amount);

  // 节点：真实池分组 + 虚拟节点
  const nodeIds = new Set<string>();
  for (const e of edges) { nodeIds.add(e.src); nodeIds.add(e.dst); }
  // 没有任何流水的池也要出现（余额可能非 0）
  for (const p of pools) nodeIds.add(nodeIdOf(p.poolId ?? '未知池'));

  const inflowBy = new Map<string, number>();
  const outflowBy = new Map<string, number>();
  for (const e of edges) {
    inflowBy.set(e.dst, (inflowBy.get(e.dst) ?? 0) + e.amount);
    outflowBy.set(e.src, (outflowBy.get(e.src) ?? 0) + e.amount);
  }

  const nodes: FlowNode[] = [...nodeIds].map((id) => {
    const type = typeOf(id);
    const own = level === 'pool'
      ? (poolById.has(id) ? [poolById.get(id)!] : [])
      : pools.filter((p) => normalizeType(p.poolType) === type);
    const virtual = own.length === 0;
    const balance = own.reduce((sum, p) => sum + toCents(p.balance), 0);
    const inflow = inflowBy.get(id) ?? 0;
    const outflow = outflowBy.get(id) ?? 0;
    const label = level === 'pool' && !virtual ? id : POOL_TYPE_LABEL[type];
    return {
      id, type, label, balance, inflow, outflow,
      poolCount: own.length,
      pools: own.slice().sort((a, b) => Math.abs(toCents(b.balance)) - Math.abs(toCents(a.balance))),
      virtual,
      // 虚拟节点没有 balance 概念，不参与对账
      drift: virtual ? 0 : (inflow - outflow) - balance,
    };
  });

  return {
    nodes,
    edges,
    driftCount: nodes.filter((n) => n.drift !== 0).length,
    confidenceStats,
  };
}
