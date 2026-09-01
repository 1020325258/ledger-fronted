/**
 * 资金总览 —— 一屏回答四个问题：
 *   我投入了多少 / 退回我多少 / 现在还在系统里多少 / 我还要付多少。
 *
 * 前三个数字直接取接口的 customerTotalPay / customerTotalRefund /
 * systemInternalBalance，不自己加总明细。第四个来自 FUND 池的应收 − 实收。
 *
 * 「已退回你」旁边额外标出系统内回流金额 —— 接口的 customerTotalRefund 口径是
 * 「真正退回客户口袋的钱」，减项退到预收款那种不算，但客户确实经历了一次退款，
 * 不写清楚会被读成「我的退款没到账」。
 */

import { amount, escapeHtml, number, type FundPool } from '../api';
import type { ViewContext } from '../context';
import { renderTreemap } from '../charts/treemap';
import { renderGrowth } from '../charts/growth';
import { renderActionStory } from '../charts/actionstory';
import { renderFlowMap, type LaneMode } from '../charts/flowmap';
import { renderFlowPerspectives } from '../charts/flowperspectives';
import { renderEventMap } from '../charts/eventmap';

let overviewLaneMode: LaneMode = 'type';

/** 整装款项待付 = Σ(应收 − 实收)，只算还差钱的款项。 */
function outstanding(pools: FundPool[]): number {
  return pools
    .filter((p) => p.poolType === 'FUND' && p.fundAmount != null)
    .reduce((sum, p) => sum + Math.max(0, Math.round((number(p.fundAmount) - number(p.paidAmount)) * 100)), 0) / 100;
}

/**
 * 系统内回流：退款类操作里，入金腿全部落在系统内记账池的那些组。
 * 钱退出来了但没离开系统，客户后续还能用。
 */
function internalRefund(ctx: ViewContext): { total: number; count: number } {
  const groups = ctx.groups.filter((g) => g.info.kind === 'REFUND')
    .filter((g) => g.inLegs.length > 0)
    .filter((g) => g.inLegs.every((leg) => leg.accountType !== 'CUSTOMER' && leg.accountType !== 'DEVELOPER'));
  return {
    total: groups.reduce((sum, g) => sum + Math.round(g.amount * 100), 0) / 100,
    count: groups.length,
  };
}

function kpi(label: string, value: number, note: string, accent = false): string {
  return `
    <div class="kpi${accent ? ' accent' : ''}">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${amount(value)}<small>元</small></div>
      ${note ? `<div class="kpi-note">${note}</div>` : ''}
    </div>`;
}

export function renderOverview(target: HTMLElement, ctx: ViewContext): void {
  const { data, pools } = ctx;
  const internal = pools.filter((p) => p.poolScope !== 'EXTERNAL');
  const held = internal.filter((p) => number(p.balance) > 0);
  const reflow = internalRefund(ctx);
  const todo = outstanding(pools);

  const balanced = data.isBalanced !== false;
  const warnings = data.warnings ?? [];

  target.innerHTML = `
    <div class="view-head">
      <span class="eyebrow">PROJECT MONEY MAP</span>
      <h2>资金总览</h2>
      <p>先看结论，再追过程。这里统一回答客户和服务者最关心的四件事：付了多少、退了多少、钱现在在哪、接下来还要处理什么。</p>
    </div>

    <div class="kpis">
      ${kpi('客户累计投入', number(data.customerTotalPay), `${ctx.groups.filter((g) => g.info.kind === 'PAY').length} 次支付操作`)}
      ${kpi('已退回客户', number(data.customerTotalRefund), reflow.count
        ? `另有 <a data-goto-refund="1">系统内回流 ${amount(reflow.total)} 元</a>（${reflow.count} 次），钱退出订单但仍留在系统内可继续使用`
        : '没有退回站外的退款')}
      ${kpi('内部资金池账面存量', number(data.systemInternalBalance), `不是客户余额或银行余额；当前停在 ${held.length} 个资金池，共 ${internal.length} 个内部池`, true)}
      ${kpi('整装款项待付', todo, todo > 0 ? '应收减去实收，见「订单与款项」' : '整装款项已收齐')}
    </div>

    <div class="money-story" aria-label="资金关键口径说明">
      <div class="story-copy">
        <span class="eyebrow">三个金额，三个口径</span>
        <h3>累计流量与当前存量不能直接相加减</h3>
        <p>客户支付、内部池账面存量、退回客户分别独立统计；内部存量还可能包含期初或其他来源资金。</p>
      </div>
      <div class="story-flow">
        <button class="story-node source" data-story="map">
          <small>累计流量 · 客户支付</small><strong>${amount(data.customerTotalPay)}</strong><span>看支付操作</span>
        </button>
        <div class="story-results">
          <button class="story-node held" data-story="pools">
            <small>当前存量 · 内部池账面</small><strong>${amount(data.systemInternalBalance)}</strong><span>看资金位置</span>
          </button>
          <button class="story-node returned" data-story="refund">
            <small>累计流量 · 退回客户</small><strong>${amount(data.customerTotalRefund)}</strong><span>看退款操作</span>
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>守恒校验</h3></div>
      <div class="conserve ${balanced ? 'ok' : 'bad'}">
        <span>${balanced ? '✓' : '✕'}</span>
        <span>${escapeHtml(data.balanceCheckMessage ?? (balanced ? '账本守恒' : '账本不守恒'))}</span>
      </div>
    </div>

    ${renderTreemap(ctx)}
    ${renderGrowth(ctx)}
    ${renderFlowMap(ctx, overviewLaneMode)}
    ${renderEventMap(ctx)}
    ${renderFlowPerspectives(ctx)}
    ${renderActionStory(ctx)}

    ${warnings.length ? `
      <div class="card">
        <div class="card-head"><h3>资金池归属告警</h3><span class="sub">${warnings.length} 条</span></div>
        <div class="card-body"><ul class="warnlist">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>
      </div>` : ''}
  `;

  target.querySelectorAll<HTMLElement>('[data-pool]').forEach((node) => {
    node.addEventListener('click', () => ctx.goView('pools', node.dataset.pool));
  });
  target.querySelectorAll<HTMLElement>('[data-group]').forEach((node) => {
    node.addEventListener('click', () => ctx.openGroup(node.dataset.group as string));
  });
  target.querySelectorAll<HTMLElement>('[data-lane-mode]').forEach((node) => {
    node.addEventListener('click', () => {
      overviewLaneMode = node.dataset.laneMode as LaneMode;
      renderOverview(target, ctx);
    });
  });
  target.querySelectorAll<HTMLElement>('[data-lane]').forEach((node) => {
    node.addEventListener('click', () => {
      const firstPool = (node.dataset.lane ?? '').split(',').filter(Boolean)[0];
      ctx.goView('pools', firstPool);
    });
  });
  target.querySelector<HTMLElement>('[data-goto-refund]')?.addEventListener('click', () => ctx.goView('map', 'REFUND'));
  target.querySelectorAll<HTMLElement>('[data-story]').forEach((node) => {
    node.addEventListener('click', () => {
      const story = node.dataset.story;
      if (story === 'refund') ctx.goView('map', 'REFUND');
      else if (story === 'map') ctx.goView('map');
      else ctx.goView('pools');
    });
  });
}
