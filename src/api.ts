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

export type EnvName = 'localhost' | 'escrow' | 'preview';

/** 主视图。侧边栏切换的就是这个，不再是页内锚点。服务者和客户看同一套。 */
export type ViewKey = 'overview' | 'map' | 'stream' | 'pools' | 'orders' | 'verify';

export const VIEWS: ViewKey[] = ['overview', 'map', 'stream', 'pools', 'orders', 'verify'];

export interface QueryState {
  projectOrderId: string;
  env: EnvName;
  verify: boolean;
  view: ViewKey;
}

function readView(raw: string | null): ViewKey {
  return VIEWS.includes(raw as ViewKey) ? (raw as ViewKey) : 'overview';
}

export function readUrlState(): QueryState {
  const params = new URLSearchParams(window.location.search);
  const env = params.get('env');
  return {
    projectOrderId: params.get('projectOrderId') ?? '',
    env: env === 'escrow' ? 'escrow' : env === 'preview' ? 'preview' : 'localhost',
    verify: params.get('verify') !== 'false',
    view: readView(params.get('view')),
  };
}

export function writeUrlState(state: QueryState): void {
  const params = new URLSearchParams();
  if (state.projectOrderId) params.set('projectOrderId', state.projectOrderId);
  if (state.env !== 'localhost') params.set('env', state.env);
  if (!state.verify) params.set('verify', 'false');
  if (state.view !== 'overview') params.set('view', state.view);
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

// ============ 请求 ============

/**
 * 拉取账本。固定 groupByPool=true —— 池维度的 subFunds、balanceVerify、
 * compositOrderNo 是页面的主要素材，平铺明细可以从池里取到，反之不行。
 */
export async function fetchLedger(state: QueryState): Promise<Ledger> {
  const base = state.env === 'preview' ? '/api-preview'
    : state.env === 'escrow' ? '/api-escrow' : '/api-local';
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

/** "2026-08-04"，时间轴按天分组用。 */
export function fmtDay(value: string | number | null | undefined): string {
  const d = parseTime(value);
  return d ? `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '—';
}

/** "13:49"，时间轴行首用。 */
export function fmtClock(value: string | number | null | undefined): string {
  const d = parseTime(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
}
