/**
 * 全局资金地图：以 transferGroupId 为唯一事件单位，把该主单的全部资金操作
 * 按时间串成一条可读、可核对的资金旅程。
 */
import { amount, escapeHtml, fmtClock, fmtDay, number, type FundPool } from '../api';
import { poolPalette, type ViewContext } from '../context';
import { renderFundStream } from './stream';

function poolTypeLabel(type: string, pools: FundPool[]): string {
  return pools.find((pool) => pool.poolTypeDesc)?.poolTypeDesc || type;
}

function percentage(value: number, total: number): string {
  if (!total) return '0%';
  const ratio = value / total * 100;
  if (ratio >= 10) return `${ratio.toFixed(1)}%`;
  if (ratio >= 1) return `${ratio.toFixed(2)}%`;
  return `${ratio.toFixed(3)}%`;
}

function mapPoolPosition(ctx: ViewContext): string {
  const held = ctx.pools.filter((pool) => pool.poolScope !== 'EXTERNAL' && number(pool.balance) > 0);
  if (!held.length) return '';
  const grouped = new Map<string, FundPool[]>();
  held.forEach((pool) => {
    const type = pool.poolType ?? 'OTHER';
    grouped.set(type, [...(grouped.get(type) ?? []), pool]);
  });
  const groups = [...grouped.entries()].map(([type, pools]) => ({
    type,
    pools: pools.sort((a, b) => number(b.balance) - number(a.balance)),
    total: pools.reduce((sum, pool) => sum + number(pool.balance), 0),
  })).sort((a, b) => b.total - a.total);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const distribution = groups.map((group) => {
    const palette = poolPalette(group.type);
    const ratio = total ? group.total / total * 100 : 0;
    const compact = ratio < 8 ? ' compact' : '';
    const compactHint = ratio < 8 ? '<i>小比例放大</i>' : '';
    return `<button type="button" class="map-position-segment${compact}" data-pool-type="${escapeHtml(group.type)}"
      style="--pool:${palette.main};--share:${ratio}" title="${escapeHtml(poolTypeLabel(group.type, group.pools))}：${amount(group.total)} 元，占 ${percentage(group.total, total)}">
      <span>${escapeHtml(poolTypeLabel(group.type, group.pools))}</span><b>${percentage(group.total, total)}</b>${compactHint}
    </button>`;
  }).join('');
  return `<section class="map-position-card">
    <header><span><b>客户资金分布</b><small>客户资金当前分散在哪些资金池；点击比例或池子查看明细</small></span><strong>${amount(total)} 元</strong></header>
    <div class="map-position-distribution">
      <div class="map-position-bar">${distribution}</div>
    </div>
  </section>`;
}

export function renderMoneyMap(target: HTMLElement, ctx: ViewContext, focus?: string): void {
  const groups = ctx.groups.slice().reverse();
  const actionStats = new Map<string, { label: string; count: number; amount: number; kind: string }>();
  groups.forEach((group) => {
    const key = group.groupType || 'UNKNOWN';
    const stat = actionStats.get(key) ?? { label: group.info.label, count: 0, amount: 0, kind: group.info.kind };
    stat.count += 1;
    stat.amount += group.amount;
    actionStats.set(key, stat);
  });

  const actionOverview = [...actionStats.entries()].map(([groupType, stat]) => {
    const css = stat.kind === 'PAY' ? 'pay' : stat.kind === 'REFUND' ? 'refund' : 'other';
    const events = groups.filter((group) => (group.groupType || 'UNKNOWN') === groupType)
      .map((group) => `<button type="button" data-group="${escapeHtml(group.groupId)}"><time>${escapeHtml(fmtDay(group.startTime))} ${escapeHtml(fmtClock(group.startTime))}</time><span>${escapeHtml(group.info.label)}</span><strong>${amount(group.amount)} 元</strong><i>→</i></button>`).join('');
    return `<details class="money-map-action-stat ${css}"><summary title="groupType: ${escapeHtml(groupType)}"><span><small>${escapeHtml(stat.label)}</small><em>累计 ${amount(stat.amount)} 元</em></span><b>${stat.count} 次</b></summary><div>${events}</div></details>`;
  }).join('');

  target.innerHTML = `<section class="money-map-hero compact">
      <div class="money-map-hero-copy"><span class="eyebrow">GLOBAL MONEY JOURNEY</span><h2>资金地图</h2>
        <p>沿时间向下阅读每一次资金操作，横向看钱从哪个资金池离开、进入哪里；点击任意一行可追溯到具体池号和业务证据。</p>
        <div class="money-map-hero-meta"><span>${groups.length} 次资金操作</span><i></i><span>${groups.length ? `${fmtDay(groups[0].startTime)} — ${fmtDay(groups[groups.length - 1].startTime)}` : '暂无操作'}</span></div>
      </div>
    </section>
    <div class="money-map-overview">${actionOverview}</div>
    ${mapPoolPosition(ctx)}
    <section id="mapFundStream" class="map-fund-stream"></section>`;

  const streamHost = target.querySelector<HTMLElement>('#mapFundStream');
  if (streamHost) renderFundStream(streamHost, ctx, focus);

  target.querySelectorAll<HTMLElement>('[data-group]').forEach((node) => {
    const open = (): void => ctx.openGroup(node.dataset.group as string);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      open();
    });
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
  target.querySelectorAll<HTMLElement>('[data-pool-type]').forEach((node) => {
    node.addEventListener('click', () => ctx.openPoolType(node.dataset.poolType as string));
  });
}
