import * as echarts from 'echarts';
import './style.css';
import {
  buildFlowGraph, formatSigned, formatYuan, fromCents, toCents,
  POOL_TYPE_COLOR, POOL_TYPE_ICON, POOL_TYPE_LABEL,
  type FlowEdge, type FlowNode, type PoolTypeKey,
} from './flow';
import { renderFlowBoard } from './flowview';

type Row = Record<string, unknown>;

interface Entry extends Row {
  entryId?: string;
  accountId?: string;
  accountType?: string;
  direction?: string;
  amount?: number;
  fundActionType?: string;
  fundActionDesc?: string;
  transferGroupId?: string;
  sourceTable?: string;
  sourceRecordId?: string;
  finishTime?: number | string;
  metadata?: Record<string, unknown>;
}

interface Pool extends Row {
  poolId?: string;
  poolType?: string;
  poolTypeDesc?: string;
  fundType?: number;
  fundName?: string;
  projectOrderId?: string;
  balance?: number;
  entryCount?: number;
  compositOrderNo?: string;
  entries?: Entry[];
}

interface CtOrder extends Row {
  ctOrderNo?: string;
  totalAmount?: number;
  sOrderCount?: number;
  sOrders?: Pool[];
}

interface Ledger extends Row {
  customerTotalPay?: number;
  customerTotalRefund?: number;
  customerNetInvestment?: number;
  systemBalance?: number;
  isBalanced?: boolean;
  balanceCheckMessage?: string;
  entries?: Entry[];
  pools?: Pool[];
}

interface ResultDto {
  code?: number;
  message?: string;
  msg?: string;
  data?: Ledger;
}

const CASHIER_TYPES: Record<number, string> = {
  1: 'APP', 2: '微信', 5: '小程序', 9: '收银台', 13: '微信收银台', 15: '网银转账',
  101: 'POS', 111: '装修分期', 112: '对公汇款', 113: '现金', 114: '线下凭证',
  115: '预收款抵扣', 116: '退款抵扣', 124: '线上支付', 125: '款项抵扣',
  126: '余额抵扣', 202: '支付宝', 306: '小程序支付',
};

