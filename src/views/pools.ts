/**
 * 资金去向（客户）/ 资金池账本（服务者）—— 同一个组件，两种字段密度。
 *
 * 每个资金池一张卡：余额、入金从哪来、出金到哪去。
 * 对手方直接取同一 transferGroupId 里反方向的腿，不做配对推测；
 * 一个组有多条反方向腿时如实写「N 个来源/去处」，展开抽屉看拆分。
 */

import { amount, escapeHtml, fmtTime, number, type FundPool, type LedgerEntry } from '../api';
import { poolColor, POOL_TYPE_ORDER, type ViewContext } from '../context';
import { SUB_FUND_ITEM_TYPES } from '../codes';
import { legDisplay, poolDisplay, poolsByType, totalBalance } from '../groups';
import { renderFlowMap, type LaneMode } from '../charts/flowmap';
import { renderWaterfall } from '../charts/waterfall';

const expanded = new Set<string>();
let laneMode: LaneMode = 'type';


/** 子款项展示名：名字里已经含了类型（如「增项款4656」）就不再补类型后缀。 */
function subFundLabel(itemName: string, fallbackName: string, itemType?: number): string {
  const name = itemName || fallbackName || '—';
  const typeName = itemType != null ? SUB_FUND_ITEM_TYPES[itemType] ?? '' : '';
  return typeName && !name.includes(typeName) ? `${name}（${typeName}）` : name;
}

function cents(v: unknown): number {
  return Math.round(number(v) * 100);
}

/** 这条腿的对手方（同组反方向的腿）。 */
function counterparty(entry: LedgerEntry, ctx: ViewContext): string {
  const group = ctx.groupByEntryId.get(entry.entryId ?? '');
  if (!group) return '—';
  const others = entry.direction === 'INFLOW' ? group.outLegs : group.inLegs;
  if (!others.length) return `${group.info.label}（无对端腿）`;
  const ids = [...new Set(others.map((leg) => leg.accountId ?? ''))];
  if (ids.length === 1) {
    const disp = legDisplay(others[0], ctx.index);
    return `${disp.icon} ${disp.name}${disp.shortId ? ` ${disp.shortId}` : ''}`;
  }
  return `${ids.length} 个${entry.direction === 'INFLOW' ? '来源' : '去处'}`;
}

function ioColumn(entries: LedgerEntry[], ctx: ViewContext, title: string, inflow: boolean): string {
  if (!entries.length) return `<div class="io-col"><h4>${escapeHtml(title)}</h4><div class="empty" style="padding:12px">无</div></div>`;
  const sum = entries.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const lines = entries.map((entry) => {
    const group = ctx.groupByEntryId.get(entry.entryId ?? '');
    return `
      <div class="io-line" data-drawer="${escapeHtml(group?.groupId ?? '')}" title="${escapeHtml(fmtTime(entry.finishTime))}">
        <span class="t">${escapeHtml(fmtTime(entry.finishTime).slice(5, 10))}</span>
        <span>
          ${escapeHtml(entry.fundActionDesc ?? '')}
          <span class="dr-sub" style="display:block;color:var(--ink-3);font-size:11.5px">${inflow ? '来自' : '去向'} ${escapeHtml(counterparty(entry, ctx))}</span>
        </span>
        <span class="a ${inflow ? 'amount-in' : 'amount-out'}">${inflow ? '+' : '−'}${amount(entry.amount)}</span>
      </div>`;
  }).join('');
  return `
    <div class="io-col">
      <h4>${escapeHtml(title)}（${entries.length} 笔）</h4>
      ${lines}
      <div class="io-sum"><span>合计</span><span class="${inflow ? 'amount-in' : 'amount-out'}">${inflow ? '+' : '−'}${amount(sum)}</span></div>
    </div>`;
}

function subFundTable(pool: FundPool): string {
  const subs = pool.subFunds ?? [];
  if (!subs.length) return '';
  const rows = subs.map((s) => {
    const due = number(s.dueAmount);
    const paid = number(s.paidAmount);
    const gap = Math.round((due - paid) * 100) / 100;
    return `<tr>
      <td>${escapeHtml(subFundLabel(s.subFundItemName ?? '', s.subFundName ?? '', s.subFundItemType))}</td>
      <td>${amount(due)}</td>
      <td>${amount(paid)}</td>
      <td class="${gap > 0 ? 'negative' : 'zero'}">${amount(gap)}</td>
      <td class="${number(s.tobeRefundAmount) > 0 ? 'negative' : 'zero'}">${amount(s.tobeRefundAmount)}</td>
    </tr>`;
  }).join('');
  const totalDue = subs.reduce((s, x) => s + cents(x.dueAmount), 0) / 100;
  const totalPaid = subs.reduce((s, x) => s + cents(x.paidAmount), 0) / 100;
  return `
    <h4 style="margin:14px 0 4px;font-size:12px;color:var(--ink-2)">子款项</h4>
    <table class="subfunds">
      <thead><tr><th>款项</th><th>应收</th><th>实收</th><th>待付</th><th>待退</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>合计</td><td>${amount(totalDue)}</td><td>${amount(totalPaid)}</td>
        <td class="${totalDue - totalPaid > 0.005 ? 'negative' : 'zero'}">${amount(Math.max(0, totalDue - totalPaid))}</td><td></td></tr></tfoot>
    </table>`;
}

