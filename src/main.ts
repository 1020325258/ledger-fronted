import * as echarts from 'echarts';
import './style.css';
import {
  allEntries, amount, escapeHtml, fetchLedger, fmtTime, number, POOL_TYPE_ICONS,
  readUrlState, shortPoolId, writeUrlState,
  type FundPool, type Ledger, type LedgerEntry, type QueryState,
} from './api';
import {
  buildFlowGraph, formatSigned, formatYuan, POOL_TYPE_ICON, POOL_TYPE_LABEL,
  type FlowEdge, type FlowNode, type PoolTypeKey,
} from './flow';
import { renderFlowBoard } from './flowview';
import {
  renderCharts, renderConservation, renderCtOrders, renderFlatTable,
  renderPools, renderStats, renderTimeline, renderTxnGroups, renderVerifyPanel,
  renderWhereMoney,
} from './views';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('缺少页面根节点');

app.innerHTML = `
  <nav class="sidebar" id="sidebar">
    <div class="sidebar-header">📊 资金账本导航</div>
    <div class="sidebar-content" id="sidebarContent">
      <p class="sidebar-empty">请先查询账本</p>
    </div>
  </nav>
  <main class="container">
    <section class="header">
      <h1>💰 统一资金账本</h1>
      <p id="headerMeta">让客户与服务者对每一笔资金流向有一致的理解 · 数据来源: nrs-order-service</p>
    </section>

    <section class="query-section">
      <label for="projectInput">主单号：</label>
      <input id="projectInput" value="" placeholder="例如 826080616000002432" autocomplete="off">
      <label for="perspectiveSelect">视角：</label>
      <select id="perspectiveSelect">
        <option value="service" selected>🏢 服务者</option>
        <option value="customer">👤 客户</option>
      </select>
      <label for="modeSelect">展示：</label>
      <select id="modeSelect">
        <option value="grouped" selected>📦 按池分组</option>
        <option value="flat">📋 平铺明细</option>
      </select>
      <label class="verify-toggle">
        <input type="checkbox" id="verifyCheck" checked> 守恒校验
      </label>
      <label for="envSelect">环境：</label>
      <select id="envSelect">
        <option value="localhost" selected>localhost</option>
        <option value="escrow">nrs-escrow</option>
      </select>
      <button id="queryBtn" type="button">查询账本</button>
      <span class="proxy-note">localhost:5173 → localhost:6881 / nrs-escrow 代理</span>
    </section>

    <div id="notice" class="notice" hidden></div>
    <div id="content" hidden>
      <section id="conservationCheck" class="conservation-check"></section>
      <div id="splitNote" class="split-note"></div>
      <section id="statsRow" class="stats-row"></section>

      <!-- 客户视角 -->
      <section id="customerSection" hidden>
        <section class="table-container" id="whereMoney">
          <h3>💸 我的钱在哪</h3>
          <p class="section-description">客户累计支付与退款，以及当前资金在系统内的分布——每一笔都可在下方时间线中追踪。</p>
          <div id="whereMoneyContent"></div>
        </section>
        <section class="table-container" id="timelineSection">
          <h3>🕐 客户资金旅程</h3>
          <p class="section-description">按时间顺序展示每一笔支付、退款与余额变动，并标明资金的去向或来源。</p>
          <div id="timelineContent"></div>
        </section>
        <section class="chart-container">
          <div class="chart-box"><h3>💰 各类型资金池余额</h3><div id="poolBalanceChart" class="chart"></div></div>
          <div class="chart-box"><h3>📊 资金池余额排行（Top 12）</h3><div id="poolRankChart" class="chart"></div></div>
        </section>
      </section>

      <!-- 服务者视角 -->
      <section id="serviceSection" hidden>
        <section class="table-container flow-section" id="flowSection">
          <h3>🔄 全局资金流向图</h3>
          <p class="section-description">
            按<strong>资金池类型</strong>聚合：<strong>节点高度 ∝ 余额</strong>，
            上方左→右为入金/抵扣，下方通道右→左为退款/回流；连边优先按 <code>transferGroupId</code> 配对，
            其余由 <code>groupType</code>/动作语义兜底推导，并标注可信度。
            <br>悬停高亮该池的全部来往；<strong>点击节点</strong>展开该类型明细池，<strong>点击连线</strong>查看该方向全部流水。
          </p>
          <div id="flowBoard"></div>
          <div id="flowDetail" class="fb-detail" hidden></div>
        </section>

        <section class="table-container" id="txnGroupsSection">
          <h3>🔗 跨池交易组明细</h3>
          <p class="section-description">同一 <code>transferGroupId</code> 的所有腿合并为一个交易组——一笔钱的完整去向证据链；组内入金合计 − 出金合计 ≈ 0 为守恒。</p>
          <div id="txnGroupsContent"></div>
        </section>

        <section class="table-container" id="ctOrdersSection">
          <h3>🏗️ CT单聚合视图（由S单聚合得到）</h3>
          <p class="section-description">CT单的数据由其下属S单聚合得到，点击可查看S单明细</p>
          <div id="ctOrdersContainer"></div>
        </section>

        <section class="table-container" id="poolsSection">
          <h3>📋 资金池详细账本</h3>
          <div id="poolsContainer"></div>
        </section>

        <section class="table-container" id="verifySection">
          <h3>🔍 守恒与对账验证</h3>
          <p class="section-description">逐池余额验证 + 跨池交易组守恒 + 资金池归属告警（verify=true 时由接口返回）。</p>
          <div id="verifyContent"></div>
        </section>
      </section>

      <!-- 平铺明细（两种视角共用） -->
      <section class="table-container" id="flatSection" hidden>
        <h3>📋 平铺明细（全部流水，按时间）</h3>
        <div id="flatContainer"></div>
      </section>
    </div>
  </main>
`;

