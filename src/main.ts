/**
 * 页面入口：外壳（左侧视图栏 + 顶部查询条 + 单视图主区 + 溯源抽屉）。
 *
 * 数据只在这里请求一次、分组一次，之后各视图直接消费 ViewContext。
 * 视图切换不重新请求接口，也不重新分组。
 */

import './style.css';
import {
  VIEWS, escapeHtml, fetchLedger, readUrlState, writeUrlState,
  type Ledger, type QueryState, type ViewKey,
} from './api';
import { allEntries, buildGroups, poolIndex } from './groups';
import type { ViewContext } from './context';
import { closeDrawer, openGroupDrawer } from './drawer';
import { renderOverview } from './views/overview';
import { renderStream } from './views/stream';
import { renderPools } from './views/pools';
import { renderOrders } from './views/orders';
import { renderVerify } from './views/verify';
import { renderMoneyMap } from './views/map';

const VIEW_META: Record<ViewKey, { label: string; icon: string }> = {
  overview: { label: '资金总览', icon: '◎' },
  map: { label: '资金地图', icon: '⌁' },
  stream: { label: '资金流水', icon: '≡' },
  pools: { label: '资金流向', icon: '⇄' },
  orders: { label: '订单与款项', icon: '▤' },
  verify: { label: '对账与校验', icon: '✓' },
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('缺少页面根节点');

app.innerHTML = `
  <nav class="rail">
    <div class="rail-brand"><span class="brand-mark">¥</span><span>统一资金账本<small>让客户与服务者对每一笔钱有一致的理解</small></span></div>
    <div id="railNav"><p class="rail-group">请先查询主单号</p></div>
    <div class="rail-foot" id="railFoot"></div>
  </nav>
  <main class="main">
    <div class="topbar">
      <span class="topbar-title">查询账本</span>
      <label for="orderInput">主单号</label>
      <input id="orderInput" type="text" placeholder="826061315000002872" autocomplete="off">
      <label><input type="checkbox" id="verifyCheck"> 守恒校验</label>
      <label for="envSelect">环境</label>
      <select id="envSelect">
        <option value="localhost">localhost:6881</option>
        <option value="escrow">nrs-escrow</option>
        <option value="preview">预发 preview</option>
      </select>
      <button id="queryBtn" type="button">查询</button>
      <span class="spacer"></span>
      <span class="hint" id="topHint"></span>
    </div>
    <div id="notice" class="notice" hidden></div>
    <div id="view"></div>
  </main>
`;

const orderInput = document.querySelector<HTMLInputElement>('#orderInput')!;
const verifyCheck = document.querySelector<HTMLInputElement>('#verifyCheck')!;
const envSelect = document.querySelector<HTMLSelectElement>('#envSelect')!;
const queryBtn = document.querySelector<HTMLButtonElement>('#queryBtn')!;
const railNav = document.querySelector<HTMLDivElement>('#railNav')!;
const railFoot = document.querySelector<HTMLDivElement>('#railFoot')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
const viewHost = document.querySelector<HTMLDivElement>('#view')!;
const topHint = document.querySelector<HTMLSpanElement>('#topHint')!;

let state: QueryState = readUrlState();
let ctx: ViewContext | null = null;

orderInput.value = state.projectOrderId;
verifyCheck.checked = state.verify;
envSelect.value = state.env;

function showNotice(message: string, error = false): void {
  notice.hidden = false;
  notice.className = `notice${error ? ' error' : ''}`;
  notice.textContent = message;
}

function badge(view: ViewKey): string {
  if (!ctx) return '';
  switch (view) {
    case 'stream':
    case 'map':
      return String(ctx.groups.length);
    case 'pools':
      return String(ctx.pools.length);
    case 'verify': {
      const pass = ctx.data.isBalanced !== false
        && ctx.data.balanceVerifySummary?.allPass !== false
        && ctx.data.groupVerifySummary?.allPass !== false;
      return pass ? '✓' : '✕';
    }
    default:
      return '';
  }
}

function renderRail(): void {
  if (!ctx) return;
  const items = VIEWS.map((view) => {
    const meta = VIEW_META[view];
    const label = meta.label;
    const mark = badge(view);
    return `
      <button class="rail-item${state.view === view ? ' active' : ''}" data-view="${view}">
        <span class="ri-icon">${meta.icon}</span>
        <span>${escapeHtml(label)}</span>
        ${mark ? `<span class="ri-badge">${escapeHtml(mark)}</span>` : ''}
      </button>`;
  }).join('');

  railNav.innerHTML = items;
  railNav.querySelectorAll<HTMLElement>('[data-view]').forEach((node) => {
    node.addEventListener('click', () => goView(node.dataset.view as ViewKey));
  });

  const unresolved = ctx.groups.filter((g) => g.info.kind === 'FALLBACK').length;
  railFoot.innerHTML = [
    `<div>主单 ${escapeHtml(state.projectOrderId)}</div>`,
    ctx.data.ucid ? `<div>ucid ${ctx.data.ucid}</div>` : '',
    `<div>${ctx.groups.length} 次操作 · ${ctx.entries.length} 条明细</div>`,
    unresolved ? `<div style="color:var(--hold)">${unresolved} 组未配对</div>` : '',
  ].filter(Boolean).join('');
}

function renderView(focus?: string): void {
  if (!ctx) return;
  closeDrawer();
  viewHost.scrollTop = 0;
  switch (state.view) {
    case 'overview': renderOverview(viewHost, ctx); break;
    case 'map': renderMoneyMap(viewHost, ctx); break;
    case 'stream': renderStream(viewHost, ctx, focus); break;
    case 'pools': renderPools(viewHost, ctx, focus); break;
    case 'orders': renderOrders(viewHost, ctx); break;
    case 'verify': renderVerify(viewHost, ctx); break;
  }
  window.scrollTo({ top: 0 });
}

function goView(view: ViewKey, focus?: string): void {
  if (!VIEWS.includes(view)) return;
  state = { ...state, view };
  writeUrlState(state);
  renderRail();
  renderView(focus);
}

function openGroup(groupId: string): void {
  if (!ctx) return;
  const group = ctx.groupById.get(groupId);
  if (!group) return;
  openGroupDrawer(group, {
    index: ctx.index,
    groups: ctx.groups,
    onOpen: (id) => openGroup(id),
  });
}

function buildContext(data: Ledger): ViewContext {
  const pools = data.pools ?? [];
  const entries = allEntries(pools, data.entries);
  const groups = buildGroups(entries);
  const groupById = new Map(groups.map((g) => [g.groupId, g]));
  const groupByEntryId = new Map<string, typeof groups[number]>();
  groups.forEach((group) => group.legs.forEach((leg) => {
    if (leg.entryId) groupByEntryId.set(leg.entryId, group);
  }));
  return {
    data,
    pools,
    entries,
    groups,
    groupById,
    groupByEntryId,
    index: poolIndex(pools),
    openGroup,
    goView,
  };
}

async function query(): Promise<void> {
  const projectOrderId = orderInput.value.trim();
  if (!projectOrderId) {
    showNotice('请输入主单号', true);
    return;
  }
  state = {
    ...state,
    projectOrderId,
    verify: verifyCheck.checked,
    env: envSelect.value === 'preview' ? 'preview' : envSelect.value === 'escrow' ? 'escrow' : 'localhost',
  };
  writeUrlState(state);

  queryBtn.disabled = true;
  queryBtn.textContent = '查询中';
  showNotice('正在加载账本…');
  closeDrawer();
  try {
    const data = await fetchLedger(state);
    ctx = buildContext(data);
    notice.hidden = true;
    const envLabel = state.env === 'preview' ? '预发 preview' : state.env === 'escrow' ? 'nrs-escrow' : 'localhost:6881';
    topHint.textContent = `${envLabel} · 校验${state.verify ? '开' : '关'}`;
    renderRail();
    renderView();
  } catch (error) {
    ctx = null;
    viewHost.innerHTML = '';
    railNav.innerHTML = '<p class="rail-group">请先查询主单号</p>';
    railFoot.innerHTML = '';
    showNotice(`查询失败：${(error as Error).message}`, true);
  } finally {
    queryBtn.disabled = false;
    queryBtn.textContent = '查询';
  }
}

queryBtn.addEventListener('click', () => void query());
orderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void query();
});
verifyCheck.addEventListener('change', () => void query());
envSelect.addEventListener('change', () => void query());

if (state.projectOrderId) void query();
else showNotice('输入主单号后查询，可直接把地址栏链接分享给别人（视角、视图、环境都会带上）');
