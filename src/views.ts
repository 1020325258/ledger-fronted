/**
 * 视图层：把归一化后的账本数据渲染成各个区块。
 *
 * 概览条（两个视角共用）→ 客户视角（我的钱在哪 / 资金旅程）→
 * 服务者视角（流向图 / 交易组 / 资金池层级 / 验证面板 / 平铺明细）。
 */

import type * as echarts from 'echarts';
import {
  amount, balanceClass, CASHIER_TYPES, compactNumber, escapeHtml, fmtTime,
  number, POOL_TYPE_ICONS, POOL_TYPE_LABELS, poolIndex, shortPoolId, text,
  type FundPool, type Ledger, type LedgerEntry,
} from './api';

// ============ 概览条 ============

export function renderConservation(target: HTMLElement, data: Ledger): void {
  const balanced = data.isBalanced !== false;
  const warnings = data.warnings ?? [];
  target.className = `conservation-check${balanced ? '' : ' error'}`;
  target.innerHTML = `
    <div class="conservation-head">
      <h4>${balanced ? '✅ 资金守恒校验通过' : '❌ 资金守恒校验失败'}</h4>
      <span class="conservation-badge ${balanced ? 'ok' : 'bad'}">${balanced ? '账账相符' : '存在差异'}</span>
    </div>
    <p>${escapeHtml(text(data.balanceCheckMessage) || '账本资金已完成守恒校验')}</p>
    ${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>⚠️ ${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
  `;
}

export function renderStats(target: HTMLElement, data: Ledger): void {
  const items: Array<[string, unknown, string, string]> = [
    ['客户累计实付', data.customerTotalPay, 'income', '真正从客户口袋进入系统的钱'],
    ['客户累计退款', data.customerTotalRefund, 'expense', '退回客户口袋的钱'],
    ['客户净投入', data.customerNetInvestment, 'balance', '实付 − 退款'],
    ['系统内余额', data.systemBalance, '', '所有系统内资金池余额之和'],
  ];
  target.innerHTML = items.map(([label, value, css, tip]) => `
    <div class="stat-card ${css}" title="${escapeHtml(tip)}">
      <div class="label">${label}</div>
      <div class="value">${amount(value)}<span class="unit">元</span></div>
    </div>
  `).join('');

  const split = document.querySelector<HTMLDivElement>('#splitNote');
  if (split) {
    split.innerHTML = data.systemInternalBalance != null || data.externalBalance != null
      ? `系统内 ${amount(data.systemInternalBalance)} 元 · 系统外(客户/开发商) ${amount(data.externalBalance)} 元`
      : '';
  }
}

// ============ 客户视角 ============

