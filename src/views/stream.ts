/**
 * 资金流水 —— 主视图。
 *
 * 一行 = 一次资金操作（一个 transferGroupId），不是一条账本条目。
 * 所以「6/26 一笔 52,302.59 分摊到 3 个去处」显示成一行、展开看分摊，
 * 而不是三行让人误读成付了三笔。
 *
 * 行上的金额取交易组口径（组内入金合计 = 出金合计，后端契约保证），
 * 来源/去向直接列出出金腿与入金腿所属的池，不做任何一对一的连边推测。
 */

import { amount, escapeHtml, fmtClock, fmtDay, type LedgerEntry } from '../api';
import type { ViewContext } from '../context';
import { ACTION_TYPES, ENTRY_STATUS, PAIRING_REASONS } from '../codes';
import { legDisplay, type TxnGroup } from '../groups';

type FilterKey = 'ALL' | 'PAY' | 'DEDUCT' | 'REFUND' | 'OTHER';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'PAY', label: '客户支付' },
  { key: 'DEDUCT', label: '抵扣' },
  { key: 'REFUND', label: '退款' },
  { key: 'OTHER', label: '其他/未配对' },
];

/** 视图内状态：当前筛选 + 展开的组，切视图后保留。 */
const state = { filter: 'ALL' as FilterKey, expanded: new Set<string>() };

function matches(group: TxnGroup, filter: FilterKey): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'OTHER') return group.info.kind === 'EXTERNAL' || group.info.kind === 'FALLBACK';
  return group.info.kind === filter;
}

/**
 * 一侧的腿归纳成一句话：单个池给名字，多个池给个数。
 *
 * 一侧为空要分清两种情况：单边操作（枚举里 singleSided=true，如余额充值/提现，
 * 本来就没有本地对端池）与配对缺腿（本该有对端却没有，属于资金池归属断链）。
 * 后者直接写破折号会被读成「没去向」，得说明是账本缺记录。
 */
function sideSummary(legs: LedgerEntry[], ctx: ViewContext, noun: string, group: TxnGroup): string {
  if (!legs.length) {
    return group.info.singleSided
      ? `<span class="zero">系统外</span>`
      : `<span class="tag tag-hold">${noun}未入账</span>`;
  }
  const ids = [...new Set(legs.map((leg) => leg.accountId ?? ''))];
  if (ids.length === 1) {
    const disp = legDisplay(legs[0], ctx.index);
    return `${disp.icon} ${escapeHtml(disp.name)}`
      + (disp.shortId ? `<span class="leg-id" title="${escapeHtml(disp.fullId)}">${escapeHtml(disp.shortId)}</span>` : '');
  }
  return `${ids.length} 个${noun}`;
}

/** 业务单号：客户和服务者都看得到，这是「因为发生了什么」的锚点。 */
function refs(group: TxnGroup, ctx: ViewContext): string {
  const merged: Record<string, unknown> = {};
  group.legs.forEach((leg) => Object.entries(leg.metadata ?? {}).forEach(([k, v]) => {
    if (v !== null && v !== '' && merged[k] === undefined) merged[k] = v;
  }));
  const items: string[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: unknown): void => {
    const raw = String(value ?? '');
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    items.push(label ? `${label} ${raw}` : raw);
  };
  push('售后单', merged.afterSaleNo ?? merged.afterSalesNo);
  push('变更单', merged.projectChangeNo);
  push('', merged.compositOrderNo);
  push('来源', merged.refundFromOrderNo);
  push('流水', merged.transactionNo);
  if (group.pairingReason) items.push(`未配对：${PAIRING_REASONS[group.pairingReason] ?? group.pairingReason}`);
  else if (!group.info.singleSided && (!group.outLegs.length || !group.inLegs.length)) {
    items.push('该操作在账本里只有一侧记录，对端资金池归属断链');
  }
  if (!items.length) return '';
  return `<div class="txn-refs">${items.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`;
}

function legLine(entry: LedgerEntry, ctx: ViewContext): string {
  const disp = legDisplay(entry, ctx.index);
  const inflow = entry.direction === 'INFLOW';
  const desc = entry.fundActionDesc || ACTION_TYPES[entry.fundActionType ?? ''] || '';
  const status = entry.status && entry.status !== 'SUCCESS'
    ? ` <span class="tag tag-hold">${escapeHtml(ENTRY_STATUS[entry.status] ?? entry.status)}</span>` : '';
  return `
    <div class="leg">
      <span>${disp.icon}</span>
      <span>
        <span class="leg-pool">${escapeHtml(disp.name)}</span>
        ${disp.shortId ? `<span class="leg-id" title="${escapeHtml(disp.fullId)}">${escapeHtml(disp.shortId)}</span>` : ''}
        <span class="leg-desc"> ${escapeHtml(desc)}</span>${status}
      </span>
      <span class="leg-amount ${inflow ? 'amount-in' : 'amount-out'}">${inflow ? '+' : '−'}${amount(entry.amount)}</span>
    </div>`;
}