const envSelect = document.querySelector<HTMLSelectElement>('#envSelect')!;
const perspectiveSelect = document.querySelector<HTMLSelectElement>('#perspectiveSelect')!;
const modeSelect = document.querySelector<HTMLSelectElement>('#modeSelect')!;
const verifyCheck = document.querySelector<HTMLInputElement>('#verifyCheck')!;
const projectInput = document.querySelector<HTMLInputElement>('#projectInput')!;
const button = document.querySelector<HTMLButtonElement>('#queryBtn')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
const content = document.querySelector<HTMLDivElement>('#content')!;

let poolChart: echarts.ECharts | undefined;
let rankChart: echarts.ECharts | undefined;
let latestLedger: Ledger | null = null;
let latestState: QueryState | null = null;

// ---- URL 状态初始化 ----
const initial = readUrlState();
projectInput.value = initial.projectOrderId;
perspectiveSelect.value = initial.perspective;
modeSelect.value = initial.grouped ? 'grouped' : 'flat';
verifyCheck.checked = initial.verify;
envSelect.value = initial.env;

button.addEventListener('click', () => void queryLedger());
projectInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') void queryLedger(); });
perspectiveSelect.addEventListener('change', () => void queryLedger());
modeSelect.addEventListener('change', () => void queryLedger());
verifyCheck.addEventListener('change', () => void queryLedger());
envSelect.addEventListener('change', () => void queryLedger());
window.addEventListener('resize', () => { poolChart?.resize(); rankChart?.resize(); });

if (initial.projectOrderId) void queryLedger();

async function queryLedger(): Promise<void> {
  const state: QueryState = {
    projectOrderId: projectInput.value.trim(),
    env: envSelect.value === 'escrow' ? 'escrow' : 'localhost',
    verify: verifyCheck.checked,
    grouped: modeSelect.value === 'grouped',
    perspective: perspectiveSelect.value === 'customer' ? 'customer' : 'service',
  };
  if (!state.projectOrderId) return showNotice('请输入主单号', true);

  writeUrlState(state);
  button.disabled = true;
  button.textContent = '查询中...';
  content.hidden = true;
  showNotice('正在加载账本数据...', false);
  try {
    const ledger = await fetchLedger(state);
    latestLedger = ledger;
    latestState = state;
    notice.hidden = true;
    content.hidden = false;
    render(ledger, state);
    requestAnimationFrame(() => { poolChart?.resize(); rankChart?.resize(); });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNotice(`查询失败：${message}。请确认主单号正确且所选环境服务可访问。`, true);
  } finally {
    button.disabled = false;
    button.textContent = '查询账本';
  }
}