/** 我的钱在哪：实付/退款/净投入 + 系统内余额分布（含已退回客户） */
export function renderWhereMoney(target: HTMLElement, data: Ledger, entries: LedgerEntry[], pools: FundPool[]): void {
  const totalPay = number(data.customerTotalPay);
  const totalRefund = number(data.customerTotalRefund);
  const net = number(data.customerNetInvestment);
  const system = number(data.systemBalance);

  // 系统内分布：按池类型聚合非零池
  const byType = new Map<string, { pools: FundPool[]; total: number }>();
  for (const pool of pools) {
    if (pool.poolScope === 'EXTERNAL') continue;
    const type = pool.poolType || 'OTHER';
    const group = byType.get(type) ?? { pools: [], total: 0 };
    group.pools.push(pool);
    group.total += number(pool.balance);
    byType.set(type, group);
  }
  const distribution = [...byType.entries()]
    .filter(([, g]) => Math.abs(g.total) >= 0.005)
    .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
  const maxAbs = Math.max(...distribution.map(([, g]) => Math.abs(g.total)), totalRefund, 1);

  target.innerHTML = `
    <div class="wm-grid">
      <div class="wm-card wm-pay"><div class="wm-label">你累计支付</div><div class="wm-value">${amount(totalPay)}<span>元</span></div></div>
      <div class="wm-card wm-refund"><div class="wm-label">已退回你</div><div class="wm-value">${amount(totalRefund)}<span>元</span></div></div>
      <div class="wm-card wm-net"><div class="wm-label">净投入</div><div class="wm-value">${amount(net)}<span>元</span></div></div>
      <div class="wm-card wm-system"><div class="wm-label">当前系统内</div><div class="wm-value">${amount(system)}<span>元</span></div></div>
    </div>

    <div class="wm-distribution">
      <div class="wm-bar">
        ${distribution.map(([type, g]) => `
          <div class="wm-seg" style="width:${(Math.abs(g.total) / maxAbs * 100).toFixed(1)}%;background:${TYPE_COLORS[type] ?? '#999'}"
            title="${POOL_TYPE_LABELS[type] ?? type} ${amount(g.total)} 元"></div>`).join('')}
        ${totalRefund > 0 ? `<div class="wm-seg wm-seg-refund" style="width:${(totalRefund / maxAbs * 100).toFixed(1)}%"
            title="已退回客户 ${amount(totalRefund)} 元"></div>` : ''}
      </div>
      <div class="wm-legend">
        ${distribution.map(([type, g]) => `
          <span><i style="background:${TYPE_COLORS[type] ?? '#999'}"></i>${POOL_TYPE_LABELS[type] ?? type} ${amount(g.total)} 元</span>`).join('')}
        ${totalRefund > 0 ? `<span><i class="wm-legend-refund"></i>已退回你 ${amount(totalRefund)} 元</span>` : ''}
      </div>
    </div>

    <div class="wm-pools">
      ${distribution.flatMap(([type, g]) => g.pools
        .filter((p) => Math.abs(number(p.balance)) >= 0.005)
        .map((p) => `
          <div class="wm-pool">
            <div class="wm-pool-name">${POOL_TYPE_ICONS[type] ?? '📋'} ${escapeHtml(p.fundName ? `【${p.fundName}】` : '')}${escapeHtml(shortPoolId(p.poolId ?? ''))}
              <span class="wm-pool-type">${escapeHtml(p.poolTypeDesc ?? POOL_TYPE_LABELS[type] ?? type)}</span></div>
            <div class="wm-pool-balance ${balanceClass(p.balance)}">${amount(p.balance)} 元</div>
          </div>`)).join('')}
      ${totalRefund > 0 ? `
        <div class="wm-pool">
          <div class="wm-pool-name">↩️ 已退回客户 <span class="wm-pool-type">原路返还/余额</span></div>
          <div class="wm-pool-balance negative">−${amount(totalRefund)} 元</div>
        </div>` : ''}
      ${!distribution.length && !totalRefund ? '<p class="empty">暂无可展示的资金分布</p>' : ''}
    </div>
    <p class="wm-tip">守恒说明：${escapeHtml(text(data.balanceCheckMessage))}</p>
  `;
}

/** 客户资金旅程：客户/余额池的每笔资金变化 + 交易组对端 */
export function renderTimeline(target: HTMLElement, entries: LedgerEntry[], pools: FundPool[]): void {
  const index = poolIndex(pools);
  const legsByGroup = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    if (!e.transferGroupId) continue;
    const list = legsByGroup.get(e.transferGroupId) ?? [];
    list.push(e);
    legsByGroup.set(e.transferGroupId, list);
  }

  const mine = entries
    .filter((e) => e.accountType === 'CUSTOMER' || e.accountType === 'WALLET')
    .sort((a, b) => String(a.finishTime ?? '').localeCompare(String(b.finishTime ?? '')));
  if (!mine.length) {
    target.innerHTML = '<p class="empty">没有客户侧资金变动记录</p>';
    return;
  }

  // 按日期分组的纵向时间线
  const byDate = new Map<string, LedgerEntry[]>();
  for (const e of mine) {
    const day = fmtTime(e.finishTime).slice(0, 10);
    const list = byDate.get(day) ?? [];
    list.push(e);
    byDate.set(day, list);
  }

  target.innerHTML = [...byDate.entries()].map(([day, list]) => `
    <div class="tl-day">
      <div class="tl-day-label">${day}</div>
      <div class="tl-items">
        ${list.map((e) => timelineItem(e, index, legsByGroup)).join('')}
      </div>
    </div>`).join('');
}

