/**
 * 订单与款项 —— 按业务结构看钱，回答「哪个订单收了多少、还差多少」。
 *
 * 分组依据全部来自接口字段：S 单按 FundPool.compositOrderNo 归到 CT 单，
 * 整装款项按 fundName + subFunds 展开，应收/实收/待退取 fund_info 的原值。
 */

import { amount, escapeHtml, number, type FundPool } from '../api';
import { poolColor, type ViewContext } from '../context';
import { poolDisplay, shortId, totalBalance } from '../groups';


/** 子款项展示名：名字里已经含了类型（如「增项款4656」）就不再补类型后缀。 */
function subFundLabel(itemName: string, fallbackName: string, itemTypeDesc?: string): string {
  const name = itemName || fallbackName || '—';
  const typeName = itemTypeDesc ?? '';
  return typeName && !name.includes(typeName) ? `${name}（${typeName}）` : name;
}

function cents(v: unknown): number {
  return Math.round(number(v) * 100);
}

function fundSection(pools: FundPool[]): string {
  if (!pools.length) return '';
  const rows = pools.map((pool) => {
    const due = number(pool.fundAmount);
    const paid = number(pool.paidAmount);
    const gap = Math.round((due - paid) * 100) / 100;
    const subs = (pool.subFunds ?? []).map((s) => {
      const sDue = number(s.dueAmount);
      const sPaid = number(s.paidAmount);
      const sGap = Math.round((sDue - sPaid) * 100) / 100;
      return `<tr>
        <td style="padding-left:24px">${escapeHtml(subFundLabel(s.subFundItemName ?? '', s.subFundName ?? '', s.subFundItemTypeDesc))}</td>
        <td>${amount(sDue)}</td>
        <td>${amount(sPaid)}</td>
        <td class="${sGap > 0.005 ? 'negative' : 'zero'}">${amount(Math.max(0, sGap))}</td>
        <td class="${number(s.tobeRefundAmount) > 0.005 ? 'negative' : 'zero'}">${amount(s.tobeRefundAmount)}</td>
      </tr>`;
    }).join('');
    return `
      <tr>
        <td><b>${escapeHtml(pool.fundName || pool.poolTypeDesc || '款项')}</b>
          <span class="leg-id" title="${escapeHtml(pool.poolId ?? '')}">${escapeHtml(shortId(pool.poolId ?? ''))}</span></td>
        <td>${amount(due)}</td>
        <td>${amount(paid)}</td>
        <td class="${gap > 0.005 ? 'negative' : 'zero'}">${amount(Math.max(0, gap))}</td>
        <td class="${number(pool.tobeRefundAmount) > 0.005 ? 'negative' : 'zero'}">${amount(pool.tobeRefundAmount)}</td>
      </tr>
      ${subs}`;
  }).join('');

  const due = pools.reduce((s, p) => s + cents(p.fundAmount), 0) / 100;
  const paid = pools.reduce((s, p) => s + cents(p.paidAmount), 0) / 100;

  return `
    <div class="card">
      <div class="card-head">
        <span style="width:3px;height:14px;border-radius:2px;background:${poolColor('FUND')};display:inline-block"></span>
        <h3>整装款项</h3>
        <span class="sub">${pools.length} 个款项</span>
        <span class="right">应收 ${amount(due)} · 实收 ${amount(paid)}</span>
      </div>
      <div class="card-body">
        <table class="subfunds">
          <thead><tr><th>款项 / 子款项</th><th>应收</th><th>实收</th><th>待付</th><th>待退</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function ctSection(pools: FundPool[], ctx: ViewContext): string {
  if (!pools.length) return '';
  const byCt = new Map<string, FundPool[]>();
  pools.forEach((pool) => {
    const key = pool.compositOrderNo || '未关联组合单';
    byCt.set(key, [...(byCt.get(key) ?? []), pool]);
  });

  const groups = [...byCt.entries()].map(([ct, list]) => {
    const rows = list.map((pool) => `
      <div class="dist-row" data-pool="${escapeHtml(pool.poolId ?? '')}">
        <span>📦</span>
        <span>
          <span class="dr-name">${escapeHtml(pool.poolTypeDesc || '商品子单')}</span>
          <span class="leg-id" title="${escapeHtml(pool.poolId ?? '')}">${escapeHtml(pool.poolId ?? '')}</span>
          <span class="dr-sub">${pool.entryCount ?? 0} 笔流水</span>
        </span>
        <span class="dr-amount">${amount(pool.balance)}</span>
        <span class="dr-sub">实收余额</span>
      </div>`).join('');
    return `
      <div class="ct-group">
        <div class="ct-head">
          <span>🧾</span><b>${escapeHtml(ct)}</b>
          <span class="sub">${list.length} 个子单</span>
          <span class="right">${amount(totalBalance(list))} 元</span>
        </div>
        <div class="ct-body">${rows}</div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-head">
        <span style="width:3px;height:14px;border-radius:2px;background:${poolColor('SUB_ORDER')};display:inline-block"></span>
        <h3>商品订单</h3>
        <span class="sub">按 CT 组合单归集</span>
        <span class="right">余额合计 ${amount(totalBalance(pools))} 元</span>
      </div>
      <div class="card-body">${groups}</div>
    </div>`;
}

function advanceSection(pools: FundPool[]): string {
  if (!pools.length) return '';
  const rows = pools.map((pool) => {
    const disp = poolDisplay(pool.poolId ?? '', pool.poolType, pool);
    return `
      <div class="dist-row" data-pool="${escapeHtml(pool.poolId ?? '')}">
        <span>${disp.icon}</span>
        <span>
          <span class="dr-name">${escapeHtml(disp.name)}</span>
          <span class="leg-id" title="${escapeHtml(disp.fullId)}">${escapeHtml(disp.fullId)}</span>
          <span class="dr-sub">${escapeHtml(disp.note || '')} ${pool.entryCount ?? 0} 笔流水</span>
        </span>
        <span class="dr-amount">${amount(pool.balance)}</span>
        <span class="dr-sub">可用余额</span>
      </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-head">
        <span style="width:3px;height:14px;border-radius:2px;background:${poolColor('ADVANCE')};display:inline-block"></span>
        <h3>预收款 / 首期款</h3>
        <span class="sub">先收后抵扣</span>
        <span class="right">余额合计 ${amount(totalBalance(pools))} 元</span>
      </div>
      <div class="card-body">${rows}</div>
    </div>`;
}

export function renderOrders(target: HTMLElement, ctx: ViewContext): void {
  const funds = ctx.pools.filter((p) => p.poolType === 'FUND');
  const subs = ctx.pools.filter((p) => p.poolType === 'SUB_ORDER');
  const advances = ctx.pools.filter((p) => p.poolType === 'ADVANCE');

  target.innerHTML = `
    <div class="view-head">
      <h2>订单与款项</h2>
      <p>按业务结构看钱：整装款项拆到子款项（首期款/开工款/尾款/增项款）的应收与实收，商品订单按 CT 组合单归集。点任一行跳到该资金池的收支明细。</p>
    </div>
    ${fundSection(funds)}
    ${ctSection(subs, ctx)}
    ${advanceSection(advances)}
    ${!funds.length && !subs.length && !advances.length ? '<div class="empty">没有订单或款项数据</div>' : ''}`;

  target.querySelectorAll<HTMLElement>('[data-pool]').forEach((node) => {
    node.addEventListener('click', () => ctx.goView('pools', node.dataset.pool));
  });
}