const POOL_COLORS: Record<string, string> = {
  ADVANCE: '#faad14', SUB_ORDER: '#52c41a', FUND: '#722ed1', WALLET: '#1890ff', CUSTOMER: '#eb2f96', OTHER: '#999999',
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('缺少页面根节点');

app.innerHTML = `
  <nav class="sidebar" id="sidebar">
    <div class="sidebar-header">📊 资金池导航</div>
    <div class="sidebar-content" id="sidebarContent">
      <p class="sidebar-empty">请先查询账本</p>
    </div>
  </nav>
  <main class="container">
    <section class="header">
      <h1>📊 订单资金账本可视化（按主单号，含CT单聚合视图）</h1>
      <p id="headerMeta">数据来源: nrs-order-service | 前端代理: localhost:5173 → localhost:6881</p>
    </section>

    <section class="query-section">
      <label for="envSelect">环境：</label>
      <select id="envSelect">
        <option value="localhost" selected>localhost</option>
        <option value="escrow">nrs-escrow</option>
      </select>
      <label for="viewSelect">视图：</label>
      <select id="viewSelect">
        <option value="flat" selected>📋 平铺明细</option>
        <option value="grouped">📦 按池分组</option>
      </select>
      <label for="projectInput">主单号：</label>
      <input id="projectInput" value="" placeholder="例如 825110413000004841" autocomplete="off">
      <button id="queryBtn" type="button">查询账本</button>
    </section>

    <div id="notice" class="notice" hidden></div>
    <div id="content" hidden>
      <section id="conservationCheck" class="conservation-check"></section>

      <section id="statsRow" class="stats-row"></section>

      <section class="table-container flow-section" id="flowSection">
        <h3>🔄 全局资金流向图</h3>
        <p class="section-description">
          按<strong>资金池类型</strong>聚合的全局视图：<strong>节点高度 ∝ 余额</strong>、节点内直接标出余额，
          <strong>上方左→右为入金/抵扣，下方通道右→左为退款/回流</strong>。
          连边金额由 <code>transferGroupId</code> 同组配对推导（同一资金操作的所有腿共享同一组号），每笔钱只计一次。
          <br>鼠标悬停可高亮某个池的全部来往；<strong>点击节点</strong>展开该类型下的明细池，<strong>点击连线</strong>查看该方向的全部流水。
        </p>
        <div id="flowBoard"></div>
        <div id="flowDetail" class="fb-detail" hidden></div>
      </section>

      <section class="chart-container">
        <div class="chart-box"><h3>💰 各类型资金池余额</h3><div id="poolBalanceChart" class="chart"></div></div>
        <div class="chart-box"><h3>📊 资金池余额排行（Top 12）</h3><div id="poolRankChart" class="chart"></div></div>
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
    </div>
  </main>
`;

const envSelect = document.querySelector<HTMLSelectElement>('#envSelect')!;
const viewSelect = document.querySelector<HTMLSelectElement>('#viewSelect')!;
const projectInput = document.querySelector<HTMLInputElement>('#projectInput')!;
const button = document.querySelector<HTMLButtonElement>('#queryBtn')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
const content = document.querySelector<HTMLDivElement>('#content')!;
let poolChart: echarts.ECharts | undefined;
let rankChart: echarts.ECharts | undefined;

button.addEventListener('click', queryLedger);
projectInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') void queryLedger(); });
window.addEventListener('resize', () => { poolChart?.resize(); rankChart?.resize(); });

async function queryLedger(): Promise<void> {
  const queryValue = projectInput.value.trim();
  const envLabel = envSelect.value === 'escrow' ? 'nrs-escrow' : 'localhost';
  const envBase = envSelect.value === 'escrow' ? '/api-escrow' : '/api-local';
  const isGrouped = viewSelect.value === 'grouped';
  if (!queryValue) return showNotice('请输入主单号', true);

  button.disabled = true;
  button.textContent = '查询中...';
  content.hidden = true;
  showNotice('正在加载账本数据...', false);
  try {
    const apiUrl = `${envBase}/ledger/project?projectOrderId=${encodeURIComponent(queryValue)}&groupByPool=${isGrouped}`;
    const response = await fetch(apiUrl, { headers: { Accept: 'application/json', 'X-NRS-User-Id': '1000000000000000' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as ResultDto | Ledger;
    const wrapper = result as ResultDto;
    if (wrapper.code !== undefined && ![0, 200, 2000].includes(wrapper.code)) {
      throw new Error(wrapper.message || wrapper.msg || `接口错误 code=${wrapper.code}`);
    }
    const data = wrapper.data ?? result as Ledger;
    // 先显示容器再渲染：ECharts 在 display:none 的容器里 init 会拿到 0×0 尺寸并告警
    notice.hidden = true;
    content.hidden = false;
    render(data, queryValue, envLabel);
    requestAnimationFrame(() => { poolChart?.resize(); rankChart?.resize(); });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNotice(`查询失败：${message}。请确认主单号正确且所选环境服务可访问。`, true);
  } finally {
    button.disabled = false;
    button.textContent = '查询账本';
  }
}

function render(data: Ledger, queryLabel: string, envLabel: string): void {
  const pools = data.pools ?? [];
  const entries = data.entries ?? [];
  const isFlat = entries.length > 0;
  const projectOrderId = isFlat ? (queryLabel || '')
    : (pools.find(p => p.projectOrderId)?.projectOrderId || '');
  const balanced = data.isBalanced !== false;
  const headerLabel = `主单号: ${queryLabel}${projectOrderId && projectOrderId !== queryLabel ? ` | 项目: ${projectOrderId}` : ''}`;
  document.querySelector('#headerMeta')!.textContent = `${headerLabel} | 数据来源: nrs-order-service (${envLabel}) | 验证状态: ${balanced ? '守恒 ✓' : '异常 ✕'}${isFlat ? ' | 平铺视图' : ''}`;
  renderCheck(data, balanced);
  renderStats(data);

  if (isFlat) {
    // 平铺视图：隐藏池级图表和流向图
    document.querySelector<HTMLDivElement>('#flowSection')!.hidden = true;
    document.querySelector<HTMLDivElement>('#ctOrdersSection')!.hidden = true;
    const chartsContainer = document.querySelector<HTMLDivElement>('.chart-container');
    if (chartsContainer) chartsContainer.hidden = true;
    document.querySelector<HTMLDivElement>('#sidebarContent')!.innerHTML = '<p class="sidebar-empty">平铺视图不支持导航<br>切换到"按池分组"查看</p>';
    renderFlatTable(entries);
    // 隐藏 pools section，替换为 flat section
    document.querySelector<HTMLDivElement>('#poolsSection')!.querySelector('h3')!.textContent = '📋 平铺明细';
    document.querySelector<HTMLDivElement>('#poolsContainer')!.innerHTML = '';
  } else {
    document.querySelector<HTMLDivElement>('#flowSection')!.hidden = false;
    document.querySelector<HTMLDivElement>('#ctOrdersSection')!.hidden = false;
    const chartsContainer = document.querySelector<HTMLDivElement>('.chart-container');
    if (chartsContainer) chartsContainer.hidden = false;
    renderCharts(data);
    renderSidebar(pools);
    renderCtOrders(buildCtOrders(pools));
    renderPools(pools);
  }
}

function buildCtOrders(pools: Pool[]): CtOrder[] {
  const groups = new Map<string, Pool[]>();
  pools
    .filter((pool) => pool.poolType === 'SUB_ORDER' && pool.compositOrderNo)
    .forEach((pool) => groups.set(pool.compositOrderNo!, [...(groups.get(pool.compositOrderNo!) ?? []), pool]));

  return [...groups.entries()]
    .map(([ctOrderNo, sOrders]) => ({
      ctOrderNo,
      totalAmount: sOrders.reduce((sum, pool) => sum + number(pool.balance), 0),
      sOrderCount: sOrders.length,
      sOrders,
    }))
    .sort((left, right) => (left.ctOrderNo ?? '').localeCompare(right.ctOrderNo ?? ''));
}

function renderSidebar(pools: Pool[]): void {
  const target = document.querySelector<HTMLDivElement>('#sidebarContent')!;
  if (!pools.length) { target.innerHTML = '<p class="sidebar-empty">暂无资金池数据</p>'; return; }

  const groups = new Map<string, Pool[]>();
  pools.forEach((pool) => groups.set(pool.poolType || 'OTHER', [...(groups.get(pool.poolType || 'OTHER') ?? []), pool]));

  const labels: Record<string, string> = { ADVANCE: '🏦 预收款/首期款池', SUB_ORDER: '📦 商品子单池', FUND: '🏠 整装款项池', WALLET: '💰 客户余额池', CUSTOMER: '👤 客户钱包池', OTHER: '其他资金池' };
  const icons: Record<string, string> = { ADVANCE: '🏦', SUB_ORDER: '📦', FUND: '🏠', WALLET: '💰', CUSTOMER: '👤', OTHER: '📋' };

  let html = '<ul class="sidebar-nav">';
  // 添加图表和CT单的快速导航
  html += `<li class="sidebar-nav-section">概览</li>`;
  html += `<li><a href="#statsRow" class="sidebar-link" data-nav="statsRow">📈 资金概览统计</a></li>`;
  html += `<li><a href="#ctOrdersSection" class="sidebar-link" data-nav="ctOrdersSection">🏗️ CT单聚合视图</a></li>`;
  html += `<li><a href="#poolsSection" class="sidebar-link" data-nav="poolsSection">📋 资金池详细账本</a></li>`;

  ['ADVANCE', 'SUB_ORDER', 'FUND', 'WALLET', 'CUSTOMER', 'OTHER'].forEach((type) => {
    const list = groups.get(type) ?? [];
    if (!list.length) return;
    const total = list.reduce((sum, pool) => sum + number(pool.balance), 0);
    html += `<li class="sidebar-nav-section">${labels[type]} (${list.length}个) <span class="sidebar-section-total">${amount(total)}</span></li>`;
    list.forEach((pool) => {
      const poolId = pool.poolId || '未知';
      const shortId = poolId.length > 18 ? `${poolId.slice(0, 15)}...` : poolId;
      const name = pool.fundName ? `【${pool.fundName}】` : '';
      html += `<li><a href="#pool-${encodeURIComponent(poolId)}" class="sidebar-link sidebar-pool-link" data-pool-id="${escapeHtml(poolId)}" title="${escapeHtml(poolId)}">${icons[type] || '📋'} ${name}${shortId} <span class="sidebar-link-balance ${balanceClass(pool.balance)}">${amount(pool.balance)}</span></a></li>`;
    });
  });
  html += '</ul>';
  target.innerHTML = html;

  // 点击高亮
  target.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (link as HTMLAnchorElement).getAttribute('href');
      if (!href) return;
      const targetEl = document.querySelector(href);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // 更新活跃状态
      target.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

function renderCheck(data: Ledger, balanced: boolean): void {
  const target = document.querySelector<HTMLDivElement>('#conservationCheck')!;
  target.className = `conservation-check${balanced ? '' : ' error'}`;
  target.innerHTML = `<h4>${balanced ? '✅ 守恒校验通过' : '❌ 守恒校验失败'}</h4><p>${escapeHtml(text(data.balanceCheckMessage) || '账本资金已完成守恒校验')}</p>`;
}

function renderStats(data: Ledger): void {
  const items = [
    ['外部资金入系统', data.customerTotalPay, 'income'],
    ['退款出系统', data.customerTotalRefund, 'expense'],
    ['净入系统', data.customerNetInvestment, 'balance'],
    ['系统内余额', data.systemBalance, ''],
  ];
  document.querySelector<HTMLDivElement>('#statsRow')!.innerHTML = items.map(([label, value, css]) => `
    <div class="stat-card ${css}"><div class="label">${label}</div><div class="value">${amount(value)}<span class="unit">元</span></div></div>
  `).join('');
}

function renderCharts(data: Ledger): void {
  const pools = data.pools ?? [];

  // ---- 全局资金流向图（类型级聚合，一屏看全貌）----
  const graph = buildFlowGraph(pools, 'type');
  // 明细粒度的图只用来给下钻面板算「某个具体池的对手方」
  const poolGraph = buildFlowGraph(pools, 'pool');
  const board = document.querySelector<HTMLDivElement>('#flowBoard')!;
  const detail = document.querySelector<HTMLDivElement>('#flowDetail')!;
  detail.hidden = true;
  renderFlowBoard(board, graph, {
    onNodeClick: (node) => showNodeDetail(detail, node, poolGraph.edges),
    onEdgeClick: (edge, srcLabel, dstLabel) => showEdgeDetail(detail, edge, srcLabel, dstLabel),
  });

  // ---- 各类型资金池余额：用条形图，能正确表达客户钱包的负余额（饼图做不到）----
  const totals = new Map<PoolTypeKey, number>();
  pools.forEach((pool) => {
    const raw = (pool.poolType ?? 'EXTERNAL') as PoolTypeKey;
    const type = raw in POOL_TYPE_LABEL ? raw : 'EXTERNAL';
    totals.set(type, (totals.get(type) ?? 0) + toCents(pool.balance));
  });
  const typeRows = [...totals].filter(([, value]) => value !== 0);
  poolChart ??= echarts.init(document.querySelector<HTMLDivElement>('#poolBalanceChart')!);
  poolChart.setOption({
    grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactNumber(v) }, splitLine: { lineStyle: { type: 'dashed' } } },
    yAxis: { type: 'category', axisTick: { show: false }, data: typeRows.map(([type]) => `${POOL_TYPE_ICON[type]} ${POOL_TYPE_LABEL[type]}`) },
    series: [{
      type: 'bar', barWidth: '58%',
      data: typeRows.map(([type, value]) => ({
        value: fromCents(value),
        itemStyle: { color: POOL_TYPE_COLOR[type], borderRadius: [0, 4, 4, 0] },
      })),
      label: { show: true, position: 'right', fontSize: 11, formatter: (p: { value: number }) => `${amount(p.value)} 元` },
    }],
  }, true);

  // ---- 具体资金池余额排行：直接回答「哪个池里有多少钱」----
  const ranked = pools
    .filter((pool) => toCents(pool.balance) !== 0)
    .sort((left, right) => Math.abs(toCents(right.balance)) - Math.abs(toCents(left.balance)))
    .slice(0, 12)
    .reverse();
  rankChart ??= echarts.init(document.querySelector<HTMLDivElement>('#poolRankChart')!);
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
        const raw = (pool.poolType ?? 'EXTERNAL') as PoolTypeKey;
        const type = raw in POOL_TYPE_LABEL ? raw : 'EXTERNAL';
        return { value: number(pool.balance), itemStyle: { color: POOL_TYPE_COLOR[type], borderRadius: [0, 4, 4, 0] } };
      }),
      label: { show: true, position: 'right', fontSize: 11, formatter: (p: { value: number }) => amount(p.value) },
    }],
  }, true);
}

