/**
 * 资金池余额瀑布图 —— 回答「这个池的余额为什么是这个数」。
 *
 * 放在池卡片展开处。把池内条目按时间排开，每根柱子是一次出入金，
 * 柱子首尾相接，最后一根落在池余额上。
 *
 * 对 S14…1381 这种「付进来 8,400 → 减项退出去 8,400 → 预收款抵回 10,200」
 * 的池最有解释力：三根柱子直接把余额 10,200 的来历讲清楚。
 *
 * 后端契约：池余额 = 池内条目金额之和。所以最后一根柱顶必须等于 pool.balance，
 * 对不上就如实标出来。
 */

import { amount, escapeHtml, fmtTime, number, type FundPool, type LedgerEntry } from '../api';
import type { ViewContext } from '../context';
import { shortAmount } from './layout';

const BAR_W = 26;
const STEP = 44;
const H = 148;
const PAD_T = 16;
const PAD_B = 34;
const AXIS_L = 4;

export function renderWaterfall(pool: FundPool, ctx: ViewContext): string {
  const entries = (pool.entries ?? []).slice()
    .sort((a, b) => String(a.finishTime ?? '').localeCompare(String(b.finishTime ?? '')));
  if (entries.length < 2) return '';

  // 逐条累加（分），并记录每根柱子的起止
  const bars: Array<{ entry: LedgerEntry; from: number; to: number }> = [];
  let running = 0;
  entries.forEach((entry) => {
    const delta = Math.round(number(entry.amount) * 100) * (entry.direction === 'INFLOW' ? 1 : -1);
    bars.push({ entry, from: running, to: running + delta });
    running += delta;
  });

  const ledger = Math.round(number(pool.balance) * 100);
  const drift = running - ledger;

  const values = bars.flatMap((b) => [b.from, b.to]).concat([0, ledger]);
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const span = Math.max(1, top - bottom);
  const plotH = H - PAD_T - PAD_B;
  const width = AXIS_L + bars.length * STEP + 118;
  const yAt = (cents: number): number => PAD_T + plotH - (plotH * (cents - bottom)) / span;
  const zeroY = yAt(0);

  const barsSvg = bars.map((bar, i) => {
    const x = AXIS_L + i * STEP + (STEP - BAR_W) / 2;
    const y1 = yAt(bar.from);
    const y2 = yAt(bar.to);
    const inflow = bar.entry.direction === 'INFLOW';
    const group = ctx.groupByEntryId.get(bar.entry.entryId ?? '');
    const title = `${escapeHtml(fmtTime(bar.entry.finishTime))}\n${escapeHtml(bar.entry.fundActionDesc ?? '')}\n`
      + `${inflow ? '+' : '−'}${amount(bar.entry.amount)} → 余额 ${amount(bar.to / 100)}`;
    return `
      <g class="wf-bar" data-drawer="${escapeHtml(group?.groupId ?? '')}">
        <title>${title}</title>
        <rect x="${x.toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${BAR_W}"
              height="${Math.max(1.5, Math.abs(y2 - y1)).toFixed(1)}" rx="2"
              class="${inflow ? 'wf-in' : 'wf-out'}"/>
        ${i > 0 ? `<line x1="${(x - (STEP - BAR_W)).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y1.toFixed(1)}" class="wf-link"/>` : ''}
        <text x="${(x + BAR_W / 2).toFixed(1)}" y="${(Math.min(y1, y2) - 5).toFixed(1)}" class="wf-amt ${inflow ? 'wf-amt-in' : 'wf-amt-out'}">${inflow ? '+' : '−'}${escapeHtml(shortAmount(number(bar.entry.amount)))}</text>
        <text x="${(x + BAR_W / 2).toFixed(1)}" y="${(H - 18).toFixed(1)}" class="wf-date">${escapeHtml(fmtTime(bar.entry.finishTime).slice(5, 10))}</text>
      </g>`;
  }).join('');

  const endX = AXIS_L + bars.length * STEP;
  const endY = yAt(running);

  return `
    <div class="wf-wrap">
      <div class="wf-title">余额是怎么来的 · ${bars.length} 笔出入金</div>
      <div class="wf-scroll">
        <svg viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" class="wf-svg" role="img" aria-label="资金池余额瀑布图">
          <line x1="0" y1="${zeroY.toFixed(1)}" x2="${width - 4}" y2="${zeroY.toFixed(1)}" class="wf-zero"/>
          ${barsSvg}
          <line x1="${endX.toFixed(1)}" y1="${endY.toFixed(1)}" x2="${(endX + 104).toFixed(1)}" y2="${endY.toFixed(1)}" class="wf-final"/>
          <text x="${(endX + 8).toFixed(1)}" y="${(endY - 6).toFixed(1)}" class="wf-final-label">当前余额</text>
          <text x="${(endX + 8).toFixed(1)}" y="${(endY + 12).toFixed(1)}" class="wf-final-value">${escapeHtml(amount(running / 100))}</text>
        </svg>
      </div>
      ${Math.abs(drift) > 1
        ? `<div class="wf-note">✕ 条目累加 ${amount(running / 100)} 与接口返回的池余额 ${amount(pool.balance)} 差 ${amount(drift / 100)} 元</div>`
        : ''}
    </div>`;
}
