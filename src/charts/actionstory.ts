/** 客户资金操作时间列表：一行 = 一个 transferGroupId。 */

import { amount, escapeHtml, fmtClock, fmtDay, number } from '../api';
import type { ViewContext } from '../context';
import { legDisplay, type TxnGroup } from '../groups';

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }

function descriptions(group: TxnGroup): string[] {
  return unique(group.legs.map((leg) => String(leg.fundActionDesc ?? '').trim()))
    .filter((desc) => desc !== 'null' && desc !== 'undefined');
}

/** 只展示可核实的业务原因或依据，不根据金额、池名猜测。 */
function reason(group: TxnGroup): { text: string; fallback: boolean } {
  const reasons = unique(group.legs.flatMap((leg) => leg.metadata ?? []).flatMap((item) =>
    item.value != null && item.value !== '' && !Array.isArray(item.value)
      ? [`${item.label || ''} ${String(item.value)}`.trim()] : []));
  if (reasons.length) return { text: unique(reasons).join(' · '), fallback: false };

  const sources = unique(group.legs.map((leg) => String(leg.sourceTable ?? '')).filter(Boolean));
  if (sources.length) return { text: `接口未提供独立原因；业务依据来自${sources.join('、')}`, fallback: true };
  return { text: '接口未提供发生原因或业务依据', fallback: true };
}

function sideNames(group: TxnGroup, ctx: ViewContext, direction: 'out' | 'in'): string[] {
  const legs = direction === 'out' ? group.outLegs : group.inLegs;
  if (!legs.length) return ['系统外'];
  return unique(legs.map((leg) => legDisplay(leg, ctx.index).name));
}

function internalDelta(group: TxnGroup, ctx: ViewContext): number {
  return group.legs.reduce((sum, leg) => {
    const pool = ctx.index.get(leg.accountId ?? '');
    if (!pool || pool.poolScope === 'EXTERNAL') return sum;
    const cents = Math.round(number(leg.amount) * 100);
    return sum + (leg.direction === 'INFLOW' ? cents : -cents);
  }, 0) / 100;
}

function effect(delta: number): { label: string; css: string; sign: string } {
  if (delta > .005) return { label: '进入内部池', css: 'in', sign: '+' };
  if (delta < -.005) return { label: '离开内部池', css: 'out', sign: '−' };
  return { label: '内部池间移动', css: 'move', sign: '' };
}

export function renderActionStory(ctx: ViewContext): string {
  const groups = ctx.groups.slice().reverse();
  if (!groups.length) return '';

  let balance = 0;
  const balanceAfter = new Map<string, number>();
  groups.forEach((group) => {
    balance += internalDelta(group, ctx);
    balanceAfter.set(group.groupId, balance);
  });

  const latest = groups.slice().reverse();
  let lastDay = '';
  const rows = latest.map((group) => {
    const day = fmtDay(group.startTime);
    const showDay = day !== lastDay;
    lastDay = day;
    const descs = descriptions(group);
    const why = reason(group);
    const delta = internalDelta(group, ctx);
    const impact = effect(delta);
    const from = sideNames(group, ctx, 'out').join('、');
    const to = sideNames(group, ctx, 'in').join('、');
    return `${showDay ? `<div class="timeline-day"><span>${escapeHtml(day)}</span></div>` : ''}
      <button class="fund-history-row" type="button" data-group="${escapeHtml(group.groupId)}">
        <span class="history-time"><b>${escapeHtml(fmtClock(group.startTime))}</b><small>${escapeHtml(group.info.label)}</small></span>
        <span class="history-action">${descs.length
          ? descs.map((desc) => `<b>${escapeHtml(desc)}</b>`).join('')
          : '<b class="missing">业务动作待补充</b>'}</span>
        <span class="history-reason${why.fallback ? ' fallback' : ''}">${escapeHtml(why.text)}</span>
        <span class="history-route" title="${escapeHtml(`${from} → ${to}`)}"><small>${escapeHtml(from)}</small><i>→</i><small>${escapeHtml(to)}</small></span>
        <span class="history-money"><b>${amount(group.amount)}</b><em class="${impact.css}">${impact.label}${impact.css === 'move' ? '' : ` ${impact.sign}${amount(Math.abs(delta))}`}</em></span>
        <span class="history-balance"><small>操作后内部池存量</small><b>${amount(balanceAfter.get(group.groupId))}</b></span>
        <span class="history-open">查看证据链 →</span>
      </button>`;
  }).join('');

  return `<div class="card chart-card fund-history-card">
    <div class="chart-titlebar">
      <div><span class="chart-kicker">CUSTOMER FUND HISTORY</span><h3>客户资金操作时间线</h3>
      <p>当前主单账本的全部资金操作；每一行说明做了什么、为什么发生、钱从哪到哪以及操作后的内部池账面存量</p></div>
      <div class="action-story-total"><strong>${groups.length}</strong><small>次资金操作</small></div>
    </div>
    <div class="fund-history-head"><span>时间 / 操作</span><span>业务动作</span><span>发生原因 / 业务依据</span><span>资金路径</span><span>操作金额 / 影响</span><span>操作后存量</span><span></span></div>
    <div class="fund-history-body">${rows}</div>
    <div class="distribution-foot"><span class="hint-pulse"></span>业务动作来自 fundActionDesc；发生原因仅展示 metadata 中可核实的信息，缺失时明确标注，不做推测</div>
  </div>`;
}
