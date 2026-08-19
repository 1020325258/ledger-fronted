/**
 * 全局资金流向图 —— 自绘 SVG。
 *
 * 布局要点（由数据验证得出，见 ledger-verify/proto_flow_graph.py）：
 *   - 池类型只有 5 种、类型级边不超过 14 条、无自环 → 一屏可完整呈现全貌
 *   - 所有「入金/抵扣」边天然由左向右，所有「退款/回流」边由右向左
 *     → 上方走正向流，下方独立「退款回流通道」走反向流，两者永不打架
 *   - 节点高度 ∝ |余额|，节点内直接写余额大字 → 「每个池有多少钱」一眼可读
 *   - 每个节点自校验 Σ入边-Σ出边 == balance，不平则标红，图可对账
 */

import {
  type FlowEdge, type FlowGraph, type FlowNode, type PoolTypeKey,
  POOL_TYPE_COLOR, POOL_TYPE_ICON, formatSigned, formatYuan,
} from './flow';

/** 三列分层：客户/外部 → 预收款/余额 → 子单/整装 */
const COLUMNS: PoolTypeKey[][] = [
  ['CUSTOMER', 'EXTERNAL'],
  ['ADVANCE', 'WALLET'],
  ['SUB_ORDER', 'FUND'],
];

const COL_TITLES = ['资金来源', '中间归集池', '业务承接池'];

const PAD = 28;
const NODE_W = 236;
const COL_GAP = 172;
const ROW_GAP = 26;
const TITLE_Y = 20;
const TOP_HINT_Y = 42;
const TOP_CHANNEL_TOP = 62;
/** 没有跨层边时节点直接从这里开始 */
const BAND_TOP = 48;
const NODE_H_MIN = 82;
const NODE_H_MAX = 152;
const CHANNEL_TOP_GAP = 44;
const LANE_H = 28;

interface Placed {
  node: FlowNode;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
}

export interface FlowBoardHandlers {
  onNodeClick?: (node: FlowNode) => void;
  onEdgeClick?: (edge: FlowEdge, srcLabel: string, dstLabel: string) => void;
}

/** 边宽：按金额平方根缩放，2~18px */
function strokeWidth(amount: number, max: number): number {
  if (max <= 0) return 2;
  return 2 + 16 * Math.sqrt(Math.max(amount, 0) / max);
}

/** 三次贝塞尔在参数 t 处的坐标 */
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * 求贝塞尔曲线上横坐标最接近 targetX 的点。
 * 用于把金额标签放到「列间空隙」里 —— 直接取几何中点的话，跨列边的中点会
 * 落在中间那一列的节点上，标签被节点盖住（已在真实数据上复现）。
 */
function pointNearX(
  x1: number, y1: number, cx1: number, cy1: number,
  cx2: number, cy2: number, x2: number, y2: number, targetX: number,
): { x: number; y: number } {
  let best = { x: x1, y: y1 };
  let bestDelta = Infinity;
  for (let i = 0; i <= 100; i += 1) {
    const t = i / 100;
    const x = cubicAt(x1, cx1, cx2, x2, t);
    const delta = Math.abs(x - targetX);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { x, y: cubicAt(y1, cy1, cy2, y2, t) };
    }
  }
  return best;
}

function esc(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] ?? c));
}

