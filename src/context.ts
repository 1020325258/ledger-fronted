/**
 * 视图上下文：一次查询的结果 + 各视图共用的跳转能力。
 *
 * 所有派生数据只在这里算一次（分组、索引），视图侧直接消费，
 * 不在渲染函数里重复遍历明细。
 */

import type { FundPool, Ledger, LedgerEntry, ViewKey } from './api';
import type { TxnGroup } from './groups';

export interface ViewContext {
  data: Ledger;
  pools: FundPool[];
  entries: LedgerEntry[];
  groups: TxnGroup[];
  /** groupId → 交易组 */
  groupById: Map<string, TxnGroup>;
  /** entryId → 所属交易组，池账本里反查对手方用 */
  groupByEntryId: Map<string, TxnGroup>;
  /** poolId → 池 */
  index: Map<string, FundPool>;
  /** 打开某笔操作的溯源抽屉 */
  openGroup: (groupId: string, focus?: { direction: 'OUTFLOW' | 'INFLOW'; accountType: string }) => void;
  /** 打开某个资金池关联的全部资金操作。 */
  openPool: (poolId: string) => void;
  /** 打开某类资金池的全部池明细。 */
  openPoolType: (poolType: string) => void;
  /** 切到某个视图，focus 为视图内要展开/定位的对象 id */
  goView: (view: ViewKey, focus?: string) => void;
}

/** 池类型的展示顺序：先客户直接感知的，再系统内承接的。 */
export const POOL_TYPE_ORDER = ['FUND', 'SUB_ORDER', 'ADVANCE', 'WALLET', 'CUSTOMER', 'DEVELOPER'];

/**
 * 池类型配色。每种类型三个值：
 *   main —— 大面积填充、线条主色；
 *   soft —— 分组底纹、标签底色（不能配白字）；
 *   deep —— 描边、折线、小色标、浅底上的文字。
 *
 * 整套色板都从满饱和度往下压了一档：三张图共用一套色，
 * 满饱和的紫 + 绿 + 橙同屏会互相抢，压过一档后色相区分仍然够、但不刺眼。
 */
export interface PoolPalette { main: string; soft: string; deep: string }

export const POOL_PALETTE: Record<string, PoolPalette> = {
  FUND: { main: '#7457e8', soft: '#f0edff', deep: '#5338bb' },
  SUB_ORDER: { main: '#3975e8', soft: '#eaf2ff', deep: '#2456b8' },
  ADVANCE: { main: '#1596b5', soft: '#e6f8fc', deep: '#08718c' },
  WALLET: { main: '#16a17a', soft: '#e8f8f2', deep: '#087458' },
  CUSTOMER: { main: '#d25f82', soft: '#fcecf2', deep: '#a53a5e' },
  DEVELOPER: { main: '#718096', soft: '#eef2f7', deep: '#435269' },
  OTHER: { main: '#92a0b5', soft: '#f1f4f8', deep: '#627086' },
};

export function poolPalette(poolType: string | undefined): PoolPalette {
  return POOL_PALETTE[poolType ?? 'OTHER'] ?? POOL_PALETTE.OTHER;
}

/** 主色：大面积填充与线条用。 */
export function poolColor(poolType: string | undefined): string {
  return poolPalette(poolType).main;
}

/** 描边色：轮廓、折线、浅底上的文字用。 */
export function poolInk(poolType: string | undefined): string {
  return poolPalette(poolType).deep;
}

/** 浅色：分组底纹用，不能配白字。 */
export function poolSoft(poolType: string | undefined): string {
  return poolPalette(poolType).soft;
}