function render(data: Ledger, state: QueryState): void {
  const pools = data.pools ?? [];
  const entries = allEntries(data);
  const envLabel = state.env === 'escrow' ? 'nrs-escrow' : 'localhost';
  const perspectiveLabel = state.perspective === 'customer' ? '客户视角' : '服务者视角';
  document.querySelector('#headerMeta')!.textContent =
    `主单号: ${state.projectOrderId} | ucid: ${data.ucid ?? '—'} | ${perspectiveLabel} | `
    + `数据来源: nrs-order-service (${envLabel}) | 校验: ${state.verify ? '开启' : '关闭'}`;

  renderConservation(document.querySelector<HTMLDivElement>('#conservationCheck')!, data);
  renderStats(document.querySelector<HTMLDivElement>('#statsRow')!, data);

  const customerSection = document.querySelector<HTMLDivElement>('#customerSection')!;
  const serviceSection = document.querySelector<HTMLDivElement>('#serviceSection')!;
  const flatSection = document.querySelector<HTMLDivElement>('#flatSection')!;

  if (state.grouped && state.perspective === 'customer') {
    customerSection.hidden = false;
    serviceSection.hidden = true;
    flatSection.hidden = true;
    renderWhereMoney(document.querySelector<HTMLDivElement>('#whereMoneyContent')!, data, entries, pools);
    renderTimeline(document.querySelector<HTMLDivElement>('#timelineContent')!, entries, pools);
    ({ poolChart, rankChart } = renderCharts(data, poolChart, rankChart, (el) => echarts.init(el)));
  } else if (state.grouped && state.perspective === 'service') {
    customerSection.hidden = true;
    serviceSection.hidden = false;
    flatSection.hidden = true;
    renderService(data, pools, entries);
  } else {
    // 平铺明细
    customerSection.hidden = true;
    serviceSection.hidden = true;
    flatSection.hidden = false;
    renderFlatTable(document.querySelector<HTMLDivElement>('#flatContainer')!, entries);
  }
  renderSidebar(data, state, entries);
}

function renderService(data: Ledger, pools: FundPool[], entries: LedgerEntry[]): void {
  // ---- 全局资金流向图 ----
  const graph = buildFlowGraph(pools, 'type');
  const poolGraph = buildFlowGraph(pools, 'pool');
  const board = document.querySelector<HTMLDivElement>('#flowBoard')!;
  const detail = document.querySelector<HTMLDivElement>('#flowDetail')!;
  detail.hidden = true;
  renderFlowBoard(board, graph, {
    onNodeClick: (node) => showNodeDetail(detail, node, poolGraph.edges),
    onEdgeClick: (edge, srcLabel, dstLabel) => showEdgeDetail(detail, edge, srcLabel, dstLabel),
  });

  renderTxnGroups(document.querySelector<HTMLDivElement>('#txnGroupsContent')!, entries);
  renderCtOrders(document.querySelector<HTMLDivElement>('#ctOrdersContainer')!, pools);
  renderPools(document.querySelector<HTMLDivElement>('#poolsContainer')!, pools);
  renderVerifyPanel(document.querySelector<HTMLDivElement>('#verifyContent')!, data);
}

// ============ 流向图下钻 ============