function timelineItem(
  entry: LedgerEntry,
  index: Map<string, FundPool>,
  legsByGroup: Map<string, LedgerEntry[]>,
): string {
  const inflow = entry.direction === 'INFLOW';
  const cashierType = entry.metadata?.cashierType as number | undefined;
  const txnNo = entry.metadata?.transactionNo as string | undefined;
  const counter = (legsByGroup.get(entry.transferGroupId ?? '') ?? [])
    .filter((leg) => leg.entryId !== entry.entryId);
  const counterHtml = counter.length ? `
    <div class="tl-counter">
      ${counter.map((leg) => {
        const legIn = leg.direction === 'INFLOW';
        const pool = index.get(leg.accountId ?? '');
        const label = POOL_TYPE_LABELS[leg.accountType ?? ''] ?? leg.accountType ?? '';
        const icon = POOL_TYPE_ICONS[leg.accountType ?? ''] ?? '📋';
        const desc = `${inflow ? '来自' : '去向'}：${icon} ${escapeHtml(label)} ${escapeHtml(shortPoolId(leg.accountId ?? ''))}`
          + `${pool?.fundName ? ` ${escapeHtml(pool.fundName)}` : ''} · ${leg.fundActionDesc ?? ''} ${legIn ? '+' : '−'}${amount(leg.amount)} 元`;
        return `<span class="tl-counter-leg">${desc}</span>`;
      }).join('')}
    </div>` : '';
  return `
    <div class="tl-item ${inflow ? 'tl-in' : 'tl-out'}">
      <div class="tl-time">${fmtTime(entry.finishTime).slice(11)}</div>
      <div class="tl-body">
        <div class="tl-title">
          <span class="tag ${inflow ? 'tag-in' : 'tag-out'}">${inflow ? '入账' : '支出'}</span>
          <strong>${escapeHtml(entry.fundActionDesc ?? '')}</strong>
          <span class="tl-amount ${inflow ? 'amount-positive' : 'amount-negative'}">${inflow ? '+' : '−'}${amount(entry.amount)} 元</span>
        </div>
        <div class="tl-meta">
          ${cashierType ? `<span>渠道：${escapeHtml(CASHIER_TYPES[cashierType] ?? String(cashierType))}</span>` : ''}
          ${txnNo ? `<span class="mono">流水：${escapeHtml(txnNo)}</span>` : ''}
          <span>${entry.accountType === 'WALLET' ? '客户余额池' : '客户钱包'}</span>
        </div>
        ${counterHtml}
      </div>
    </div>`;
}

// ============ 图表 ============

