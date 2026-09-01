/** 资金事件地图：一个 transferGroupId 翻译成一句可读、可核对的资金事实。 */
import { amount, escapeHtml, fmtClock, fmtDay, number } from '../api';
import type { ViewContext } from '../context';
import { legDisplay, type TxnGroup } from '../groups';

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function descriptions(group: TxnGroup): string[] {
  return unique(group.legs.map((leg) => String(leg.fundActionDesc ?? '').trim()))
    .filter((value) => value !== 'null' && value !== 'undefined');
}
function side(group: TxnGroup, ctx: ViewContext, direction: 'out' | 'in'): string {
  const legs = direction === 'out' ? group.outLegs : group.inLegs;
  if (!legs.length) return '系统外';
  return unique(legs.map((leg) => legDisplay(leg, ctx.index).name)).join('、');
}
function reason(group: TxnGroup): string {
  const parts = group.legs.flatMap((leg) => leg.metadata ?? []).flatMap((item) =>
    item.value != null && item.value !== '' && !Array.isArray(item.value)
      ? [`${item.label || ''} ${String(item.value)}`.trim()] : []);
  return unique(parts).join(' · ') || '接口未提供独立发生原因';
}
function actor(group: TxnGroup): { name: string; verb: string } {
  if (group.outLegs.some((leg) => leg.accountType === 'CUSTOMER')) return { name: '客户', verb: '选择了' };
  if (group.inLegs.some((leg) => leg.accountType === 'CUSTOMER')) return { name: '系统向客户', verb: '执行了' };
  return { name: '业务系统', verb: '执行了' };
}
function internalDelta(group: TxnGroup, ctx: ViewContext): number {
  return group.legs.reduce((sum, leg) => {
    const pool = ctx.index.get(leg.accountId ?? '');
    if (!pool || pool.poolScope === 'EXTERNAL') return sum;
    const cents = Math.round(number(leg.amount) * 100);
    return sum + (leg.direction === 'INFLOW' ? cents : -cents);
  }, 0) / 100;
}
function impact(delta: number): { css: string; text: string } {
  if (delta > .005) return { css: 'in', text: `内部池存量增加 ${amount(delta)}` };
  if (delta < -.005) return { css: 'out', text: `内部池存量减少 ${amount(Math.abs(delta))}` };
  return { css: 'move', text: '内部池间移动，总存量不变' };
}

export function renderEventMap(ctx: ViewContext): string {
  const groups = ctx.groups.slice().reverse();
  if (!groups.length) return '';
  let balance = 0;
  const events = groups.map((group, index) => {
    const delta = internalDelta(group, ctx);
    balance += delta;
    const who = actor(group);
    const descs = descriptions(group);
    const action = descs.length === 1 ? descs[0] : group.info.label;
    const from = side(group, ctx, 'out');
    const to = side(group, ctx, 'in');
    const why = reason(group);
    const effect = impact(delta);
    const statuses = unique(group.legs.map((leg) => String(leg.status ?? '')).filter(Boolean));
    const statusDesc = group.legs.find((leg) => leg.statusDesc)?.statusDesc;
    const status = group.hasExecuting ? (statusDesc || '处理中') : statuses.length === 1 ? (statusDesc || statuses[0]) : '已完成';
    const sentence = `${who.name}在 ${fmtDay(group.startTime)} ${fmtClock(group.startTime)} ${who.verb}“${action}”，触发 ${amount(group.amount)} 元从${from}转移到${to}。`;
    return `<button class="money-event-card ${effect.css}" type="button" data-group="${escapeHtml(group.groupId)}">
      <span class="money-event-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="money-event-date"><b>${escapeHtml(fmtDay(group.startTime).slice(5))}</b><small>${escapeHtml(fmtClock(group.startTime))}</small></span>
      <span class="money-event-kind ${effect.css}">${escapeHtml(group.info.label)}</span>
      <p>${escapeHtml(sentence)}</p>
      ${descs.length > 1 ? `<span class="money-event-actions">${descs.map((desc) => `<b>${escapeHtml(desc)}</b>`).join('')}</span>` : ''}
      <span class="money-event-path"><b>${escapeHtml(from)}</b><i>→</i><b>${escapeHtml(to)}</b></span>
      <span class="money-event-meta"><span><small>发生原因 / 依据</small><b>${escapeHtml(why)}</b></span><span><small>资金影响</small><b>${escapeHtml(effect.text)}</b></span></span>
      <span class="money-event-foot"><span>${escapeHtml(status)}</span><span>操作后内部池存量 <b>${amount(balance)}</b></span><i>查看证据链 →</i></span>
    </button>`;
  }).join('');
  return `<div class="card chart-card money-event-map">
    <div class="chart-titlebar"><div><span class="chart-kicker">MONEY EVENT MAP</span><h3>每一笔钱发生了什么</h3>
      <p>一张卡就是一次完整资金操作，按时间从左到右阅读；把账本翻译成“谁在何时因何动作，让多少钱从哪里到哪里”</p></div>
      <div class="flow-perspective-total"><strong>${groups.length}</strong><small>个资金事件</small></div></div>
    <div class="money-event-guide"><span><i class="in"></i>进入内部池</span><span><i class="move"></i>内部池间移动</span><span><i class="out"></i>离开内部池</span><em>横向查看全部历史操作</em></div>
    <div class="money-event-scroll"><div class="money-event-line"></div><div class="money-event-cards">${events}</div></div>
    <div class="distribution-foot"><span class="hint-pulse"></span>发生原因仅使用 metadata 中可核实的信息；接口缺失时明确标注，不根据金额或池名猜测</div>
  </div>`;
}
