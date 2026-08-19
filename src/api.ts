/**
 * 数据层：账本接口类型定义、请求封装、URL 查询参数状态。
 *
 * 与后端 DTO（CustomerLedgerDto / FundPool / PoolEntry）一一对应，
 * 前端展示层只消费这里归一化后的结构。
 */

// ============ 类型定义（与后端 DTO 对齐） ============

export interface LedgerEntry {
  entryId?: string;
  accountId?: string;
  accountType?: string;
  direction?: string;
  amount?: number;
  fundActionType?: string;
  fundActionDesc?: string;
  transferGroupId?: string | null;
  groupType?: string | null;
  status?: string | null;
  sourceTable?: string;
  sourceRecordId?: string;
  finishTime?: string | number | null;
  metadata?: Record<string, unknown>;
}

export interface SubFundPoolInfo {
  subFundId?: string;
  subFundName?: string;
  subFundItemName?: string;
  subFundItemType?: number;
  dueAmount?: number;
  paidAmount?: number;
  tobeRefundAmount?: number;
}

export interface PoolBalanceVerify {
  balanceSource?: string;
  ledgerBalance?: number;
  dbBalance?: number;
  diff?: number;
  passed?: boolean;
  verifyNote?: string;
}

export interface FundPool {
  poolId?: string;
  compositOrderNo?: string;
  poolType?: string;
  poolScope?: string;
  poolTypeDesc?: string;
  fundType?: number;
  fundName?: string;
  projectOrderId?: string;
  balance?: number;
  fundAmount?: number;
  paidAmount?: number;
  tobeRefundAmount?: number;
  subFunds?: SubFundPoolInfo[];
  entryCount?: number;
  entries?: LedgerEntry[];
  balanceVerify?: PoolBalanceVerify;
}

export interface VerifySummary {
  poolCount?: number;
  checkedCount?: number;
  passedCount?: number;
  mismatchCount?: number;
  skippedCount?: number;
  allPass?: boolean;
  ruleDesc?: string;
  groupCount?: number;
  checkedGroupCount?: number;
  balancedGroupCount?: number;
  unbalancedGroupCount?: number;
  pendingGroupCount?: number;
  singleSidedGroupCount?: number;
  mismatchDetails?: Array<Record<string, unknown>>;
}

export interface Ledger {
  ucid?: number;
  customerTotalPay?: number;
  customerTotalRefund?: number;
  customerNetInvestment?: number;
  systemBalance?: number;
  systemInternalBalance?: number;
  externalBalance?: number;
  isBalanced?: boolean;
  balanceCheckMessage?: string;
  warnings?: string[];
  balanceVerifySummary?: VerifySummary;
  groupVerifySummary?: VerifySummary;
  entries?: LedgerEntry[];
  pools?: FundPool[];
}

export interface ApiResult {
  code?: number;
  message?: string;
  msg?: string;
  data?: Ledger;
}

// ============ 查询状态（URL 可分享） ============

export type EnvName = 'localhost' | 'escrow';
export type Perspective = 'customer' | 'service';

export interface QueryState {
  projectOrderId: string;
  env: EnvName;
  verify: boolean;
  grouped: boolean;
  perspective: Perspective;
}

export function readUrlState(): QueryState {
  const params = new URLSearchParams(window.location.search);
  return {
    projectOrderId: params.get('projectOrderId') ?? '',
    env: params.get('env') === 'escrow' ? 'escrow' : 'localhost',
    verify: params.get('verify') !== 'false',
    grouped: params.get('mode') !== 'flat',
    perspective: params.get('perspective') === 'customer' ? 'customer' : 'service',
  };
}

export function writeUrlState(state: QueryState): void {
  const params = new URLSearchParams();
  if (state.projectOrderId) params.set('projectOrderId', state.projectOrderId);
  if (state.env !== 'localhost') params.set('env', state.env);
  if (!state.verify) params.set('verify', 'false');
  if (!state.grouped) params.set('mode', 'flat');
  if (state.perspective !== 'service') params.set('perspective', 'customer');
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}

// ============ 请求 ============