function txnHtml(group: TxnGroup, ctx: ViewContext): string {
  const open = state.expanded.has(group.groupId);
  const legs = open ? `
    <div class="txn-legs">
      ${group.outLegs.length ? `<div class="leg-split">出金 ${group.outLegs.length} 笔</div>${group.outLegs.map((l) => legLine(l, ctx)).join('')}` : ''}
      ${group.inLegs.length ? `<div class="leg-split">入金 ${group.inLegs.length} 笔</div>${group.inLegs.map((l) => legLine(l, ctx)).join('')}` : ''}
      <div class="leg-split"><a data-drawer="${escapeHtml(group.groupId)}" style="color:var(--accent);cursor:pointer">查看完整证据链与业务动作 →</a></div>
    </div>` : '';

  return `
    <div class="txn${open ? ' open' : ''}">
      <div class="txn-row" data-toggle="${escapeHtml(group.groupId)}">
        <span class="txn-time">${escapeHtml(fmtClock(group.startTime))}</span>
        <span class="txn-icon ${group.info.kind}">${group.info.icon}</span>
        <span class="txn-main">
          <span class="txn-action">${escapeHtml(group.info.label)}</span>
          <span class="txn-path">${sideSummary(group.outLegs, ctx, '来源', group)}<span class="arrow">→</span>${sideSummary(group.inLegs, ctx, '去向', group)}</span>
          ${refs(group, ctx)}
        </span>
        <span class="txn-amount">${amount(group.amount)}</span>
        <span class="txn-caret">${open ? '▲' : '▼'}</span>
      </div>
      ${legs}
    </div>`;
}

export function renderStream(target: HTMLElement, ctx: ViewContext, focus?: string): void {
  if (focus && FILTERS.some((f) => f.key === focus)) state.filter = focus as FilterKey;
  if (focus && ctx.groupById.has(focus)) state.expanded.add(focus);

  const visible = ctx.groups.filter((g) => matches(g, state.filter));

  // 按天倒序分组；天内保持交易组的时间倒序
  const days: Array<{ day: string; list: TxnGroup[] }> = [];
  visible.forEach((group) => {
    const day = fmtDay(group.startTime);
    const last = days[days.length - 1];
    if (last && last.day === day) last.list.push(group);
    else days.push({ day, list: [group] });
  });

  const chips = FILTERS.map((f) => {
    const count = f.key === 'ALL' ? ctx.groups.length : ctx.groups.filter((g) => matches(g, f.key)).length;
    if (!count && f.key !== 'ALL') return '';
    return `<button class="chip${state.filter === f.key ? ' on' : ''}" data-filter="${f.key}">${escapeHtml(f.label)} ${count}</button>`;
  }).join('');

  const body = days.map(({ day, list }) => {
    const sum = list.reduce((s, g) => s + Math.round(g.amount * 100), 0) / 100;
    return `
      <div class="day">
        <div class="day-label"><b>${escapeHtml(day)}</b> · ${list.length} 次操作 · 合计 ${amount(sum)} 元</div>
        ${list.map((g) => txnHtml(g, ctx)).join('')}
      </div>`;
  }).join('');

  target.innerHTML = `
    <div class="view-head">
      <h2>资金流水</h2>
      <p>一行是一次资金操作，不是一条账本条目 —— 一笔钱同时分摊到多个去处时合并显示，展开可以看到每个去处分了多少。</p>
    </div>
    <div class="stream-filter">${chips}</div>
    <div class="card">
      <div class="card-body tight">
        ${body || '<div class="empty">当前筛选下没有资金操作</div>'}
      </div>
    </div>`;

  target.querySelectorAll<HTMLElement>('[data-filter]').forEach((node) => {
    node.addEventListener('click', () => {
      state.filter = node.dataset.filter as FilterKey;
      renderStream(target, ctx);
    });
  });
  target.querySelectorAll<HTMLElement>('[data-toggle]').forEach((node) => {
    node.addEventListener('click', () => {
      const id = node.dataset.toggle as string;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      renderStream(target, ctx);
    });
  });
  target.querySelectorAll<HTMLElement>('[data-drawer]').forEach((node) => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.openGroup(node.dataset.drawer as string);
    });
  });

  if (focus && ctx.groupById.has(focus)) {
    target.querySelector(`[data-toggle="${focus}"]`)?.scrollIntoView({ block: 'center' });
  }
}
