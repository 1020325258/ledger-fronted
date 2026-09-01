/**
 * 溯源抽屉 —— 点任意一笔资金操作，滑出它的完整证据链。
 *
 * 展示的每一项都是接口原样返回的事实：
 *   业务动作键（售后单号/变更单号/交易号）来自 PoolEntry.metadata；
 *   出入金腿来自同一个 transferGroupId 的条目；
 *   源表与记录 ID 来自 sourceTable / sourceRecordId。
 * 抽屉聚焦业务单据、商品变化和当前交易组的出入金节点，不展示推测性的后续去向。
 */

import { amount, escapeHtml, fmtTime, metadataValue, type ChangedSkuItem, type FundPool, type LedgerEntry, type PaidSkuItem } from './api';
import { legDisplay, type TxnGroup } from './groups';

export interface DrawerContext {
  index: Map<string, FundPool>;
  /** 全部交易组，用于列出同一资金池的后续出金操作 */
  groups: TxnGroup[];
  /** 抽屉内跳转到另一笔操作 */
  onOpen: (groupId: string) => void;
  /** 从资金池类型明细继续查看具体资金池。 */
  onOpenPool?: (poolId: string) => void;
}

export interface DrawerFocus {
  direction: 'OUTFLOW' | 'INFLOW';
  accountType: string;
}

let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
  }
  return host;
}

export function closeDrawer(): void {
  if (host) host.innerHTML = '';
}

function actionLabel(entry: LedgerEntry): string {
  return entry.fundActionDesc || '业务动作待后端补充';
}

function legBlock(entry: LedgerEntry, ctx: DrawerContext): string {
  const pool = legDisplay(entry, ctx.index);
  const inflow = entry.direction === 'INFLOW';
  const status = entry.status && entry.status !== 'SUCCESS'
    ? `<span class="tag tag-hold">${escapeHtml(entry.statusDesc || entry.status)}</span>` : '';
  const src = entry.sourceTable
    ? `<div class="dleg-src">${escapeHtml(entry.sourceTable)}`
      + `#${escapeHtml(entry.sourceRecordId ?? '—')}</div>`
    : '';
  return `
    <div class="dleg">
      <div class="dleg-top">
        <span>${pool.icon}</span>
        <span class="dleg-name">${escapeHtml(pool.name)}</span>
        ${pool.shortId ? `<span class="leg-id" title="${escapeHtml(pool.fullId)}">${escapeHtml(pool.shortId)}</span>` : ''}
        ${status}
        <span class="dleg-amount ${inflow ? 'amount-in' : 'amount-out'}">${inflow ? '+' : '−'}${amount(entry.amount)}</span>
      </div>
      <div class="dleg-desc">${escapeHtml(actionLabel(entry))} · ${escapeHtml(fmtTime(entry.finishTime))}</div>
      ${pool.note ? `<div class="dleg-desc">${escapeHtml(pool.note)}</div>` : ''}
      ${src}
    </div>`;
}

/** 业务动作字段：严格按后端 metadata 数组的顺序和文案展示。 */
function fieldsBlock(legs: LedgerEntry[]): string {
  const seen = new Set<string>();
  const rows = legs.flatMap((leg) => leg.metadata ?? []).flatMap((item) => {
    if (!item.key || item.key === 'paidSkuItems' || item.key === 'changedSkuItems'
      || item.value == null || item.value === '') return [];
    const signature = `${item.key}:${JSON.stringify(item.value)}`;
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [`<dt>${escapeHtml(item.label || item.key)}</dt><dd>${escapeHtml(String(item.value))}</dd>`];
  });

  if (!rows.length) return '';
  return `<div class="dsec"><h4>业务动作</h4><dl class="dfields">${rows.join('')}</dl></div>`;
}

function displayNumber(value: unknown): string {
  return value == null || value === '' ? '—' : String(value);
}