export function renderCharts(
  data: Ledger,
  poolChart: echarts.ECharts | undefined,
  rankChart: echarts.ECharts | undefined,
  create: (el: HTMLDivElement) => echarts.ECharts,
): { poolChart: echarts.ECharts | undefined; rankChart: echarts.ECharts | undefined } {
  const pools = data.pools ?? [];

  const totals = new Map<string, number>();
  pools.forEach((pool) => {
    const type = (pool.poolType && pool.poolType in POOL_TYPE_LABELS ? pool.poolType : 'OTHER') as string;
    totals.set(type, (totals.get(type) ?? 0) + number(pool.balance));
  });
  const typeRows = [...totals].filter(([, value]) => Math.abs(value) >= 0.005);

  poolChart ??= create(document.querySelector<HTMLDivElement>('#poolBalanceChart')!);
  poolChart.setOption({
    grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactNumber(v) }, splitLine: { lineStyle: { type: 'dashed' } } },
    yAxis: { type: 'category', axisTick: { show: false }, data: typeRows.map(([type]) => `${POOL_TYPE_ICONS[type] ?? '📋'} ${POOL_TYPE_LABELS[type] ?? type}`) },
    series: [{
      type: 'bar', barWidth: '58%',
      data: typeRows.map(([type, value]) => ({
        value,
        itemStyle: { color: TYPE_COLORS[type] ?? '#999', borderRadius: [0, 4, 4, 0] },
      })),
      label: { show: true, position: 'right', fontSize: 11, formatter: (p: { value: number }) => `${amount(p.value)} 元` },
    }],
  }, true);

  const ranked = pools
    .filter((pool) => Math.abs(number(pool.balance)) >= 0.005)
    .sort((left, right) => Math.abs(number(right.balance)) - Math.abs(number(left.balance)))
    .slice(0, 12)
    .reverse();
  rankChart ??= create(document.querySelector<HTMLDivElement>('#poolRankChart')!);
  rankChart.setOption({
    grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const pool = ranked[p.dataIndex];
        return `${escapeHtml(pool.poolId ?? '')}<br>${escapeHtml(pool.poolTypeDesc ?? '')}`
          + `<br><strong>${amount(pool.balance)} 元</strong>`;
      },
    },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactNumber(v) }, splitLine: { lineStyle: { type: 'dashed' } } },
    yAxis: {
      type: 'category', axisTick: { show: false },
      data: ranked.map((pool) => shortPoolId(pool.poolId ?? '')),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      type: 'bar', barWidth: '62%',
      data: ranked.map((pool) => {
        const type = (pool.poolType && pool.poolType in POOL_TYPE_LABELS ? pool.poolType : 'OTHER') as string;
        return { value: number(pool.balance), itemStyle: { color: TYPE_COLORS[type] ?? '#999', borderRadius: [0, 4, 4, 0] } };
      }),
      label: { show: true, position: 'right', fontSize: 11, formatter: (p: { value: number }) => amount(p.value) },
    }],
  }, true);
  return { poolChart, rankChart };
}

// ============ 服务者视角：交易组明细 ============

const GROUP_TYPE_LABELS: Record<string, string> = {
  CUST_PAY: '客户支付',
  ADVANCE_REFUND: '预收款退款',
  ORDER_REFUND: '子单退款',
  WALLET_DEDUCT: '余额抵扣',
  FUND_PAY: '整装支付',
  FUND_REFUND: '整装退款',
  FUND_DEDUCT: '整装抵扣',
  REFUND_TO_CUSTOMER: '退款到客户',
};

export function renderTxnGroups(target: HTMLElement, entries: LedgerEntry[]): void {
  const groups = new Map<string, LedgerEntry[]>();
  const ungrouped: LedgerEntry[] = [];
  for (const e of entries) {
    if (e.transferGroupId) {
      const list = groups.get(e.transferGroupId) ?? [];
      list.push(e);
      groups.set(e.transferGroupId, list);
    } else {
      ungrouped.push(e);
    }
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    String(maxTime(b[1])).localeCompare(String(maxTime(a[1]))));

  if (!ordered.length && !ungrouped.length) {
    target.innerHTML = '<p class="empty">暂无交易组数据</p>';
    return;
  }

  target.innerHTML = `
    ${ordered.map(([groupId, list]) => txnGroupCard(groupId, list)).join('')}
    ${ungrouped.length ? `
      <div class="txn-group txn-orphan">
        <div class="txn-head">
          <h4>⚠️ 未配对流水（无 transferGroupId）<span class="txn-legs">${ungrouped.length} 条</span></h4>
        </div>
        ${txnLegsTable(ungrouped)}
      </div>` : ''}
    <p class="txn-count">共 ${ordered.length} 个交易组${ungrouped.length ? ` + ${ungrouped.length} 条未配对流水` : ''}</p>
  `;
  wireTxnToggle(target);
}