/** 点击流向图节点：展开该类型下的所有明细池，并给出每个池的对手方 */
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
    return `<tr>
      <td><a href="#pool-${encodeURIComponent(poolId)}" class="fb-jump">${escapeHtml(poolId)}</a>
        ${pool.fundName ? `<span class="fb-fundname">${escapeHtml(pool.fundName)}</span>` : ''}</td>
      <td class="num ${balanceClass(pool.balance)}">${amount(pool.balance)}</td>
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

/** 点击流向图连线：列出该方向的全部流水 */
function showEdgeDetail(target: HTMLDivElement, edge: FlowEdge, srcLabel: string, dstLabel: string): void {
  target.hidden = false;
  const items = edge.items
    .slice()
    .sort((left, right) => right.amount - left.amount)
    .map((item) => `<tr>
      <td>${escapeHtml(item.desc)}</td>
      <td class="num">${formatYuan(item.amount)}</td>
      <td class="mono">${escapeHtml(String(item.transactionNo ?? '—'))}</td>
      <td>${item.finishTime ? escapeHtml(new Date(item.finishTime).toLocaleString('zh-CN')) : '—'}</td>
    </tr>`).join('');
  const confLabel: Record<FlowEdge['confidence'], string> = {
    PAIRED: 'transferGroupId 同组配对（后端设计的主机制，最可信）',
    MATCHED: '按资金动作语义规则 + 等额匹配推导',
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

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(1)}亿`;
  if (abs >= 1_0000) return `${(value / 1_0000).toFixed(1)}万`;
  return String(value);
}