export async function fetchLedger(state: QueryState): Promise<Ledger> {
  const base = state.env === 'escrow' ? '/api-escrow' : '/api-local';
  const url = `${base}/ledger/project?projectOrderId=${encodeURIComponent(state.projectOrderId)}`
    + `&verify=${state.verify}&groupByPool=true`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-NRS-User-Id': '1000000000000000' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = (await response.json()) as ApiResult | Ledger;
  const wrapper = result as ApiResult;
  if (wrapper.code !== undefined && ![0, 200, 2000].includes(wrapper.code)) {
    throw new Error(wrapper.message || wrapper.msg || `接口错误 code=${wrapper.code}`);
  }
  const data = wrapper.data ?? (result as Ledger);
  if (!data || (!data.pools?.length && !data.entries?.length)) {
    throw new Error('账本为空：该主单号下没有资金池或流水');
  }
  return data;
}

// ============ 归一化工具 ============

/** 全部明细（无论接口按池返回还是平铺返回，统一拍平并按时间排序） */
export function allEntries(ledger: Ledger): LedgerEntry[] {
  const source = ledger.entries ?? (ledger.pools ?? []).flatMap((p) => p.entries ?? []);
  return source
    .slice()
    .sort((a, b) => String(a.finishTime ?? '').localeCompare(String(b.finishTime ?? '')));
}

/** 按 transferGroupId 分组（含未配对桶） */
export function groupEntries(entries: LedgerEntry[]): Array<{ groupId: string | null; entries: LedgerEntry[] }> {
  const map = new Map<string, LedgerEntry[]>();
  const ungrouped: LedgerEntry[] = [];
  for (const entry of entries) {
    if (entry.transferGroupId) {
      const list = map.get(entry.transferGroupId) ?? [];
      list.push(entry);
      map.set(entry.transferGroupId, list);
    } else {
      ungrouped.push(entry);
    }
  }
  return [
    ...[...map.entries()]
      .map(([groupId, list]) => ({ groupId, entries: list }))
      .sort((a, b) => String(maxFinishTime(b.entries)).localeCompare(String(maxFinishTime(a.entries)))),
    ...(ungrouped.length ? [{ groupId: null, entries: ungrouped }] : []),
  ];
}

function maxFinishTime(entries: LedgerEntry[]): string | number | null {
  return entries.reduce<string | number | null>(
    (acc, e) => (String(e.finishTime ?? '').localeCompare(String(acc ?? '')) > 0 ? (e.finishTime ?? null) : acc),
    null,
  );
}

/** 池 id → 池信息（展示时反查类型/名称） */
export function poolIndex(pools: FundPool[]): Map<string, FundPool> {
  return new Map(pools.map((p) => [p.poolId ?? '', p]));
}

// ============ 展示格式化工具 ============

export function number(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function amount(value: unknown): string {
  return number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function text(value: unknown): string {
  return value == null ? '' : String(value);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] ?? c
  ));
}

export function balanceClass(value: unknown): string {
  const n = number(value);
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'zero';
}

/** 兼容 "2026-08-06 17:00:35" 与时间戳 */
export function parseTime(value: string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtTime(value: string | number | null | undefined): string {
  const d = parseTime(value);
  return d ? `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '—';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(1)}亿`;
  if (abs >= 1_0000) return `${(value / 1_0000).toFixed(1)}万`;
  return String(value);
}

export function shortPoolId(poolId: string): string {
  return poolId.length > 16 ? `${poolId.slice(0, 6)}…${poolId.slice(-7)}` : poolId;
}

export const POOL_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: '客户钱包',
  ADVANCE: '预收款/首期款池',
  WALLET: '客户余额池',
  SUB_ORDER: '商品子单池',
  FUND: '整装款项池',
  DEVELOPER: '开发商池',
  OTHER: '其他资金池',
};

export const POOL_TYPE_ICONS: Record<string, string> = {
  CUSTOMER: '👤', ADVANCE: '🏦', WALLET: '💰', SUB_ORDER: '📦', FUND: '🏠', DEVELOPER: '🏢', OTHER: '📋',
};

export const CASHIER_TYPES: Record<number, string> = {
  1: 'APP', 2: '微信', 5: '小程序', 9: '收银台', 13: '微信收银台', 15: '网银转账',
  101: 'POS', 111: '装修分期', 112: '对公汇款', 113: '现金', 114: '线下凭证',
  115: '预收款抵扣', 116: '退款抵扣', 124: '线上支付', 125: '款项抵扣',
  126: '余额抵扣', 202: '支付宝', 306: '小程序支付',
};