function txnGroupCard(groupId: string, list: LedgerEntry[]): string {
  const groupType = list.find((e) => e.groupType)?.groupType ?? '';
  const inflow = list.filter((e) => e.direction === 'INFLOW').reduce((s, e) => s + number(e.amount), 0);
  const outflow = list.filter((e) => e.direction === 'OUTFLOW').reduce((s, e) => s + number(e.amount), 0);
  const diff = Math.abs(inflow - outflow);
  const balanced = diff <= 0.01;
  const hasPending = list.some((e) => e.status && e.status !== 'SUCCESS');
  const title = GROUP_TYPE_LABELS[groupType] ?? groupType ?? '跨池流转';
  return `
    <div class="txn-group ${balanced ? '' : 'txn-bad'}">
      <button type="button" class="txn-head" aria-expanded="false">
        <span class="txn-title">${escapeHtml(title)}</span>
        <code class="txn-group-id" title="${escapeHtml(groupId)}">${escapeHtml(shortPoolId(groupId))}</code>
        <span class="txn-status ${balanced ? (hasPending ? 'pending' : 'ok') : 'bad'}">
          ${balanced ? (hasPending ? '含执行中' : '守恒 ✓') : `差 ${amount(diff)} 元`}
        </span>
        <span class="txn-legs">${list.length} 条腿</span>
        <span class="txn-arrow">▾</span>
      </button>
      <div class="txn-body" hidden>${txnLegsTable(list)}</div>
    </div>`;
}