function showNodeDetail(target: HTMLDivElement, node: FlowNode, poolEdges: FlowEdge[]): void {
  target.hidden = false;
  if (node.virtual) {
    target.innerHTML = `<div class="fb-detail-head"><h4>${POOL_TYPE_ICON[node.type]} ${escapeHtml(node.label)}</h4>
      <button type="button" class="fb-detail-close">收起</button></div>
      <p class="empty">这是一个虚拟节点：接口返回的流水没有给出对手方资金池，因此这部分资金的另一端无法定位。</p>`;
    wireDetail(target);
    return;
  }

  const rows = node.pools.map((pool) => {
    const poolId = pool.poolId ?? '未知池';
    const mine = poolEdges.filter((edge) => edge.src === poolId || edge.dst === poolId);
    const partners = mine.map((edge) => {
      const isOut = edge.src === poolId;
      const other = isOut ? edge.dst : edge.src;
      return `<span class="fb-partner ${isOut ? 'out' : 'in'}">${isOut ? '→' : '←'} ${escapeHtml(shortPoolId(other))} ${formatYuan(edge.amount)}</span>`;
    }).join('');
    const inflow = mine.filter((edge) => edge.dst === poolId).reduce((sum, edge) => sum + edge.amount, 0);
    const outflow = mine.filter((edge) => edge.src === poolId).reduce((sum, edge) => sum + edge.amount, 0);
    const bal = number(pool.balance);
    return `<tr>
      <td><a href="#pool-${encodeURIComponent(poolId)}" class="fb-jump">${escapeHtml(poolId)}</a>
        ${pool.fundName ? `<span class="fb-fundname">${escapeHtml(pool.fundName)}</span>` : ''}</td>
      <td class="num ${bal > 0 ? 'positive' : bal < 0 ? 'negative' : 'zero'}">${amount(bal)}</td>
      <td class="num pos">${formatSigned(inflow, '+')}</td>
      <td class="num neg">${formatSigned(outflow, '−')}</td>
      <td class="fb-partners">${partners || '<span class="fb-partner-none">无流转记录</span>'}</td>
    </tr>`;
  }).join('');

  target.innerHTML = `
    <div class="fb-detail-head">
      <h4>${POOL_TYPE_ICON[node.type]} ${escapeHtml(node.label)} · ${node.poolCount} 个池 · 合计 ${formatYuan(node.balance)} 元</h4>
      <button type="button" class="fb-detail-close">收起</button>
    </div>
    <table class="fb-table">
      <thead><tr><th>资金池</th><th class="num">余额(元)</th><th class="num">入金</th><th class="num">出金</th><th>资金来往</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wireDetail(target);
}

function showEdgeDetail(target: HTMLDivElement, edge: FlowEdge, srcLabel: string, dstLabel: string): void {
  target.hidden = false;
  const items = edge.items
    .slice()
    .sort((left, right) => right.amount - left.amount)
    .map((item) => `<tr>
      <td>${escapeHtml(item.desc)}</td>
      <td class="num">${formatYuan(item.amount)}</td>
      <td class="mono">${escapeHtml(String(item.transactionNo ?? '—'))}</td>
      <td>${item.finishTime ? escapeHtml(fmtTime(item.finishTime)) : '—'}</td>
    </tr>`).join('');
  const confLabel: Record<FlowEdge['confidence'], string> = {
    PAIRED: 'transferGroupId 同组配对（后端设计的主机制，最可信）',
    MATCHED: '按 groupType/资金动作语义规则 + 等额匹配推导',
    INFERRED: '仅有单侧流水，对手方为推断结果',
  };
  target.innerHTML = `
    <div class="fb-detail-head">
      <h4>${escapeHtml(srcLabel)} ${edge.kind === 'REFUND' ? '╌╌&gt;' : '──→'} ${escapeHtml(dstLabel)}
        · ${edge.kind === 'REFUND' ? '退款 / 回流' : '入金 / 抵扣'}
        · 合计 ${formatYuan(edge.amount)} 元 · ${edge.items.length} 笔</h4>
      <button type="button" class="fb-detail-close">收起</button>
    </div>
    <p class="fb-conf">连边依据：${confLabel[edge.confidence]}</p>
    <table class="fb-table">
      <thead><tr><th>资金动作</th><th class="num">金额(元)</th><th>流水号</th><th>时间</th></tr></thead>
      <tbody>${items}</tbody>
    </table>`;
  wireDetail(target);
}

function wireDetail(target: HTMLDivElement): void {
  target.querySelector<HTMLButtonElement>('.fb-detail-close')
    ?.addEventListener('click', () => { target.hidden = true; });
  target.querySelectorAll<HTMLAnchorElement>('.fb-jump').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const href = link.getAttribute('href');
      const el = href ? document.querySelector(href) : null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.classList.add('pool-card-flash');
      setTimeout(() => el?.classList.remove('pool-card-flash'), 1600);
    });
  });
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============ 侧边栏导航 ============

function renderSidebar(data: Ledger, state: QueryState, entries: LedgerEntry[]): void {
  const target = document.querySelector<HTMLDivElement>('#sidebarContent')!;
  const pools = data.pools ?? [];
  if (!pools.length && !entries.length) {
    target.innerHTML = '<p class="sidebar-empty">暂无资金数据</p>';
    return;
  }

  let html = '<ul class="sidebar-nav">';
  if (!state.grouped) {
    html += `<li class="sidebar-nav-section">概览</li>`;
    html += `<li><a href="#flatSection" class="sidebar-link" data-nav="flatSection">📋 平铺明细（${entries.length} 条）</a></li>`;
  } else if (state.perspective === 'customer') {
    html += `<li class="sidebar-nav-section">我的资金</li>`;
    html += `<li><a href="#whereMoney" class="sidebar-link" data-nav="whereMoney">💸 我的钱在哪</a></li>`;
    html += `<li><a href="#timelineSection" class="sidebar-link" data-nav="timelineSection">🕐 资金旅程</a></li>`;
    html += `<li><a href="#poolBalanceChart" class="sidebar-link" data-nav="poolBalanceChart">💰 余额概览</a></li>`;
  } else {
    html += `<li class="sidebar-nav-section">概览</li>`;
    html += `<li><a href="#flowSection" class="sidebar-link" data-nav="flowSection">🔄 资金流向图</a></li>`;
    html += `<li><a href="#txnGroupsSection" class="sidebar-link" data-nav="txnGroupsSection">🔗 交易组明细</a></li>`;
    html += `<li><a href="#ctOrdersSection" class="sidebar-link" data-nav="ctOrdersSection">🏗️ CT单聚合视图</a></li>`;
    html += `<li><a href="#poolsSection" class="sidebar-link" data-nav="poolsSection">📋 资金池详细账本</a></li>`;
    html += `<li><a href="#verifySection" class="sidebar-link" data-nav="verifySection">🔍 守恒验证</a></li>`;
    const groups = new Map<string, FundPool[]>();
    pools.forEach((pool) => groups.set(pool.poolType || 'OTHER', [...(groups.get(pool.poolType || 'OTHER') ?? []), pool]));
    ['ADVANCE', 'SUB_ORDER', 'FUND', 'WALLET', 'CUSTOMER', 'DEVELOPER', 'OTHER'].forEach((type) => {
      const list = groups.get(type) ?? [];
      if (!list.length) return;
      const total = list.reduce((sum, pool) => sum + number(pool.balance), 0);
      html += `<li class="sidebar-nav-section">${POOL_TYPE_LABEL[type as PoolTypeKey] ?? type} (${list.length}个) <span class="sidebar-section-total">${amount(total)}</span></li>`;
      list.forEach((pool) => {
        const poolId = pool.poolId || '未知';
        const name = pool.fundName ? `【${pool.fundName}】` : '';
        html += `<li><a href="#pool-${encodeURIComponent(poolId)}" class="sidebar-link sidebar-pool-link" data-pool-id="${escapeHtml(poolId)}" title="${escapeHtml(poolId)}">
          ${POOL_TYPE_ICONS[type] ?? '📋'} ${escapeHtml(name)}${escapeHtml(shortPoolId(poolId))}
          <span class="sidebar-link-balance ${balanceClassText(pool.balance)}">${amount(pool.balance)}</span></a></li>`;
      });
    });
  }
  html += '</ul>';
  target.innerHTML = html;

  target.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (link as HTMLAnchorElement).getAttribute('href');
      const targetEl = href ? document.querySelector(href) : null;
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.querySelectorAll('.sidebar-link').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

function balanceClassText(value: unknown): string {
  const n = number(value);
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'zero';
}

function showNotice(message: string, error: boolean): void {
  notice.hidden = false;
  notice.className = `notice${error ? ' error' : ''}`;
  notice.textContent = message;
}
