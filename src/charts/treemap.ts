/**
 * 资金位置分布 —— 类型概览 + 全量资金池排行。
 *
 * 这里刻意不用 treemap：treemap 能比较面积，却会让小资金池缩成无法阅读的小块。
 * 本图先用一条比例带保留整体构成，再用等高明细行保证每个池都有名字、金额和占比。
 */

import { amount, escapeHtml, number, type FundPool } from '../api';
import { poolPalette, type ViewContext } from '../context';
import { poolDisplay } from '../groups';

function subFundDetail(pool: FundPool): string {
  const subs = pool.subFunds ?? [];
  if (!subs.length) return '';
  return subs.map((s) => {
    const name = s.subFundItemName || s.subFundName || '—';
    const type = s.subFundItemTypeDesc ?? '';
    return `${name}${type && !name.includes(type) ? `（${type}）` : ''}：实收 ${amount(s.paidAmount)} 元`;
  }).join('；');
}

function poolRow(pool: FundPool, groupTotal: number, total: number, rank: number): string {
  const id = pool.poolId ?? '';
  const disp = poolDisplay(id, pool.poolType, pool);
  const value = number(pool.balance);
  const groupPct = groupTotal > 0 ? (value / groupTotal) * 100 : 0;
  const totalPct = total > 0 ? (value / total) * 100 : 0;
  const detail = subFundDetail(pool);
  return `
    <button class="pool-rank-row" type="button" data-pool="${escapeHtml(id)}"
      title="${escapeHtml(`${disp.name}${disp.fullId ? ` ${disp.fullId}` : ''}｜余额 ${amount(value)} 元${detail ? `｜${detail}` : ''}`)}">
      <span class="pool-rank-no">${rank}</span>
      <span class="pool-rank-main">
        <span class="pool-rank-name">${escapeHtml(disp.name)}</span>
        <span class="pool-rank-id">${escapeHtml(disp.shortId || id || '—')}</span>
        <span class="pool-rank-track"><i style="width:${Math.max(1.5, groupPct).toFixed(2)}%;background:${poolPalette(pool.poolType).main}"></i></span>
      </span>
      <span class="pool-rank-value"><b>${amount(value)}</b><small>${totalPct.toFixed(totalPct < 10 ? 1 : 0)}% · 占本类 ${groupPct.toFixed(groupPct < 10 ? 1 : 0)}%</small></span>
      <span class="pool-rank-arrow">→</span>
    </button>`;
}

export function renderTreemap(ctx: ViewContext): string {
  const held = ctx.pools
    .filter((p) => p.poolScope !== 'EXTERNAL')
    .filter((p) => number(p.balance) > 0);

  if (!held.length) {
    return `
      <div class="card">
        <div class="card-head"><h3>钱现在放在哪</h3></div>
        <div class="card-body"><div class="empty">系统内没有留存余额的资金池</div></div>
      </div>`;
  }

  const byType = new Map<string, FundPool[]>();
  held.forEach((pool) => {
    const type = pool.poolType ?? 'OTHER';
    byType.set(type, [...(byType.get(type) ?? []), pool]);
  });
  const groups = [...byType.entries()]
    .map(([type, pools]) => ({
      type,
      pools: pools.slice().sort((a, b) => number(b.balance) - number(a.balance)),
      total: pools.reduce((sum, pool) => sum + Math.round(number(pool.balance) * 100), 0) / 100,
    }))
    .sort((a, b) => b.total - a.total);
  const total = groups.reduce((sum, group) => sum + Math.round(group.total * 100), 0) / 100;

  const composition = groups.map((group) => {
    const pct = total > 0 ? (group.total / total) * 100 : 0;
    const name = poolDisplay('', group.type).name;
    return `<button type="button" class="composition-segment" data-pool="${escapeHtml(group.pools[0]?.poolId ?? '')}"
      style="width:${pct.toFixed(3)}%;background:${poolPalette(group.type).main}"
      title="${escapeHtml(`${name}：${amount(group.total)} 元，占 ${pct.toFixed(1)}%`)}">
      ${pct >= 12 ? `<span>${escapeHtml(name)}</span><b>${pct.toFixed(0)}%</b>` : ''}
    </button>`;
  }).join('');

  let rank = 0;
  const cards = groups.map((group) => {
    const pct = total > 0 ? (group.total / total) * 100 : 0;
    const name = poolDisplay('', group.type).name;
    const rows = group.pools.map((pool) => poolRow(pool, group.total, total, ++rank)).join('');
    return `
      <section class="pool-rank-group" style="--pool-color:${poolPalette(group.type).main};--pool-soft:${poolPalette(group.type).soft}">
        <header>
          <span class="pool-group-icon"><i></i></span>
          <span><b>${escapeHtml(name)}</b><small>${group.pools.length} 个有余额的资金池</small></span>
          <span class="pool-group-total"><b>${amount(group.total)}</b><small>占系统内 ${pct.toFixed(pct < 10 ? 1 : 0)}%</small></span>
        </header>
        <div class="pool-rank-list">${rows}</div>
      </section>`;
  }).join('');

  return `
    <div class="card chart-card distribution-card">
      <div class="chart-titlebar">
        <div>
          <span class="chart-kicker">CURRENT POSITION</span>
          <h3>钱现在放在哪</h3>
          <p>先看整体构成，再逐个看清每个资金池；金额从高到低排列，小额资金也不会消失</p>
        </div>
        <div class="chart-total"><small>系统内合计</small><strong>${amount(total)}</strong><span>元</span></div>
      </div>
      <div class="composition-wrap">
        <div class="composition-bar">${composition}</div>
        <div class="composition-scale"><span>资金构成</span><span>${groups.length} 类 · ${held.length} 个有余额资金池</span></div>
      </div>
      <div class="pool-rank-grid">${cards}</div>
      <div class="distribution-foot"><span class="hint-pulse"></span>点击任意资金池查看完整收支、业务单号与子款项</div>
    </div>`;
}