function shortPoolId(poolId: string): string {
  if (poolId.startsWith('__')) {
    // __V_<TYPE>__ 是「对手方无法定位」的虚拟节点，__<TYPE>__ 是类型级聚合节点
    const virtual = poolId.startsWith('__V_');
    const key = poolId.slice(virtual ? 4 : 2, -2) as PoolTypeKey;
    const label = POOL_TYPE_LABEL[key] ?? poolId;
    return virtual ? `未匹配(${label})` : label;
  }
  return poolId.length > 16 ? `${poolId.slice(0, 6)}…${poolId.slice(-7)}` : poolId;
}

function renderCtOrders(orders: CtOrder[]): void {
  const target = document.querySelector<HTMLDivElement>('#ctOrdersContainer')!;
  if (!orders.length) { target.innerHTML = '<p class="empty">暂无CT单数据</p>'; return; }
  target.innerHTML = orders.map((ct) => {
    const sOrders = ct.sOrders ?? [];
    return `<div class="ct-order-card">
      <h4><span>📦 CT单: ${escapeHtml(ct.ctOrderNo || '未知')}</span><span class="pool-balance positive">${amount(ct.totalAmount)} 元</span></h4>
      <p class="sub-count">下属 ${ct.sOrderCount ?? sOrders.length} 个S单</p>
      <div class="s-order-nested">${sOrders.map(renderNestedPool).join('')}</div>
    </div>`;
  }).join('');
}

