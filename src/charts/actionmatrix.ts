/**
 * 进入系统后的资金变化。
 *
 * 客户支付进入内部池是显而易见的，且已经被余额阶梯、泳道图和来源去向矩阵解释。
 * 本图只保留非 PAY 操作，聚焦钱进入系统后的内部回流、抵扣、退款和流出。
 */
import { amount, escapeHtml, number } from '../api';
import type { ViewContext } from '../context';
import { groupEdges, legDisplay, type TxnGroup } from '../groups';

interface RouteSummary { from: string; to: string; cents: number; count: number; groupId: string; }
interface OperationSummary { label: string; groups: TxnGroup[]; cents: number; routes: RouteSummary[]; descriptions: string[]; }

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function descriptions(group: TxnGroup): string[] {
  return unique(group.legs.map((leg) => String(leg.fundActionDesc ?? '').trim()))
    .filter((value) => value !== 'null' && value !== 'undefined');
}
function internalDelta(group: TxnGroup, ctx: ViewContext): number {
  return group.legs.reduce((sum, leg) => {
    const pool = ctx.index.get(leg.accountId ?? '');
    if (!pool || pool.poolScope === 'EXTERNAL') return sum;
    const cents = Math.round(number(leg.amount) * 100);
    return sum + (leg.direction === 'INFLOW' ? cents : -cents);
  }, 0);
}
function routeSummaries(groups: TxnGroup[], ctx: ViewContext): RouteSummary[] {
  const result = new Map<string, RouteSummary>();
  groups.forEach((group) => {
    const edges = groupEdges(group);
    if (!edges?.length) return;
    edges.forEach((edge) => {
      const outLeg = group.outLegs.find((leg) => leg.accountId === edge.from);
      const inLeg = group.inLegs.find((leg) => leg.accountId === edge.to);
      const from = outLeg ? legDisplay(outLeg, ctx.index).name : '系统外';
      const to = inLeg ? legDisplay(inLeg, ctx.index).name : '系统外';
      const key = `${from}→${to}`;
      const hit = result.get(key) ?? { from, to, cents: 0, count: 0, groupId: group.groupId };
      hit.cents += Math.round(number(edge.amount) * 100);
      hit.count += 1;
      result.set(key, hit);
    });
  });
  return [...result.values()].sort((a, b) => b.cents - a.cents);
}

export function renderActionMatrix(ctx: ViewContext): string {
  const followups = ctx.groups.filter((group) => group.info.kind !== 'PAY');
  if (!followups.length) return '';
  const byOperation = new Map<string, TxnGroup[]>();
  followups.forEach((group) => byOperation.set(group.info.label, [...(byOperation.get(group.info.label) ?? []), group]));
  const operations: OperationSummary[] = [...byOperation.entries()].map(([label, groups]) => ({
    label, groups,
    cents: groups.reduce((sum, group) => sum + Math.round(group.amount * 100), 0),
    routes: routeSummaries(groups, ctx),
    descriptions: unique(groups.flatMap(descriptions)),
  })).sort((a, b) => b.cents - a.cents);

  const internalGroups = followups.filter((group) => Math.abs(internalDelta(group, ctx)) <= 1);
  const internalCents = internalGroups.reduce((sum, group) => sum + Math.round(group.amount * 100), 0);
  const outCents = followups.filter((group) => internalDelta(group, ctx) < -1)
    .reduce((sum, group) => sum + Math.round(group.amount * 100), 0);
  const unresolved = followups.filter((group) => !groupEdges(group)?.length).length;
  const max = Math.max(...operations.map((operation) => operation.cents), 1);

  const cards = operations.map((operation, index) => {
    const delta = operation.groups.reduce((sum, group) => sum + internalDelta(group, ctx), 0);
    const effect = Math.abs(delta) <= 1 ? '内部池总存量不变' : delta > 0
      ? `内部池存量增加 ${amount(delta / 100)}` : `内部池存量减少 ${amount(Math.abs(delta) / 100)}`;
    return `<section class="after-entry-operation">
      <header><span class="after-entry-rank">${String(index + 1).padStart(2, '0')}</span><span><b>${escapeHtml(operation.label)}</b><small>${operation.groups.length} 次操作 · ${effect}</small></span><strong>${amount(operation.cents / 100)}</strong></header>
      <div class="after-entry-bar"><i style="width:${Math.max(3, (operation.cents / max) * 100).toFixed(1)}%"></i></div>
      <div class="after-entry-routes">${operation.routes.map((route) => `<button type="button" data-group="${escapeHtml(route.groupId)}"><span><b>${escapeHtml(route.from)}</b><i>→</i><b>${escapeHtml(route.to)}</b></span><strong>${amount(route.cents / 100)}<small>${route.count} 笔流向</small></strong></button>`).join('') || '<span class="after-entry-missing">路径无法由账本唯一还原</span>'}</div>
      <div class="after-entry-desc"><small>涉及的账务动作</small>${operation.descriptions.map((desc) => `<span>${escapeHtml(desc)}</span>`).join('')}</div>
    </section>`;
  }).join('');

  return `<div class="card chart-card after-entry-card">
    <div class="chart-titlebar"><div><span class="chart-kicker">AFTER MONEY ENTERS</span><h3>钱进入系统以后，又发生了什么</h3>
      <p>排除首次客户支付，只看内部回流、抵扣、退款和离开系统的操作；这些才是资金去向中不显而易见的变化</p></div>
      <div class="action-matrix-total"><strong>${followups.length}</strong><small>次后续资金操作</small></div></div>
    <div class="after-entry-summary">
      <span><small>内部池间累计移动</small><b>${amount(internalCents / 100)}</b><em>位置变化，总存量不变</em></span>
      <span><small>累计离开内部池</small><b>${amount(outCents / 100)}</b><em>${outCents ? '内部存量相应减少' : '当前没有流出系统'}</em></span>
      <span><small>涉及主业务操作</small><b>${operations.length} 类</b><em>${operations.map((operation) => operation.label).join('、')}</em></span>
      <span><small>无法还原路径</small><b>${unresolved} 次</b><em>${unresolved ? '不猜测资金去向' : '所有后续路径均可还原'}</em></span>
    </div>
    <div class="after-entry-grid">${cards}</div>
    <div class="distribution-foot"><span class="hint-pulse"></span>客户首次支付已由上方图表解释，这里不重复展示；点击任意后续路径查看业务原因和完整证据链</div>
  </div>`;
}
