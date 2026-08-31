/**
 * 内部资金池账面存量阶梯图。
 *
 * 这张图只回答一件事：内部资金池账面存量如何因为一次次资金操作走到今天。
 * 外部与内部之间的操作会改变存量；资金池之间的划转不会改变总额，用空心菱形标记。
 * 「钱现在分布在哪」由上一张资金位置图回答，避免一张图同时承担存量构成和事件解释。
 */

import { amount, escapeHtml, fmtDay, number } from '../api';
import type { ViewContext } from '../context';
import { shortAmount } from './layout';

const W = 1100;
const H = 285;
const PAD_L = 62;
const PAD_R = 116;
const PAD_T = 34;
const PAD_B = 34;

function niceScale(cents: number): { max: number; step: number } {
  if (cents <= 0) return { max: 1, step: 1 };
  const pow = 10 ** Math.floor(Math.log10(cents / 4));
  for (const mult of [1, 2, 2.5, 5, 10, 20]) {
    const step = mult * pow;
    if (Math.ceil(cents / step) <= 4) return { max: Math.ceil(cents / step) * step, step };
  }
  return { max: cents, step: cents / 4 };
}

function axisLabel(cents: number, step: number): string {
  if (cents === 0) return '0';
  const yuan = cents / 100;
  if (Math.abs(step / 100) >= 10000) {
    const wan = yuan / 10000;
    return `${wan.toFixed(Number.isInteger(wan) ? 0 : 1)}万`;
  }
  return yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function defs(): string {
  return `<defs>
    <linearGradient id="journey-area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5879eb" stop-opacity=".36"/>
      <stop offset="100%" stop-color="#5879eb" stop-opacity=".035"/>
    </linearGradient>
    <linearGradient id="journey-line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3d63d5"/><stop offset="100%" stop-color="#7457e8"/>
    </linearGradient>
    <filter id="journey-glow" x="-20%" y="-40%" width="140%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#3457bd" flood-opacity=".23"/>
    </filter>
  </defs>`;
}

export function renderGrowth(ctx: ViewContext): string {
  const groups = ctx.groups.slice().reverse();
  if (!groups.length) {
    return `<div class="card"><div class="card-head"><h3>内部资金池账面存量变化</h3></div><div class="card-body"><div class="empty">账本里没有资金操作记录</div></div></div>`;
  }

  let current = 0;
  const steps = groups.map((group) => {
    let delta = 0;
    group.legs.forEach((leg) => {
      const pool = ctx.index.get(leg.accountId ?? '');
      if (!pool || pool.poolScope === 'EXTERNAL') return;
      const signed = Math.round(number(leg.amount) * 100) * (leg.direction === 'INFLOW' ? 1 : -1);
      delta += signed;
    });
    current += delta;
    return { group, delta, total: current, day: fmtDay(group.startTime) };
  });

  const observed = Math.max(...steps.map((step) => step.total), 1);
  const { max: axisMax, step: axisStep } = niceScale(observed);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const xAt = (i: number): number => PAD_L + (steps.length === 1 ? plotW : (plotW * i) / (steps.length - 1));
  const yAt = (cents: number): number => PAD_T + plotH - (plotH * cents) / axisMax;
  const baseline = yAt(0);

  let line = `M ${xAt(0).toFixed(1)} ${baseline.toFixed(1)} V ${yAt(steps[0].total).toFixed(1)}`;
  for (let i = 1; i < steps.length; i += 1) {
    line += ` H ${xAt(i).toFixed(1)} V ${yAt(steps[i].total).toFixed(1)}`;
  }
  const area = `${line} L ${xAt(steps.length - 1).toFixed(1)} ${baseline.toFixed(1)} Z`;

  const tickCount = Math.round(axisMax / axisStep);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const value = axisStep * i;
    const y = yAt(value);
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" class="journey-grid"/>
      <text x="${PAD_L - 10}" y="${(y + 4).toFixed(1)}" class="journey-tick">${escapeHtml(axisLabel(value, axisStep))}</text>`;
  }).join('');

  let lastDay = '';
  const days = steps.map((step, index) => {
    if (step.day === lastDay) return '';
    lastDay = step.day;
    const x = xAt(index);
    return `<line x1="${x.toFixed(1)}" y1="${PAD_T}" x2="${x.toFixed(1)}" y2="${baseline.toFixed(1)}" class="journey-day-line"/>
      <text x="${x.toFixed(1)}" y="${H - 9}" class="journey-day">${escapeHtml(step.day.slice(5))}</text>`;
  }).join('');

  const labelThreshold = observed * .045;
  let significantIndex = 0;
  const markers = steps.map((step, index) => {
    const x = xAt(index);
    const y = yAt(step.total);
    const internal = Math.abs(step.delta) <= 1;
    const significant = !internal && (Math.abs(step.delta) >= labelThreshold || index === 0 || index === steps.length - 1);
    let label = '';
    if (significant) {
      const above = significantIndex++ % 2 === 0;
      const dy = above ? -14 : 22;
      label = `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" class="journey-delta ${step.delta > 0 ? 'in' : 'out'}">${step.delta > 0 ? '+' : '−'}${escapeHtml(shortAmount(Math.abs(step.delta) / 100))}</text>`;
    }
    const marker = internal
      ? `<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" rx="1" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})" class="journey-transfer"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" class="journey-change ${step.delta > 0 ? 'in' : 'out'}"/>`;
    return `<g class="journey-event" data-group="${escapeHtml(step.group.groupId)}">
      <title>${escapeHtml(`${step.day} · ${step.group.info.label} · ${step.delta > 0 ? '内部池存量增加' : step.delta < 0 ? '内部池存量减少' : '池间转移，总额不变'} ${amount(Math.abs(step.delta) / 100)} 元 · 操作后内部池存量 ${amount(step.total / 100)} 元`)}</title>
      ${marker}${label}
    </g>`;
  }).join('');

  const inflow = steps.filter((step) => step.delta > 0).reduce((sum, step) => sum + step.delta, 0);
  const outflow = -steps.filter((step) => step.delta < 0).reduce((sum, step) => sum + step.delta, 0);
  const transfers = steps.filter((step) => Math.abs(step.delta) <= 1).length;
  const last = steps[steps.length - 1];
  const ledgerTotal = ctx.pools.filter((pool) => pool.poolScope !== 'EXTERNAL')
    .reduce((sum, pool) => sum + Math.round(number(pool.balance) * 100), 0);
  const drift = last.total - ledgerTotal;

  const eventCards = steps.filter((step) => Math.abs(step.delta) > 1)
    .slice().reverse().slice(0, 4).map((step) => `
      <button class="journey-event-card" type="button" data-group="${escapeHtml(step.group.groupId)}">
        <span class="journey-event-sign ${step.delta > 0 ? 'in' : 'out'}">${step.delta > 0 ? '+' : '−'}</span>
        <span><b>${escapeHtml(step.group.info.label)}</b><small>${escapeHtml(step.day)} · 操作后内部池存量 ${amount(step.total / 100)}</small></span>
        <strong class="${step.delta > 0 ? 'amount-in' : 'amount-out'}">${step.delta > 0 ? '+' : '−'}${amount(Math.abs(step.delta) / 100)}</strong>
      </button>`).join('');

  return `
    <div class="card chart-card journey-card">
      <div class="chart-titlebar">
        <div>
          <span class="chart-kicker">BALANCE JOURNEY</span>
          <h3>内部资金池账面存量如何走到今天</h3>
          <p>这是主单下全部内部资金池的账面余额之和，不是客户余额或银行账户余额</p>
        </div>
        <div class="chart-total"><small>当前内部池账面存量</small><strong>${amount(last.total / 100)}</strong><span>元</span></div>
      </div>
      <div class="journey-summary">
        <span><small>外部转入内部池</small><b class="amount-in">+${amount(inflow / 100)}</b></span>
        <span><small>内部池转到外部</small><b class="amount-out">${outflow > 0 ? '−' : ''}${amount(outflow / 100)}</b></span>
        <span><small>池间移动</small><b>${transfers} 次</b></span>
        <span><small>余额峰值</small><b>${amount(observed / 100)}</b></span>
      </div>
      <div class="chart-stage journey-stage">
        <svg viewBox="0 0 ${W} ${H}" class="journey-svg" role="img" aria-label="内部资金池账面存量阶梯图">
          ${defs()}<rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" rx="12" class="journey-bg"/>
          ${ticks}${days}
          <path d="${area}" fill="url(#journey-area)"/>
          <path d="${line}" class="journey-line"/>
          ${markers}
          <g class="journey-current"><rect x="${W - PAD_R + 10}" y="${yAt(last.total) - 18}" width="96" height="36" rx="9"/><text x="${W - PAD_R + 58}" y="${yAt(last.total) - 3}">内部池存量</text><text x="${W - PAD_R + 58}" y="${yAt(last.total) + 12}">${escapeHtml(shortAmount(last.total / 100))}</text></g>
        </svg>
        <div class="journey-legend"><span><i class="in"></i>进入系统</span><span><i class="out"></i>离开系统</span><span><i class="transfer"></i>池间移动（总额不变）</span></div>
      </div>
      <div class="journey-events"><div class="journey-events-title"><b>最近影响余额的操作</b><span>点击查看完整证据链</span></div>${eventCards}</div>
      <div class="chart-hint"><span class="hint-pulse"></span>
        计算口径：每一步累计内部资金池的入金减出金；阶梯只在操作完成时跳变
        ${Math.abs(drift) <= 1 ? `<span class="gr-ok">✓ 阶梯终值与接口资金池余额一致</span>` : `<span class="gr-bad">✕ 阶梯终值与资金池余额相差 ${amount(drift / 100)} 元</span>`}
      </div>
    </div>`;
}