function renderNestedPool(pool: Pool): string {
  const isFu = (pool.poolTypeDesc || '').includes('整装');
  return `<div class="pool-card" style="border-color:${POOL_COLORS[pool.poolType || ''] || '#52c41a'}">
    <h4><span>${isFu ? '🏠 FU单' : '📦 S单'}: ${escapeHtml(pool.poolId || '未知')}</span><span class="pool-balance ${balanceClass(pool.balance)}">${amount(pool.balance)} 元</span></h4>
    <div class="pool-entries">${(pool.entries ?? []).map(renderEntry).join('') || '<p class="empty">暂无明细</p>'}</div>
  </div>`;
}

function renderPools(pools: Pool[]): void {
  const target = document.querySelector<HTMLDivElement>('#poolsContainer')!;
  if (!pools.length) { target.innerHTML = '<p class="empty">暂无资金池数据</p>'; return; }
  const groups = new Map<string, Pool[]>();
  pools.forEach((pool) => groups.set(pool.poolType || 'OTHER', [...(groups.get(pool.poolType || 'OTHER') ?? []), pool]));
  const labels: Record<string, string> = { ADVANCE: '🏦 预收款/首期款池', SUB_ORDER: '📦 商品子单池', FUND: '🏠 整装款项池', WALLET: '💰 客户余额池', CUSTOMER: '👤 客户钱包池', OTHER: '其他资金池' };
  target.innerHTML = ['ADVANCE', 'SUB_ORDER', 'FUND', 'WALLET', 'CUSTOMER', 'OTHER'].map((type) => {
    const list = groups.get(type) ?? [];
    if (!list.length) return '';
    const total = list.reduce((sum, pool) => sum + number(pool.balance), 0);
    const sectionId = `pool-section-${type}`;
    return `<div class="section-divider" id="${sectionId}">${labels[type]} (${list.length}个) - 总余额: ${amount(total)} 元</div>${list.map((pool) => {
      const poolId = pool.poolId || '未知资金池';
      return `
      <div class="pool-card" id="pool-${encodeURIComponent(poolId)}" style="border-color:${POOL_COLORS[type] || '#666'}">
        <h4><span>${pool.fundName ? `【${escapeHtml(pool.fundName)}】` : ''} ${escapeHtml(poolId)}</span><span class="pool-balance ${balanceClass(pool.balance)}">${amount(pool.balance)} 元</span></h4>
        <div class="pool-meta">${pool.poolTypeDesc ? `类型: ${escapeHtml(pool.poolTypeDesc)} | ` : ''}${pool.entryCount ?? pool.entries?.length ?? 0} 条记录${pool.compositOrderNo ? ` | CT: ${escapeHtml(pool.compositOrderNo)}` : ''}${pool.fundName ? ` | ${escapeHtml(pool.fundName)}` : ''}${pool.projectOrderId ? ` | 主单号: ${escapeHtml(pool.projectOrderId)}` : ''}</div>
        <div class="pool-entries">${(pool.entries ?? []).map(renderEntry).join('') || '<p class="empty">暂无明细</p>'}</div>
      </div>`;
    }).join('')}`;
  }).join('');
}