function signedNumber(value: number | undefined): string {
  if (value == null) return '—';
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

function signedAmount(value: number | undefined): string {
  if (value == null) return '—';
  if (value > 0) return `+${amount(value)}`;
  if (value < 0) return `−${amount(Math.abs(value))}`;
  return amount(0);
}

function paidSkuCard(item: PaidSkuItem): string {
  const fund = item.fundTypeDesc || item.subFundTypeDesc;
  return `<div class="dsku">
    <div class="dsku-title"><strong>${escapeHtml(item.skuName || '未提供商品名称')}</strong><span>${amount(item.apportionedAmount)}</span></div>
    <div class="dsku-meta">SKU ${escapeHtml(item.skuId == null ? '—' : String(item.skuId))} · 唯一键 ${escapeHtml(item.skuUniqueKey || '—')}${item.paymentOrderNo ? ` · 支付单 ${escapeHtml(item.paymentOrderNo)}` : ''}</div>
    <div class="dsku-values"><span>数量 <b>${escapeHtml(displayNumber(item.quantity))}</b></span><span>用量 <b>${escapeHtml(displayNumber(item.consumption))}</b></span>${fund ? `<span>款项 <b>${escapeHtml(fund)}</b></span>` : ''}</div>
  </div>`;
}

function changedSkuCard(item: ChangedSkuItem): string {
  return `<div class="dsku changed">
    <div class="dsku-title"><strong>${escapeHtml(item.skuName || '未提供商品名称')}</strong></div>
    <div class="dsku-meta">SKU ${escapeHtml(item.skuId == null ? '—' : String(item.skuId))} · 唯一键 ${escapeHtml(item.skuUniqueKey || '—')}${item.categoryName ? ` · ${escapeHtml(item.categoryName)}` : ''}</div>
    <div class="dsku-change-table" aria-label="商品数量和用量变更">
      <span class="dsku-change-head">指标</span><span class="dsku-change-head">变更前</span><span class="dsku-change-head">本次变更</span><span class="dsku-change-head">变更后</span>
      <strong>数量</strong><span>${escapeHtml(displayNumber(item.originQuantity))}</span><span class="dsku-delta">${escapeHtml(signedNumber(item.changedQuantity))}</span><span>${escapeHtml(displayNumber(item.afterQuantity))}</span>
      <strong>用量</strong><span>${escapeHtml(displayNumber(item.originConsumption))}</span><span class="dsku-delta">${escapeHtml(signedNumber(item.changedConsumption))}</span><span>${escapeHtml(displayNumber(item.afterConsumption))}</span>
    </div>
    ${(item.changedPaidAmount != null || item.actualRefundAmount != null) ? `<div class="dsku-money-change">
      ${item.changedPaidAmount != null ? `<span><small>已付金额变化</small><b class="${item.changedPaidAmount < 0 ? 'negative' : 'positive'}">${escapeHtml(signedAmount(item.changedPaidAmount))} 元</b></span>` : ''}
      ${item.actualRefundAmount != null ? `<span><small>实际退款</small><b>${amount(item.actualRefundAmount)} 元</b></span>` : ''}
    </div>` : ''}
  </div>`;
}

function skuItemsBlock(legs: LedgerEntry[]): string {
  const paidGroups = legs.flatMap((leg) => {
    const value = metadataValue(leg, 'paidSkuItems');
    if (!Array.isArray(value) || !value.length) return [];
    const subOrderNo = String(metadataValue(leg, 'subOrderNo') ?? leg.accountId ?? '未知 S 单');
    return [{ subOrderNo, amount: leg.amount, items: value as PaidSkuItem[] }];
  });
  const changedGroups = legs.flatMap((leg) => {
    const value = metadataValue(leg, 'changedSkuItems');
    if (!Array.isArray(value) || !value.length) return [];
    const subOrderNo = String(metadataValue(leg, 'subOrderNo') ?? leg.accountId ?? '未知 S 单');
    return [{ subOrderNo, amount: leg.amount, items: value as ChangedSkuItem[] }];
  });
  const paidCount = paidGroups.reduce((sum, group) => sum + group.items.length, 0);
  const changedCount = changedGroups.reduce((sum, group) => sum + group.items.length, 0);
  const paid = paidGroups.map((group) => `<details class="dsku-group"><summary class="dsku-group-title"><strong>${escapeHtml(group.subOrderNo)}</strong><span>${amount(group.amount)} 元 · ${group.items.length} 个商品</span></summary><div class="dsku-group-items">${group.items.map(paidSkuCard).join('')}</div></details>`).join('');
  const changed = changedGroups.map((group) => `<details class="dsku-group"><summary class="dsku-group-title"><strong>${escapeHtml(group.subOrderNo)}</strong><span>${amount(group.amount)} 元 · ${group.items.length} 个变更商品</span></summary><div class="dsku-group-items">${group.items.map(changedSkuCard).join('')}</div></details>`).join('');
  if (!paid && !changed) return '';
  return `${paid ? `<div class="dsec"><h4>支付涉及 ${paidGroups.length} 个商品子单 · ${paidCount} 个 SKU</h4>${paid}</div>` : ''}
    ${changed ? `<div class="dsec"><h4>减项涉及 ${changedGroups.length} 个商品子单 · ${changedCount} 个 SKU</h4>${changed}</div>` : ''}`;
}

function hasSkuItems(legs: LedgerEntry[]): boolean {
  return legs.some((leg) => {
    const paid = metadataValue(leg, 'paidSkuItems');
    const changed = metadataValue(leg, 'changedSkuItems');
    return Array.isArray(paid) && paid.length > 0 || Array.isArray(changed) && changed.length > 0;
  });
}

export function openPoolDrawer(poolId: string, ctx: DrawerContext): void {
  const pool = ctx.index.get(poolId);
  if (!pool) return;
  const display = legDisplay({ accountId: poolId, accountType: pool.poolType }, ctx.index);
  const related = ctx.groups
    .filter((group) => group.legs.some((leg) => leg.accountId === poolId))
    .sort((a, b) => b.startTime.localeCompare(a.startTime));
  const operations = related.map((group) => {
    const legs = group.legs.filter((leg) => leg.accountId === poolId);
    const incoming = legs.filter((leg) => leg.direction === 'INFLOW').reduce((sum, leg) => sum + Number(leg.amount ?? 0), 0);
    const outgoing = legs.filter((leg) => leg.direction === 'OUTFLOW').reduce((sum, leg) => sum + Number(leg.amount ?? 0), 0);
    const money = incoming > 0 ? `+${amount(incoming)}` : `−${amount(outgoing)}`;
    const action = [...new Set(legs.map(actionLabel))].join(' / ');
    return `<button type="button" class="pool-operation" data-pool-operation="${escapeHtml(group.groupId)}">
      <span class="pool-operation-time">${escapeHtml(fmtTime(group.startTime))}</span>
      <span><b>${escapeHtml(group.info.label)}</b><small>${escapeHtml(action)}</small></span>
      <strong class="${incoming > 0 ? 'amount-in' : 'amount-out'}">${money}</strong><i>→</i>
    </button>`;
  }).join('');
  const el = ensureHost();
  el.innerHTML = `<div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-label="资金池相关操作">
      <div class="drawer-head"><div class="dh-top"><span class="txn-icon move">${display.icon}</span><h3>${escapeHtml(display.name)}</h3><button class="drawer-close" data-close="1" aria-label="关闭">×</button></div>
        <div class="drawer-amount">${amount(pool.balance)} <small style="font-size:13px;font-weight:400">元</small></div>
        <div class="drawer-time">${escapeHtml(poolId)} · ${related.length} 次相关资金操作</div>
      </div>
      <div class="drawer-body"><div class="dsec"><h4>相关资金操作</h4><div class="pool-operation-list">${operations || '<div class="empty">暂无相关操作</div>'}</div></div></div>
    </aside>`;
  el.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', closeDrawer));
  el.querySelectorAll<HTMLElement>('[data-pool-operation]').forEach((node) => {
    node.addEventListener('click', () => ctx.onOpen(node.dataset.poolOperation as string));
  });
}

/** 展示某个横坐标资金池类型下的全部资金池，再下钻到单池资金操作。 */
export function openPoolTypeDrawer(poolType: string, ctx: DrawerContext): void {
  const pools = [...ctx.index.values()]
    .filter((pool) => pool.poolType === poolType)
    .sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
  if (!pools.length) return;
  const display = legDisplay({ accountType: poolType }, ctx.index);
  const total = pools.reduce((sum, pool) => sum + Number(pool.balance ?? 0), 0);
  const rows = pools.map((pool) => {
    const poolId = pool.poolId ?? '';
    const relatedCount = ctx.groups.filter((group) => group.legs.some((leg) => leg.accountId === poolId)).length;
    const name = pool.fundName || legDisplay({ accountId: poolId, accountType: poolType }, ctx.index).name;
    return `<button type="button" class="pool-operation" data-pool-detail="${escapeHtml(poolId)}">
      <span class="pool-operation-time">${escapeHtml(poolId)}</span>
      <span><b>${escapeHtml(name)}</b><small>${relatedCount} 次相关资金操作</small></span>
      <strong>${amount(pool.balance)} 元</strong><i>→</i>
    </button>`;
  }).join('');
  const el = ensureHost();
  el.innerHTML = `<div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-label="${escapeHtml(display.name)}资金池明细">
      <div class="drawer-head"><div class="dh-top"><span class="txn-icon move">${display.icon}</span><h3>${escapeHtml(display.name)}明细</h3><button class="drawer-close" data-close="1" aria-label="关闭">×</button></div>
        <div class="drawer-amount">${amount(total)} <small style="font-size:13px;font-weight:400">元</small></div>
        <div class="drawer-time">${pools.length} 个资金池</div>
      </div>
      <div class="drawer-body"><div class="dsec"><h4>全部资金池</h4><div class="pool-operation-list">${rows}</div></div></div>
    </aside>`;
  el.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', closeDrawer));
  el.querySelectorAll<HTMLElement>('[data-pool-detail]').forEach((node) => {
    node.addEventListener('click', () => ctx.onOpenPool?.(node.dataset.poolDetail as string));
  });
}

export function openGroupDrawer(group: TxnGroup, ctx: DrawerContext, focus?: DrawerFocus): void {
  const kind = group.info.kind;
  const visibleLegs = focus
    ? group.legs.filter((leg) => leg.direction === focus.direction
      && (leg.accountType || ctx.index.get(leg.accountId ?? '')?.poolType || 'OTHER') === focus.accountType)
    : group.legs;
  const visibleOutLegs = visibleLegs.filter((leg) => leg.direction === 'OUTFLOW');
  const visibleInLegs = visibleLegs.filter((leg) => leg.direction === 'INFLOW');
  const visibleAmount = visibleLegs.reduce((sum, leg) => sum + Math.round((leg.amount ?? 0) * 100), 0) / 100;
  const focusedPoolCount = new Set(visibleLegs.map((leg) => leg.accountId).filter(Boolean)).size;
  const firstPoolLabel = focus ? legDisplay(visibleLegs[0] ?? { accountType: focus.accountType }, ctx.index).name : '';
  const focusLabel = focus && focusedPoolCount > 1 ? `${firstPoolLabel}等 ${focusedPoolCount} 个资金池` : firstPoolLabel;
  const skuFocused = Boolean(focus && focus.accountType === 'SUB_ORDER' && hasSkuItems(visibleLegs));
  const el = ensureHost();
  el.innerHTML = `
    <div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-label="资金操作溯源">
      <div class="drawer-head">
        <div class="dh-top">
          <span class="txn-icon ${kind}">${group.info.icon}</span>
          <h3>${escapeHtml(focus ? focusLabel : group.info.label)}</h3>
          <button class="drawer-close" data-close="1" aria-label="关闭">×</button>
        </div>
        <div class="drawer-amount">${amount(focus ? visibleAmount : group.amount)} <small style="font-size:13px;font-weight:400">元</small></div>
        <div class="drawer-time">${escapeHtml(fmtTime(group.startTime))}${
          group.endTime !== group.startTime ? ` → ${escapeHtml(fmtTime(group.endTime).slice(11))}` : ''
        }${group.hasExecuting ? ' · 含未到账明细' : ''}${focus ? ` · ${escapeHtml(group.info.label)}中的${escapeHtml(focus.direction === 'OUTFLOW' ? '资金来源' : '资金去向')}` : ''}</div>
      </div>
      <div class="drawer-body">
        ${focus ? `<button class="drawer-show-all" data-show-all="1">查看整笔交易</button>` : ''}
        ${fieldsBlock(visibleLegs)}
        ${skuItemsBlock(visibleLegs)}
        ${!skuFocused && visibleOutLegs.length ? `<div class="dsec"><h4>当前节点出金 ${visibleOutLegs.length} 笔</h4>${visibleOutLegs.map((l) => legBlock(l, ctx)).join('')}</div>` : ''}
        ${!skuFocused && visibleInLegs.length ? `<div class="dsec"><h4>当前节点入金 ${visibleInLegs.length} 笔</h4>${visibleInLegs.map((l) => legBlock(l, ctx)).join('')}</div>` : ''}
      </div>
    </aside>`;

  el.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', closeDrawer));
  el.querySelector('[data-show-all]')?.addEventListener('click', () => openGroupDrawer(group, ctx));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});