/** 紧凑金额，用于边上的标签：12,345.67 → 1.23万 */
function compactYuan(cents: number): string {
  const yuan = cents / 100;
  const abs = Math.abs(yuan);
  if (abs >= 1_0000_0000) return `${(yuan / 1_0000_0000).toFixed(2)}亿`;
  if (abs >= 1_0000) return `${(yuan / 1_0000).toFixed(2)}万`;
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 小额边阈值：低于最大边的这个比例就算「细枝末节」，精简视图下不画线 */
const MINOR_SHARE = 0.01;

export function renderFlowBoard(
  container: HTMLElement,
  graph: FlowGraph,
  handlers: FlowBoardHandlers = {},
): void {
  // 边一多（真实样本里出现过 11 条）就会互相穿插、标签叠在一起，
  // 「一眼看懂」立刻失效。默认开精简视图，只画主要资金流，
  // 但节点上的入/出/余额始终按全部边计算，绝不因为隐藏了线就少算钱。
  const allEdgeCount = graph.edges.length;
  let simplify = allEdgeCount > 6;

  container.innerHTML = `
    <div class="fb-toolbar">
      <label class="fb-toggle">
        <input type="checkbox" id="fbSimplify"${simplify ? ' checked' : ''}>
        精简视图（只画主要资金流）
      </label>
      <span class="fb-toolbar-note" id="fbHiddenNote"></span>
    </div>
    <div id="fbMount"></div>`;

  const mount = container.querySelector<HTMLDivElement>('#fbMount')!;
  const note = container.querySelector<HTMLSpanElement>('#fbHiddenNote')!;
  const toggle = container.querySelector<HTMLInputElement>('#fbSimplify')!;
  toggle.addEventListener('change', () => {
    simplify = toggle.checked;
    draw();
  });
  draw();

  function draw(): void {
    drawBoard(mount, note, graph, handlers, simplify);
  }
}

function drawBoard(
  container: HTMLElement,
  note: HTMLElement,
  graph: FlowGraph,
  handlers: FlowBoardHandlers,
  simplify: boolean,
): void {
  // ---- 先按类型定列，据此把边分成三类，才能算出上方通道要占多高 ----
  const colOfType = new Map<PoolTypeKey, number>();
  COLUMNS.forEach((types, col) => types.forEach((t) => colOfType.set(t, col)));

  // 小额边筛选：只影响「画不画线」，不影响节点上的入/出/余额数字
  const biggest = Math.max(...graph.edges.map((e) => e.amount), 1);
  const shown = simplify
    ? graph.edges.filter((e) => e.amount >= biggest * MINOR_SHARE)
    : graph.edges;
  const hidden = graph.edges.filter((e) => !shown.includes(e));
  note.textContent = hidden.length
    ? `已隐藏 ${hidden.length} 条小额连边（合计 ¥${formatYuan(hidden.reduce((s, e) => s + e.amount, 0))}，`
      + `均小于最大流的 ${(MINOR_SHARE * 100).toFixed(0)}%）；节点余额仍按全部流水计算`
    : '';

  // 只保留有余额或有流水的节点，避免空节点占位。
  // 同一类型若同时有真实节点和虚拟节点，优先展示真实节点。
  const active = new Map<PoolTypeKey, FlowNode>();
  const touched = new Set<string>();
  for (const e of shown) { touched.add(e.src); touched.add(e.dst); }
  for (const n of graph.nodes) {
    // 虚拟节点如果它的边全被隐藏了，就一起隐藏 —— 否则画出一个没有连线的孤立框
    if (n.virtual && !touched.has(n.id)) continue;
    if (n.balance === 0 && n.inflow === 0 && n.outflow === 0) continue;
    const existing = active.get(n.type);
    if (existing && existing.virtual === n.virtual) continue;
    if (existing && !existing.virtual) continue;
    active.set(n.type, n);
  }
  if (!active.size) {
    container.innerHTML = '<p class="empty">暂无资金流转数据</p>';
    return;
  }

  const activeIds = new Map<string, FlowNode>([...active.values()].map((n) => [n.id, n]));
  const edges = shown.filter((e) => activeIds.has(e.src) && activeIds.has(e.dst));
  const colOfId = (id: string) => colOfType.get(activeIds.get(id)!.type) ?? 0;
  const spanOf = (e: FlowEdge) => Math.abs(colOfId(e.dst) - colOfId(e.src));

  const refund = edges.filter((e) => e.kind === 'REFUND');
  // 只有「正好相邻的下一列」才直连。其余正向边都走上方通道：
  //  - 跨 2 列：直连会从中间那列节点背后穿过，看起来像「流经」了那个池（实际没有）
  //  - 同列或指回左侧（如「余额抵扣」对手方未定位，落到 col0 的外部/未匹配桶）：
  //    直连会画成一条往回折的曲线，箭头和金额标签都会压在节点边框上
  const deltaOf = (e: FlowEdge) => colOfId(e.dst) - colOfId(e.src);
  const forwardDirect = edges.filter((e) => e.kind === 'FORWARD' && deltaOf(e) === 1);
  const forwardChannel = edges.filter((e) => e.kind === 'FORWARD' && deltaOf(e) !== 1);
  const maxAmount = Math.max(...edges.map((e) => e.amount), 1);

  const topLaneOf = new Map<FlowEdge, number>();
  forwardChannel
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .forEach((e, i) => topLaneOf.set(e, i));
  const topChannelTop = TOP_CHANNEL_TOP;
  const bandTop = forwardChannel.length
    ? topChannelTop + forwardChannel.length * LANE_H + 18
    : BAND_TOP;

  // ---- 布局：逐列摆放，列内垂直居中 ----
  const maxAbsBalance = Math.max(...[...active.values()].map((n) => Math.abs(n.balance)), 1);
  const heightOf = (n: FlowNode) => (n.virtual
    ? NODE_H_MIN
    : NODE_H_MIN + (NODE_H_MAX - NODE_H_MIN) * Math.sqrt(Math.abs(n.balance) / maxAbsBalance));

  const colNodes: FlowNode[][] = COLUMNS.map((types) => types
    .map((t) => active.get(t))
    .filter((n): n is FlowNode => !!n));
  const colHeights = colNodes.map((list) => list.reduce((sum, n) => sum + heightOf(n), 0)
    + Math.max(0, list.length - 1) * ROW_GAP);
  const bandH = Math.max(...colHeights, NODE_H_MIN);

  const placed: Placed[] = [];
  const byId = new Map<string, Placed>();
  colNodes.forEach((list, col) => {
    let y = bandTop + (bandH - colHeights[col]) / 2;
    for (const node of list) {
      const h = heightOf(node);
      const p: Placed = { node, x: PAD + col * (NODE_W + COL_GAP), y, w: NODE_W, h, col };
      placed.push(p);
      byId.set(node.id, p);
      y += h + ROW_GAP;
    }
  });

  // ---- 退款回流通道：按水平跨度降序分配泳道，跨度大的走外侧 ----
  const bandBottom = bandTop + bandH;
  const channelTop = bandBottom + CHANNEL_TOP_GAP;
  const laneOf = new Map<FlowEdge, number>();
  refund
    .slice()
    .sort((a, b) => spanOf(b) - spanOf(a))
    .forEach((e, i) => laneOf.set(e, i));
  const laneCount = refund.length;

  const width = PAD * 2 + 3 * NODE_W + 2 * COL_GAP;
  const height = channelTop + laneCount * LANE_H + PAD + (laneCount ? 12 : 0);

  // ---- 端口分配：同一节点上多条边沿边缘均匀错开 ----
  const portY = (p: Placed, index: number, total: number) =>
    p.y + p.h * ((index + 1) / (total + 1));

  const outIndex = new Map<string, number>();
  const inIndex = new Map<string, number>();
  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  for (const e of forwardDirect) {
    outTotal.set(e.src, (outTotal.get(e.src) ?? 0) + 1);
    inTotal.set(e.dst, (inTotal.get(e.dst) ?? 0) + 1);
  }

  const parts: string[] = [];
  /** 金额标签先收集，等所有边算完再做一次防重叠，最后画在节点之下、连线之上 */
  const labelSlots: { x: number; y: number; edge: FlowEdge; kind: 'forward' | 'refund'; dim: boolean }[] = [];

  // 列标题
  COL_TITLES.forEach((title, col) => {
    if (!colNodes[col].length) return;
    parts.push(`<text class="fb-col-title" x="${PAD + col * (NODE_W + COL_GAP) + NODE_W / 2}"
      y="${TITLE_Y}" text-anchor="middle">${esc(title)}</text>`);
  });

  // ---- 走上方通道的正向边：绕开所有节点，左右两个方向都支持 ----
  for (const e of forwardChannel) {
    const s = byId.get(e.src)!;
    const t = byId.get(e.dst)!;
    const laneY = topChannelTop + (topLaneOf.get(e) ?? 0) * LANE_H;
    // 朝右就从源节点右边缘出、进目标左边缘；朝左则反过来，避免曲线往回折
    const rightward = (t.x + t.w / 2) > (s.x + s.w / 2);
    const dir = rightward ? 1 : -1;
    const exitX = rightward ? s.x + s.w : s.x;
    const enterX = rightward ? t.x : t.x + t.w;
    const sy = s.y + 18;
    const ty = t.y + 18;
    const xUp = exitX + dir * 22;
    const xDown = enterX - dir * 22;
    const sgn = Math.sign(xDown - xUp) || dir;
    const r = 12;
    const d = [
      `M ${exitX.toFixed(1)} ${sy.toFixed(1)}`,
      `L ${(xUp - dir * r).toFixed(1)} ${sy.toFixed(1)}`,
      `Q ${xUp.toFixed(1)} ${sy.toFixed(1)} ${xUp.toFixed(1)} ${(sy - r).toFixed(1)}`,
      `L ${xUp.toFixed(1)} ${(laneY + r).toFixed(1)}`,
      `Q ${xUp.toFixed(1)} ${laneY} ${(xUp + sgn * r).toFixed(1)} ${laneY}`,
      `L ${(xDown - sgn * r).toFixed(1)} ${laneY}`,
      `Q ${xDown.toFixed(1)} ${laneY} ${xDown.toFixed(1)} ${(laneY + r).toFixed(1)}`,
      `L ${xDown.toFixed(1)} ${(ty - r).toFixed(1)}`,
      `Q ${xDown.toFixed(1)} ${ty.toFixed(1)} ${(xDown + dir * r).toFixed(1)} ${ty.toFixed(1)}`,
      `L ${enterX.toFixed(1)} ${ty.toFixed(1)}`,
    ].join(' ');
    const w = strokeWidth(e.amount, maxAmount);
    const dim = e.confidence === 'INFERRED';
    parts.push(`<g class="fb-edge fb-edge-forward${dim ? ' fb-edge-dim' : ''}"
        data-src="${esc(e.src)}" data-dst="${esc(e.dst)}" data-kind="FORWARD" tabindex="0"
        role="button" aria-label="${esc(`${e.src} 流向 ${e.dst}，${formatYuan(e.amount)} 元`)}">
      <path class="fb-edge-hit" d="${d}" />
      <path class="fb-edge-line" d="${d}" stroke-width="${w.toFixed(1)}"
        marker-end="url(#fb-arrow-forward)" />
    </g>`);
    labelSlots.push({ x: (xUp + xDown) / 2, y: laneY, edge: e, kind: 'forward', dim });
  }

  // ---- 相邻列正向边：直接贝塞尔 ----
  for (const e of forwardDirect) {
    const s = byId.get(e.src)!;
    const t = byId.get(e.dst)!;
    const si = outIndex.get(e.src) ?? 0;
    const ti = inIndex.get(e.dst) ?? 0;
    outIndex.set(e.src, si + 1);
    inIndex.set(e.dst, ti + 1);
    const x1 = s.x + s.w;
    const y1 = portY(s, si, outTotal.get(e.src) ?? 1);
    const x2 = t.x;
    const y2 = portY(t, ti, inTotal.get(e.dst) ?? 1);
    const dx = Math.max(50, (x2 - x1) * 0.45);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    const w = strokeWidth(e.amount, maxAmount);
    const dim = e.confidence === 'INFERRED';
    parts.push(`<g class="fb-edge fb-edge-forward${dim ? ' fb-edge-dim' : ''}"
        data-src="${esc(e.src)}" data-dst="${esc(e.dst)}" data-kind="FORWARD" tabindex="0"
        role="button" aria-label="${esc(`${e.src} 流向 ${e.dst}，${formatYuan(e.amount)} 元`)}">
      <path class="fb-edge-hit" d="${d}" />
      <path class="fb-edge-line" d="${d}" stroke-width="${w.toFixed(1)}"
        marker-end="url(#fb-arrow-forward)" />
    </g>`);
    // 金额标签放进「源节点右侧的第一个列间空隙」——空隙里一定没有节点，
    // 不会被中间列的节点盖住（跨列边取几何中点就会被盖）。
    const gapCenter = x1 + COL_GAP / 2;
    const at = pointNearX(x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2, gapCenter);
    labelSlots.push({ x: at.x, y: at.y, edge: e, kind: 'forward', dim });
  }

  // ---- 退款回流边（下层通道，右→左）----
  for (const e of refund) {
    const s = byId.get(e.src)!;
    const t = byId.get(e.dst)!;
    const lane = laneOf.get(e) ?? 0;
    const laneY = channelTop + lane * LANE_H;
    // 从源节点左边缘出、目标节点右边缘入，竖直段都走「列间空隙」。
    // 直接从节点底边垂直下落会穿过同列下方的节点，看起来像是从错误的节点发出。
    const sx = s.x;
    const sy = s.y + s.h - 16;
    const tx = t.x + t.w;
    const ty = t.y + t.h - 16;
    const xDrop = Math.max(10, s.x - 34);
    const xRise = tx + 34;
    const r = 12;
    const sgn = xRise >= xDrop ? 1 : -1;
    const d = [
      `M ${sx.toFixed(1)} ${sy.toFixed(1)}`,
      `L ${(xDrop + r).toFixed(1)} ${sy.toFixed(1)}`,
      `Q ${xDrop.toFixed(1)} ${sy.toFixed(1)} ${xDrop.toFixed(1)} ${(sy + r).toFixed(1)}`,
      `L ${xDrop.toFixed(1)} ${(laneY - r).toFixed(1)}`,
      `Q ${xDrop.toFixed(1)} ${laneY} ${(xDrop + sgn * r).toFixed(1)} ${laneY}`,
      `L ${(xRise - sgn * r).toFixed(1)} ${laneY}`,
      `Q ${xRise.toFixed(1)} ${laneY} ${xRise.toFixed(1)} ${(laneY - r).toFixed(1)}`,
      `L ${xRise.toFixed(1)} ${(ty + r).toFixed(1)}`,
      `Q ${xRise.toFixed(1)} ${ty.toFixed(1)} ${(xRise - r).toFixed(1)} ${ty.toFixed(1)}`,
      `L ${tx.toFixed(1)} ${ty.toFixed(1)}`,
    ].join(' ');
    const w = strokeWidth(e.amount, maxAmount);
    const dim = e.confidence === 'INFERRED';
    parts.push(`<g class="fb-edge fb-edge-refund${dim ? ' fb-edge-dim' : ''}"
        data-src="${esc(e.src)}" data-dst="${esc(e.dst)}" data-kind="REFUND" tabindex="0"
        role="button" aria-label="${esc(`${e.src} 退款回流到 ${e.dst}，${formatYuan(e.amount)} 元`)}">
      <path class="fb-edge-hit" d="${d}" />
      <path class="fb-edge-line" d="${d}" stroke-width="${w.toFixed(1)}"
        marker-end="url(#fb-arrow-refund)" />
    </g>`);
    labelSlots.push({ x: (xDrop + xRise) / 2, y: laneY, edge: e, kind: 'refund', dim });
  }

  // ---- 金额标签防重叠：按横向分桶，桶内自上而下依次让位 ----
  const buckets = new Map<number, typeof labelSlots>();
  for (const slot of labelSlots) {
    const key = Math.round(slot.x / 110);
    const list = buckets.get(key) ?? [];
    list.push(slot);
    buckets.set(key, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.y - b.y);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].y - list[i - 1].y < 24) list[i].y = list[i - 1].y + 24;
    }
  }
  for (const slot of labelSlots) parts.push(edgeLabel(slot.x, slot.y, slot.edge, slot.kind, slot.dim));

  // ---- 节点（画在边之上，保证文字不被遮挡）----
  for (const p of placed) parts.push(nodeBox(p));

  // ---- 通道说明 ----
  if (forwardChannel.length) {
    // 放在泳道之上：泳道的竖直段会穿过 bandTop-8 那一行，文字会被压在丝带下面
    parts.push(`<text class="fb-channel-hint fb-channel-hint-top" x="${PAD}"
      y="${TOP_HINT_Y}">↑ 上方通道：跨层直达（如客户直付到整装款项）或对手方未定位的流转</text>`);
  }
  if (refund.length) {
    parts.push(`<text class="fb-channel-hint" x="${PAD}" y="${bandBottom + 26}">
      ↓ 以下为退款 / 回流通道（资金从右向左返回）</text>`);
  }

  const legend = `
    <div class="fb-legend">
      <span><i class="fb-swatch fb-swatch-forward"></i>入金 / 抵扣（左→右）</span>
      <span><i class="fb-swatch fb-swatch-refund"></i>退款 / 回流（右→左）</span>
      <span><i class="fb-swatch fb-swatch-dim"></i>推断连边（后端缺配对键）</span>
      <span class="fb-legend-note">线宽 ∝ 累计金额 · 节点高度 ∝ 余额</span>
    </div>`;

  const drift = graph.driftCount
    ? `<div class="fb-drift-warn">⚠️ ${graph.driftCount} 个资金池的「Σ入边 − Σ出边」与接口返回的 balance 不一致，
        该节点已标红 —— 说明流水里缺少对手方记录，图未能还原全部链路。</div>`
    : `<div class="fb-drift-ok">✓ 全部 ${graph.nodes.filter((n) => !n.virtual).length} 类资金池通过对账：
        每个节点的「Σ入边 − Σ出边」都等于接口返回的 balance，图上金额可直接核对。</div>`;

  container.innerHTML = `
    ${legend}
    <div class="fb-scroll">
      <svg class="fb-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
           role="img" aria-label="全局资金流向图">
        <defs>
          <!-- markerUnits="userSpaceOnUse"：默认 strokeWidth 会让箭头随线宽放大，
               粗边上会出现一个盖住节点的巨型三角形 -->
          <marker id="fb-arrow-forward" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#389e0d" />
          </marker>
          <marker id="fb-arrow-refund" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#cf1322" />
          </marker>
        </defs>
        ${parts.join('\n')}
      </svg>
    </div>
    ${drift}`;

  bindInteractions(container, graph, handlers);
}