function metaVal(entry: Entry, key: string): unknown { return entry.metadata?.[key]; }

function renderEntry(entry: Entry): string {
  const inflow = entry.direction === 'INFLOW';
  const finishTime = entry.finishTime as string | number | undefined;
  const cashierType = metaVal(entry, 'cashierType') as number | undefined;
  const txnNo = metaVal(entry, 'transactionNo') as string | undefined;
  const details = [cashierType ? `收银台: ${CASHIER_TYPES[cashierType] ?? cashierType}` : '', txnNo ? `流水号: ${txnNo}` : '', finishTime ? `时间: ${new Date(finishTime).toLocaleString('zh-CN')}` : ''].filter(Boolean);
  return `<div class="entry-row"><div class="entry-info"><div class="entry-desc"><span class="tag ${inflow ? 'tag-in' : 'tag-out'}">${inflow ? '入金' : '出金'}</span> ${escapeHtml(entry.fundActionDesc || '')}</div><div class="entry-detail">${escapeHtml(details.join(' | '))}</div></div><div class="${inflow ? 'amount-positive' : 'amount-negative'}">${inflow ? '+' : '-'}${amount(Math.abs(number(entry.amount)))} 元</div></div>`;
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: '预收款池', SUB_ORDER: '商品子单池', FUND: '整装款项池', WALLET: '客户余额池', CUSTOMER: '客户钱包池', DEVELOPER: '开发商池',
};