function txnLegsTable(list: LedgerEntry[]): string {
  const rows = list
    .slice()
    .sort((a, b) => String(a.finishTime ?? '').localeCompare(String(b.finishTime ?? '')))
    .map((e) => {
      const inflow = e.direction === 'INFLOW';
      const txnNo = e.metadata?.transactionNo as string | undefined;
      const typeLabel = POOL_TYPE_LABELS[e.accountType ?? ''] ?? e.accountType ?? '';
      return `<tr>
        <td class="mono">${fmtTime(e.finishTime)}</td>
        <td><span class="tag ${inflow ? 'tag-in' : 'tag-out'}">${inflow ? '入' : '出'}</span>
          <strong>${escapeHtml(e.fundActionDesc ?? '')}</strong>
          <span class="flat-acct-type">${escapeHtml(typeLabel)} · ${escapeHtml(shortPoolId(e.accountId ?? ''))}</span></td>
        <td class="num ${inflow ? 'amount-positive' : 'amount-negative'}">${inflow ? '+' : '−'}${amount(e.amount)}</td>
        <td class="mono">${escapeHtml(txnNo ?? '—')}</td>
        <td class="mono">${escapeHtml(e.sourceTable ?? '')}</td>
        <td>${escapeHtml(e.status ?? '')}</td>
      </tr>`;
    }).join('');
  return `<div class="flat-table-wrap"><table class="flat-table txn-table">
    <thead><tr><th>时间</th><th>资金动作（腿）</th><th class="num">金额(元)</th><th>流水号</th><th>数据源</th><th>状态</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function wireTxnToggle(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('.txn-head').forEach((head) => {
    head.addEventListener('click', () => {
      const expanded = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!expanded));
      const body = head.nextElementSibling as HTMLElement | null;
      if (body) body.hidden = expanded;
    });
  });
}

function maxTime(list: LedgerEntry[]): string | number | null {
  return list.reduce<string | number | null>(
    (acc, e) => (String(e.finishTime ?? '').localeCompare(String(acc ?? '')) > 0 ? (e.finishTime ?? null) : acc),
    null,
  );
}

// ============ 服务者视角：资金池层级 ============

const TYPE_ORDER = ['ADVANCE', 'SUB_ORDER', 'FUND', 'WALLET', 'CUSTOMER', 'DEVELOPER', 'OTHER'];

export function renderCtOrders(target: HTMLElement, pools: FundPool[]): void {
  const groups = new Map<string, FundPool[]>();
  pools
    .filter((pool) => pool.poolType === 'SUB_ORDER' && pool.compositOrderNo)
    .forEach((pool) => groups.set(pool.compositOrderNo!, [...(groups.get(pool.compositOrderNo!) ?? []), pool]));
  const orders = [...groups.entries()]
    .map(([ctOrderNo, sOrders]) => ({
      ctOrderNo,
      totalAmount: sOrders.reduce((sum, pool) => sum + number(pool.balance), 0),
      sOrders,
    }))
    .sort((left, right) => (left.ctOrderNo ?? '').localeCompare(right.ctOrderNo ?? ''));

  if (!orders.length) { target.innerHTML = '<p class="empty">暂无CT单数据</p>'; return; }
  target.innerHTML = orders.map((ct) => `
    <div class="ct-order-card">
      <h4><span>📦 CT单: ${escapeHtml(ct.ctOrderNo || '未知')}</span><span class="pool-balance positive">${amount(ct.totalAmount)} 元</span></h4>
      <p class="sub-count">下属 ${ct.sOrders.length} 个S单</p>
      <div class="s-order-nested">${ct.sOrders.map(renderNestedPool).join('')}</div>
    </div>`).join('');
}

function renderNestedPool(pool: FundPool): string {
  const isFu = (pool.poolTypeDesc ?? '').includes('整装');
  return `<div class="pool-card" style="border-color:${TYPE_COLORS[pool.poolType ?? ''] ?? '#52c41a'}">
    <h4><span>${isFu ? '🏠 FU单' : '📦 S单'}: ${escapeHtml(pool.poolId || '未知')}</span><span class="pool-balance ${balanceClass(pool.balance)}">${amount(pool.balance)} 元</span></h4>
    <div class="pool-entries">${(pool.entries ?? []).map(renderEntry).join('') || '<p class="empty">暂无明细</p>'}</div>
  </div>`;
}

export function renderPools(target: HTMLElement, pools: FundPool[]): void {
  if (!pools.length) { target.innerHTML = '<p class="empty">暂无资金池数据</p>'; return; }
  const groups = new Map<string, FundPool[]>();
  pools.forEach((pool) => groups.set(pool.poolType || 'OTHER', [...(groups.get(pool.poolType || 'OTHER') ?? []), pool]));
  target.innerHTML = TYPE_ORDER.map((type) => {
    const list = groups.get(type) ?? [];
    if (!list.length) return '';
    const total = list.reduce((sum, pool) => sum + number(pool.balance), 0);
    return `<div class="section-divider" id="pool-section-${type}">${POOL_TYPE_ICONS[type] ?? '📋'} ${POOL_TYPE_LABELS[type] ?? type} (${list.length}个) - 总余额: ${amount(total)} 元</div>
      ${list.map(renderPoolCard).join('')}`;
  }).join('');
}

function renderPoolCard(pool: FundPool): string {
  const poolId = pool.poolId || '未知资金池';
  const type = pool.poolType || 'OTHER';
  const verify = pool.balanceVerify;
  const metaBits = [
    pool.poolTypeDesc ? `类型: ${escapeHtml(pool.poolTypeDesc)}` : '',
    pool.poolScope === 'EXTERNAL' ? '系统外虚拟池' : '系统内记账池',
    pool.entryCount ?? pool.entries?.length ?? 0 ? `${pool.entryCount ?? pool.entries?.length ?? 0} 条记录` : '',
    pool.compositOrderNo ? `CT: ${escapeHtml(pool.compositOrderNo)}` : '',
    pool.projectOrderId ? `主单号: ${escapeHtml(pool.projectOrderId)}` : '',
  ].filter(Boolean);
  const fundInfo = pool.fundAmount != null || pool.paidAmount != null || pool.tobeRefundAmount != null ? `
    <div class="fund-info">
      <span>应收 ${amount(pool.fundAmount)}</span>
      <span>实收 ${amount(pool.paidAmount)}</span>
      <span>待退 ${amount(pool.tobeRefundAmount)}</span>
    </div>` : '';
  const subFunds = pool.subFunds?.length ? `
    <table class="sub-funds">
      <thead><tr><th>款项</th><th class="num">应收(元)</th><th class="num">实收(元)</th><th class="num">待退(元)</th></tr></thead>
      <tbody>${pool.subFunds.map((s) => `<tr>
        <td>${escapeHtml(s.subFundName ?? s.subFundItemName ?? '')}</td>
        <td class="num">${amount(s.dueAmount)}</td>
        <td class="num">${amount(s.paidAmount)}</td>
        <td class="num">${amount(s.tobeRefundAmount)}</td>
      </tr>`).join('')}</tbody>
    </table>` : '';
  return `
    <div class="pool-card" id="pool-${encodeURIComponent(poolId)}" style="border-color:${TYPE_COLORS[type] || '#666'}">
      <h4>
        <span>${pool.fundName ? `【${escapeHtml(pool.fundName)}】` : ''} ${escapeHtml(poolId)}
          ${verify ? `<span class="verify-badge ${verify.passed ? 'ok' : 'bad'}">${verify.passed ? '✓ 对账通过' : `✕ 差 ${amount(verify.diff)}`}</span>` : ''}
        </span>
        <span class="pool-balance ${balanceClass(pool.balance)}">${amount(pool.balance)} 元</span>
      </h4>
      <div class="pool-meta">${metaBits.join(' | ')}</div>
      ${fundInfo}
      ${subFunds}
      <div class="pool-entries">${(pool.entries ?? []).map(renderEntry).join('') || '<p class="empty">暂无明细</p>'}</div>
    </div>`;
}

function renderEntry(entry: LedgerEntry): string {
  const inflow = entry.direction === 'INFLOW';
  const cashierType = entry.metadata?.cashierType as number | undefined;
  const txnNo = entry.metadata?.transactionNo as string | undefined;
  const details = [
    cashierType ? `渠道: ${CASHIER_TYPES[cashierType] ?? cashierType}` : '',
    txnNo ? `流水号: ${txnNo}` : '',
    `时间: ${fmtTime(entry.finishTime)}`,
    entry.status && entry.status !== 'SUCCESS' ? `状态: ${entry.status}` : '',
  ].filter(Boolean);
  return `<div class="entry-row">
    <div class="entry-info">
      <div class="entry-desc"><span class="tag ${inflow ? 'tag-in' : 'tag-out'}">${inflow ? '入金' : '出金'}</span> ${escapeHtml(entry.fundActionDesc || '')}</div>
      <div class="entry-detail">${escapeHtml(details.join(' | '))}</div>
    </div>
    <div class="${inflow ? 'amount-positive' : 'amount-negative'}">${inflow ? '+' : '−'}${amount(number(entry.amount))} 元</div>
  </div>`;
}

// ============ 服务者视角：验证面板 ============

export function renderVerifyPanel(target: HTMLElement, data: Ledger): void {
  const bvs = data.balanceVerifySummary;
  const gvs = data.groupVerifySummary;
  const warnings = data.warnings ?? [];
  const cards: string[] = [];

  if (bvs && (bvs.poolCount != null || bvs.checkedCount != null)) {
    const passed = bvs.allPass;
    cards.push(`
      <div class="verify-card ${passed ? 'ok' : 'bad'}">
        <h5>💼 逐池余额验证 ${passed ? '全部通过' : '存在差异'}</h5>
        <div class="verify-metrics">
          <span>资金池 <b>${bvs.poolCount ?? '—'}</b></span>
          <span>已核对 <b>${bvs.checkedCount ?? '—'}</b></span>
          <span>通过 <b>${bvs.passedCount ?? '—'}</b></span>
          <span class="${bvs.mismatchCount ? 'bad' : ''}">不通过 <b>${bvs.mismatchCount ?? 0}</b></span>
          <span>跳过 <b>${bvs.skippedCount ?? 0}</b></span>
        </div>
        ${bvs.ruleDesc ? `<details><summary>校验口径</summary><p>${escapeHtml(bvs.ruleDesc)}</p></details>` : ''}
      </div>`);
  }
  if (gvs && (gvs.groupCount != null || gvs.checkedGroupCount != null)) {
    const passed = gvs.allPass;
    cards.push(`
      <div class="verify-card ${passed ? 'ok' : 'bad'}">
        <h5>🔗 跨池交易组守恒 ${passed ? '全部通过' : '存在缺腿/双计'}</h5>
        <div class="verify-metrics">
          <span>交易组 <b>${gvs.groupCount ?? '—'}</b></span>
          <span>已核对 <b>${gvs.checkedGroupCount ?? '—'}</b></span>
          <span>守恒 <b>${gvs.balancedGroupCount ?? '—'}</b></span>
          <span class="${gvs.unbalancedGroupCount ? 'bad' : ''}">不守恒 <b>${gvs.unbalancedGroupCount ?? 0}</b></span>
          <span>执行中 <b>${gvs.pendingGroupCount ?? 0}</b></span>
          <span>单边 <b>${gvs.singleSidedGroupCount ?? 0}</b></span>
        </div>
        ${gvs.ruleDesc ? `<details><summary>校验口径</summary><p>${escapeHtml(gvs.ruleDesc)}</p></details>` : ''}
        ${(gvs.mismatchDetails ?? []).length ? `
          <div class="verify-mismatches">${gvs.mismatchDetails!.map((m) => `<p>⚠️ ${escapeHtml(JSON.stringify(m))}</p>`).join('')}</div>` : ''}
      </div>`);
  }
  if (warnings.length) {
    cards.push(`
      <div class="verify-card warn">
        <h5>⚠️ 资金池归属告警（${warnings.length}）</h5>
        <ul class="warnings">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </div>`);
  }
  target.innerHTML = cards.length ? cards.join('') : '<p class="empty">未开启校验（verify=false）或接口未返回验证信息</p>';
}

// ============ 平铺明细 ============

export function renderFlatTable(target: HTMLElement, entries: LedgerEntry[]): void {
  if (!entries.length) { target.innerHTML = '<p class="empty">暂无账本明细</p>'; return; }
  const rows = entries.map((entry) => {
    const inflow = entry.direction === 'INFLOW';
    const txnNo = entry.metadata?.transactionNo as string | undefined;
    const acctLabel = POOL_TYPE_LABELS[entry.accountType ?? ''] ?? (entry.accountType ?? '');
    return `<tr>
      <td class="flat-time">${fmtTime(entry.finishTime)}</td>
      <td><span class="flat-acct">${escapeHtml(entry.accountId ?? '')}</span><span class="flat-acct-type">${escapeHtml(acctLabel)}</span></td>
      <td><span class="tag ${inflow ? 'tag-in' : 'tag-out'}">${inflow ? '入金' : '出金'}</span></td>
      <td class="num ${inflow ? 'amount-positive' : 'amount-negative'}">${inflow ? '+' : '−'}${amount(number(entry.amount))}</td>
      <td>${escapeHtml(entry.fundActionDesc || '')}</td>
      <td class="mono">${escapeHtml(txnNo || '—')}</td>
      <td>${escapeHtml(entry.sourceTable || '')}</td>
      <td class="mono">${escapeHtml(entry.transferGroupId ?? '—')}</td>
    </tr>`;
  }).join('');
  target.innerHTML = `<div class="flat-table-wrap">
    <table class="flat-table">
      <thead><tr><th>时间</th><th>账户</th><th>方向</th><th class="num">金额(元)</th><th>资金动作</th><th>流水号</th><th>数据源</th><th>交易组</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="flat-count">共 ${entries.length} 条记录</p>
  </div>`;
}

const TYPE_COLORS: Record<string, string> = {
  CUSTOMER: '#eb2f96', ADVANCE: '#faad14', WALLET: '#1890ff',
  SUB_ORDER: '#52c41a', FUND: '#722ed1', DEVELOPER: '#13c2c2', OTHER: '#999999',
};