function edgeLabel(x: number, y: number, e: FlowEdge, kind: 'forward' | 'refund', dim: boolean): string {
  const text = `${compactYuan(e.amount)}${e.items.length > 1 ? ` · ${e.items.length}笔` : ''}`;
  const w = text.length * 7.4 + 16;
  return `<g class="fb-edge-label fb-edge-label-${kind}${dim ? ' fb-edge-dim' : ''}"
      data-src="${esc(e.src)}" data-dst="${esc(e.dst)}" pointer-events="none">
    <rect x="${(x - w / 2).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${w.toFixed(1)}" height="22"
      rx="11" />
    <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${esc(text)}</text>
  </g>`;
}

function nodeBox(p: Placed): string {
  const { node } = p;
  const color = POOL_TYPE_COLOR[node.type];
  const icon = POOL_TYPE_ICON[node.type];
  const bad = node.drift !== 0;

  // 客户钱包的 balance 是负数（钱已流出客户），换成「已投入」更好读
  const isCustomer = node.type === 'CUSTOMER';
  const mainLabel = isCustomer ? '已投入' : node.virtual ? '净额' : '余额';
  const mainValue = isCustomer ? -node.balance : node.balance;
  const valueClass = mainValue > 0 ? 'pos' : mainValue < 0 ? 'neg' : 'zero';

  const meta = node.virtual
    ? '接口未给出对手方'
    : `${node.poolCount} 个池`;

  return `<g class="fb-node${bad ? ' fb-node-bad' : ''}${node.virtual ? ' fb-node-virtual' : ''}"
      data-id="${esc(node.id)}" tabindex="0" role="button"
      aria-label="${esc(`${node.label}，${mainLabel} ${formatYuan(mainValue)} 元，${meta}`)}">
    <rect class="fb-node-bg" x="${p.x}" y="${p.y.toFixed(1)}" width="${p.w}" height="${p.h.toFixed(1)}"
      rx="12" style="--fb-node-color:${color}" />
    <text class="fb-node-title" x="${p.x + 16}" y="${(p.y + 26).toFixed(1)}">${icon} ${esc(node.label)}</text>
    <text class="fb-node-meta" x="${p.x + p.w - 16}" y="${(p.y + 26).toFixed(1)}"
      text-anchor="end">${esc(meta)}</text>
    <text class="fb-node-value fb-${valueClass}" x="${p.x + 16}" y="${(p.y + 58).toFixed(1)}">
      <tspan class="fb-node-value-label">${mainLabel} </tspan>¥${esc(formatYuan(mainValue))}</text>
    <text class="fb-node-io" x="${p.x + 16}" y="${(p.y + 78).toFixed(1)}"
      >入 ${esc(formatSigned(node.inflow, '+'))}　出 ${esc(formatSigned(node.outflow, '−'))}</text>
    ${bad ? `<text class="fb-node-drift" x="${p.x + 16}" y="${(p.y + p.h - 10).toFixed(1)}"
      >⚠️ 对账差 ${esc(formatYuan(node.drift))}</text>` : ''}
  </g>`;
}