function verifyLine(pool: FundPool): string {
  const v = pool.balanceVerify;
  if (!v) return '';
  if (!v.balanceSource) return '<div class="verify-line">派生池，无独立余额表，跳过校验</div>';
  const ok = v.passed !== false;
  return `<div class="verify-line">
    ${ok ? '✓ 余额校验通过' : '✕ 余额校验不通过'} ·
    余额源 ${escapeHtml(v.balanceSource)} ·
    账本 ${amount(v.ledgerBalance)} / 源表 ${v.dbBalance == null ? '无记录' : amount(v.dbBalance)} · 差额 ${amount(v.diff)}
    <br>${escapeHtml(v.verifyNote ?? '')}
  </div>`;
}

function poolCard(pool: FundPool, ctx: ViewContext): string {
  const id = pool.poolId ?? '';
  const disp = poolDisplay(id, pool.poolType, pool);
  const open = expanded.has(id);
  const entries = (pool.entries ?? []).slice()
    .sort((a, b) => String(a.finishTime ?? '').localeCompare(String(b.finishTime ?? '')));
  const ins = entries.filter((e) => e.direction === 'INFLOW');
  const outs = entries.filter((e) => e.direction === 'OUTFLOW');
  const inSum = ins.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const outSum = outs.reduce((s, e) => s + cents(e.amount), 0) / 100;

  const meta = [
    disp.shortId ? `<span title="${escapeHtml(disp.fullId)}">${escapeHtml(disp.fullId)}</span>` : '',
    disp.note ? `<span>${escapeHtml(disp.note)}</span>` : '',
    `<span>${entries.length} 笔流水</span>`,
    disp.scope === 'EXTERNAL' ? '<span>系统外实体虚拟池</span>' : '',
  ].filter(Boolean).join('');

  return `
    <div class="pool-card" data-card="${escapeHtml(id)}">
      <div class="pool-head" data-toggle="${escapeHtml(id)}">
        <span style="font-size:17px">${disp.icon}</span>
        <span>
          <div class="pool-name">${escapeHtml(disp.name)}</div>
          <div class="pool-meta">${meta}</div>
        </span>
        <span class="pool-balance">
          <span class="${number(pool.balance) < 0 ? 'negative' : number(pool.balance) > 0 ? '' : 'zero'}">${amount(pool.balance)}</span>
          <small>入 +${amount(inSum)} · 出 −${amount(outSum)}</small>
        </span>
      </div>
      ${open ? `<div class="pool-body">
        ${renderWaterfall(pool, ctx)}
        <div class="io">
          ${ioColumn(ins, ctx, '入金', true)}
          ${ioColumn(outs, ctx, '出金', false)}
        </div>
        ${subFundTable(pool)}
        ${verifyLine(pool)}
      </div>` : ''}
    </div>`;
}

export function renderPools(target: HTMLElement, ctx: ViewContext, focus?: string): void {
  if (focus) expanded.add(focus);
  const grouped = poolsByType(ctx.pools, POOL_TYPE_ORDER);

  const sections = grouped.map(({ type, list: pools }) => {
    const total = totalBalance(pools);
    const label = poolDisplay('', type).name;
    return `
      <div class="card">
        <div class="card-head">
          <span style="width:3px;height:14px;border-radius:2px;background:${poolColor(type)};display:inline-block"></span>
          <h3>${escapeHtml(label)}</h3>
          <span class="sub">${pools.length} 个池</span>
          <span class="right">余额合计 ${amount(total)} 元</span>
        </div>
        <div class="card-body">${pools.map((pool) => poolCard(pool, ctx)).join('')}</div>
      </div>`;
  }).join('');

  target.innerHTML = `
    <div class="view-head">
      <h2>资金流向</h2>
      <p>上方按时间看钱在资金池之间怎么走，下方是逐池账本、余额瀑布与源表校验。点图上任意一列看该次操作的证据链，点泳道名展开对应池账本。</p>
    </div>
    ${renderFlowMap(ctx, laneMode)}
    ${sections || '<div class="empty">没有资金池数据</div>'}`;

  target.querySelectorAll<HTMLElement>('[data-toggle]').forEach((node) => {
    node.addEventListener('click', () => {
      const id = node.dataset.toggle as string;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      renderPools(target, ctx);
    });
  });
  target.querySelectorAll<HTMLElement>('[data-lane-mode]').forEach((node) => {
    node.addEventListener('click', () => {
      laneMode = node.dataset.laneMode as LaneMode;
      renderPools(target, ctx);
    });
  });
  target.querySelectorAll<HTMLElement>('[data-group]').forEach((node) => {
    node.addEventListener('click', () => ctx.openGroup(node.dataset.group as string));
  });
  target.querySelectorAll<HTMLElement>('[data-lane]').forEach((node) => {
    node.addEventListener('click', () => {
      const ids = (node.dataset.lane ?? '').split(',').filter(Boolean);
      ids.forEach((id) => expanded.add(id));
      renderPools(target, ctx, ids[0]);
    });
  });
  target.querySelectorAll<HTMLElement>('[data-drawer]').forEach((node) => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = node.dataset.drawer;
      if (id) ctx.openGroup(id);
    });
  });

  if (focus) target.querySelector(`[data-card="${focus}"]`)?.scrollIntoView({ block: 'center' });
}