function renderFlatTable(entries: Entry[]): void {
  const target = document.querySelector<HTMLDivElement>('#poolsContainer')!;
  if (!entries.length) { target.innerHTML = '<p class="empty">暂无账本明细</p>'; return; }
  const rows = entries.map(entry => {
    const inflow = entry.direction === 'INFLOW';
    const txnNo = metaVal(entry, 'transactionNo') as string | undefined;
    const finishTime = entry.finishTime as string | number | undefined;
    const acctLabel = ACCOUNT_TYPE_LABELS[entry.accountType ?? ''] ?? (entry.accountType ?? '');
    return `<tr>
      <td class="flat-time">${finishTime ? new Date(finishTime).toLocaleString('zh-CN') : '—'}</td>
      <td><span class="flat-acct">${escapeHtml(entry.accountId ?? '')}</span><span class="flat-acct-type">${escapeHtml(acctLabel)}</span></td>
      <td><span class="tag ${inflow ? 'tag-in' : 'tag-out'}">${inflow ? '入金' : '出金'}</span></td>
      <td class="num ${inflow ? 'amount-positive' : 'amount-negative'}">${inflow ? '+' : '-'}${amount(Math.abs(number(entry.amount)))}</td>
      <td>${escapeHtml(entry.fundActionDesc || '')}</td>
      <td class="mono">${escapeHtml(txnNo || '—')}</td>
      <td>${escapeHtml(entry.sourceTable || '')}</td>
    </tr>`;
  }).join('');
  target.innerHTML = `<div class="flat-table-wrap">
    <table class="flat-table">
      <thead><tr><th>时间</th><th>账户</th><th>方向</th><th class="num">金额(元)</th><th>资金动作</th><th>流水号</th><th>数据源</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="flat-count">共 ${entries.length} 条记录</p>
  </div>`;
}

function showNotice(message: string, error: boolean): void { notice.hidden = false; notice.className = `notice${error ? ' error' : ''}`; notice.textContent = message; }
function amount(value: unknown): string { return number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function text(value: unknown): string { return value == null ? '' : String(value); }
function shorten(value: string): string { return value.length > 20 ? `${value.slice(0, 16)}...` : value; }
function balanceClass(value: unknown): string { const n = number(value); return n > 0 ? 'positive' : n < 0 ? 'negative' : 'zero'; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] || c); }