function bindInteractions(container: HTMLElement, graph: FlowGraph, handlers: FlowBoardHandlers): void {
  const svg = container.querySelector<SVGSVGElement>('.fb-svg');
  if (!svg) return;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const clearFocus = () => {
    svg.classList.remove('fb-focus-mode');
    svg.querySelectorAll('.fb-is-focus').forEach((el) => el.classList.remove('fb-is-focus'));
  };

  const focusNode = (id: string) => {
    svg.classList.add('fb-focus-mode');
    svg.querySelectorAll<SVGGElement>('.fb-node').forEach((el) => {
      if (el.dataset.id === id) el.classList.add('fb-is-focus');
    });
    // 与该节点相邻的边和标签一起高亮
    svg.querySelectorAll<SVGGElement>('.fb-edge, .fb-edge-label').forEach((el) => {
      if (el.dataset.src === id || el.dataset.dst === id) {
        el.classList.add('fb-is-focus');
        const other = el.dataset.src === id ? el.dataset.dst : el.dataset.src;
        svg.querySelectorAll<SVGGElement>('.fb-node').forEach((n) => {
          if (n.dataset.id === other) n.classList.add('fb-is-focus');
        });
      }
    });
  };

  svg.querySelectorAll<SVGGElement>('.fb-node').forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    el.addEventListener('mouseenter', () => focusNode(id));
    el.addEventListener('focus', () => focusNode(id));
    el.addEventListener('mouseleave', clearFocus);
    el.addEventListener('blur', clearFocus);
    const fire = () => {
      const node = nodeById.get(id);
      if (node) handlers.onNodeClick?.(node);
    };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fire(); }
    });
  });

  svg.querySelectorAll<SVGGElement>('.fb-edge').forEach((el) => {
    const { src, dst, kind } = el.dataset;
    if (!src || !dst) return;
    const edge = graph.edges.find((e) => e.src === src && e.dst === dst && e.kind === kind);
    if (!edge) return;
    el.addEventListener('mouseenter', () => {
      svg.classList.add('fb-focus-mode');
      el.classList.add('fb-is-focus');
      svg.querySelectorAll<SVGGElement>('.fb-node, .fb-edge-label').forEach((n) => {
        if (n.dataset.id === src || n.dataset.id === dst
          || (n.dataset.src === src && n.dataset.dst === dst)) n.classList.add('fb-is-focus');
      });
    });
    el.addEventListener('mouseleave', clearFocus);
    const fire = () => handlers.onEdgeClick?.(
      edge,
      nodeById.get(src)?.label ?? src,
      nodeById.get(dst)?.label ?? dst,
    );
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fire(); }
    });
  });
}
