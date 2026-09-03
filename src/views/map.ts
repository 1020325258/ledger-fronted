/**
 * 全局资金地图：以 transferGroupId 为唯一事件单位，把该主单的全部资金操作
 * 按时间串成一条可读、可核对的资金旅程。
 */
import { amount, escapeHtml, fmtClock, fmtDay, number, type FundPool } from '../api';
import { poolPalette, type ViewContext } from '../context';
import { groupEdges } from '../groups';
import { renderFundStream } from './stream';

interface AggregatedPoolFlow {
  fromType: string;
  toType: string;
  kind: 'FORWARD' | 'REFUND';
  amount: number;
  groupIds: Set<string>;
}

interface PoolFlowNode {
  type: string;
  label: string;
  balance: number;
  poolCount: number;
  operationCount: number;
  score: number;
}

function poolTypeLabel(type: string, pools: FundPool[]): string {
  return pools.find((pool) => pool.poolTypeDesc)?.poolTypeDesc || type;
}

function percentage(value: number, total: number): string {
  if (!total) return '0%';
  const ratio = value / total * 100;
  if (ratio >= 10) return `${ratio.toFixed(1)}%`;
  if (ratio >= 1) return `${ratio.toFixed(2)}%`;
  return `${ratio.toFixed(3)}%`;
}

function entryPoolType(ctx: ViewContext, poolId: string): string {
  const poolType = ctx.index.get(poolId)?.poolType;
  if (poolType) return poolType;
  return ctx.entries.find((entry) => entry.accountId === poolId)?.accountType || 'OTHER';
}

function aggregatePoolFlows(ctx: ViewContext): { nodes: PoolFlowNode[]; flows: AggregatedPoolFlow[]; omitted: number } {
  const flowMap = new Map<string, AggregatedPoolFlow>();
  let omitted = 0;
  ctx.groups.forEach((group) => {
    const edges = groupEdges(group);
    if (edges == null) {
      omitted += 1;
      return;
    }
    edges.forEach((edge) => {
      const fromType = entryPoolType(ctx, edge.from);
      const toType = entryPoolType(ctx, edge.to);
      const kind = group.info.kind === 'REFUND' ? 'REFUND' : 'FORWARD';
      const key = `${fromType}\u0000${toType}\u0000${kind}`;
      const flow = flowMap.get(key) ?? {
        fromType, toType, kind, amount: 0, groupIds: new Set<string>(),
      };
      flow.amount += number(edge.amount);
      flow.groupIds.add(group.groupId);
      flowMap.set(key, flow);
    });
  });

  const flows = [...flowMap.values()].filter((flow) => flow.amount > 0);
  const involvedTypes = new Set(flows.flatMap((flow) => [flow.fromType, flow.toType]));
  ctx.pools.filter((pool) => pool.poolScope !== 'EXTERNAL' && number(pool.balance) !== 0)
    .forEach((pool) => involvedTypes.add(pool.poolType || 'OTHER'));

  const nodes = [...involvedTypes].map((type) => {
    const pools = ctx.pools.filter((pool) => (pool.poolType || 'OTHER') === type);
    const label = poolTypeLabel(type, pools);
    const related = flows.filter((flow) => flow.fromType === type || flow.toType === type);
    const operationIds = new Set(related.flatMap((flow) => [...flow.groupIds]));
    const outgoing = flows.filter((flow) => flow.fromType === type)
      .reduce((sum, flow) => sum + flow.amount, 0);
    const incoming = flows.filter((flow) => flow.toType === type)
      .reduce((sum, flow) => sum + flow.amount, 0);
    return {
      type,
      label,
      balance: pools.reduce((sum, pool) => sum + number(pool.balance), 0),
      poolCount: pools.length,
      operationCount: operationIds.size,
      score: outgoing - incoming,
    };
  }).sort((a, b) => b.score - a.score || b.operationCount - a.operationCount || a.label.localeCompare(b.label));
  return { nodes, flows, omitted };
}

/** 将正交折线路径的每个转角转换为圆弧，保留清晰走向的同时避免生硬直角。 */
function roundedFlowPath(points: Array<[number, number]>, radius = 18): string {
  if (points.length < 2) return '';
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const outgoing = Math.hypot(next[0] - current[0], next[1] - current[1]);
    if (!incoming || !outgoing) continue;
    const corner = Math.min(radius, incoming / 2, outgoing / 2);
    const beforeX = current[0] + (previous[0] - current[0]) * corner / incoming;
    const beforeY = current[1] + (previous[1] - current[1]) * corner / incoming;
    const afterX = current[0] + (next[0] - current[0]) * corner / outgoing;
    const afterY = current[1] + (next[1] - current[1]) * corner / outgoing;
    path += ` L${beforeX},${beforeY} Q${current[0]},${current[1]} ${afterX},${afterY}`;
  }
  const last = points[points.length - 1];
  return `${path} L${last[0]},${last[1]}`;
}

function poolFlowGraph(ctx: ViewContext): string {
  const { nodes, flows, omitted } = aggregatePoolFlows(ctx);
  if (nodes.length < 2 || !flows.length) return '';

  const width = 1200;
  const cardWidth = 236;
  const columnGap = 172;
  const rowGap = 26;
  const nodeMinHeight = 82;
  const nodeMaxHeight = 152;
  const bandTop = 100;
  const columns: PoolFlowNode[][] = [[], [], []];
  const columnOf = (node: PoolFlowNode): number => {
    const external = ctx.pools.some((pool) => pool.poolType === node.type && pool.poolScope === 'EXTERNAL');
    if (external || node.type === 'CUSTOMER' || node.type === 'DEVELOPER') return 0;
    if (node.type === 'ADVANCE' || node.type === 'WALLET') return 1;
    if (node.type === 'SUB_ORDER' || node.type === 'FUND') return 2;
    return 1;
  };
  nodes.forEach((node) => columns[columnOf(node)].push(node));
  columns.forEach((column) => column.sort((a, b) => b.operationCount - a.operationCount || a.label.localeCompare(b.label)));

  const maxBalance = Math.max(...nodes.map((node) => Math.abs(node.balance)), 1);
  const nodeHeight = (node: PoolFlowNode): number => nodeMinHeight
    + (nodeMaxHeight - nodeMinHeight) * Math.sqrt(Math.abs(node.balance) / maxBalance);
  const columnHeights = columns.map((column) => column.reduce((sum, node) => sum + nodeHeight(node), 0)
    + Math.max(0, column.length - 1) * rowGap);
  const bandHeight = Math.max(...columnHeights, nodeMinHeight);
  const height = bandTop + bandHeight + 44;
  const columnX = [28, 28 + cardWidth + columnGap, 28 + (cardWidth + columnGap) * 2];
  const positions = new Map<string, { column: number; row: number; x: number; y: number; h: number }>();
  columns.forEach((column, columnIndex) => {
    let y = bandTop + (bandHeight - columnHeights[columnIndex]) / 2;
    column.forEach((node, row) => {
      const h = nodeHeight(node);
      positions.set(node.type, { column: columnIndex, row, x: columnX[columnIndex], y, h });
      y += h + rowGap;
    });
  });
  const orderedFlows = flows.slice().sort((a, b) => b.amount - a.amount || b.groupIds.size - a.groupIds.size);
  const nodeByType = new Map(nodes.map((node) => [node.type, node]));
  const maxFlowAmount = Math.max(...orderedFlows.map((flow) => flow.amount), 1);
  const hasOppositeDirection = (flow: AggregatedPoolFlow): boolean => orderedFlows.some((candidate) => (
    candidate.fromType === flow.toType && candidate.toType === flow.fromType
  ));
  const endpointY = (flow: AggregatedPoolFlow, nodeType: string): number => {
    const position = positions.get(nodeType)!;
    if (hasOppositeDirection(flow)) {
      const pairOffset = flow.kind === 'REFUND' ? 10 : -10;
      return position.y + position.h / 2 + pairOffset;
    }
    const related = orderedFlows.filter((candidate) => (
      candidate.fromType === nodeType || candidate.toType === nodeType
    ));
    const portIndex = Math.max(0, related.indexOf(flow));
    return position.y + position.h * ((portIndex + 1) / (related.length + 1));
  };
  const flowVisual = (flow: AggregatedPoolFlow): { color: string; kind: string } => flow.kind === 'REFUND'
    ? { color: '#cf1322', kind: 'outflow' }
    : { color: '#389e0d', kind: 'inflow' };
  const strokeWidthOf = (flow: AggregatedPoolFlow): number => 3 + 10 * Math.sqrt(flow.amount / maxFlowAmount);
  // 箭头与线宽使用固定比例缩放；箭头轮廓始终明显宽于线条，避免粗线吞没方向感。
  const markerWidthOf = (strokeWidth: number): number => strokeWidth * 1.65;
  const markerHeightOf = (strokeWidth: number): number => strokeWidth * 2.4;
  const definitions = orderedFlows.map((flow, index) => {
    const { color } = flowVisual(flow);
    const strokeWidth = strokeWidthOf(flow);
    const markerWidth = markerWidthOf(strokeWidth);
    const markerHeight = markerHeightOf(strokeWidth);
    return `<marker id="pool-flow-arrow-${index}" viewBox="0 0 10 14" markerWidth="${markerWidth.toFixed(1)}" markerHeight="${markerHeight.toFixed(1)}" refX=".8" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M.8,1 L9.5,7 L.8,13 Z" fill="${color}"/></marker>`;
  }).join('');
  let topLane = 0;
  const adjacentLaneCounts = [0, 0];
  const adjacentFlowCounts = [0, 1].map((gapColumn) => orderedFlows.filter((flow) => {
    const from = positions.get(flow.fromType)!;
    const to = positions.get(flow.toType)!;
    return Math.abs(to.column - from.column) === 1 && Math.min(from.column, to.column) === gapColumn;
  }).length);
  const loopLaneCounts = new Map<string, number>();
  const edgeModels = orderedFlows.map((flow, index) => {
    const from = positions.get(flow.fromType)!;
    const to = positions.get(flow.toType)!;
    const { color, kind } = flowVisual(flow);
    const count = flow.groupIds.size;
    const strokeWidth = strokeWidthOf(flow);
    const fromCenterY = endpointY(flow, flow.fromType);
    const toCenterY = endpointY(flow, flow.toType);
    let path = '';
    let labelX = 0;
    let labelY = 0;
    const columnDistance = Math.abs(to.column - from.column);
    const rightward = to.column > from.column;
    const startX = rightward ? from.x + cardWidth : from.x;
    const targetEdgeX = rightward ? to.x : to.x + cardWidth;
    const endpointGap = markerWidthOf(strokeWidth) + 1;
    const endX = targetEdgeX + (rightward ? -endpointGap : endpointGap);
    if (columnDistance > 1) {
      const laneIndex = topLane;
      // 入场通道必须比箭头预留距离更长，确保路径末段始终朝向目标节点。
      const channelOffset = Math.max(22 + laneIndex * 18, endpointGap + 12);
      const exitX = startX + (rightward ? channelOffset : -channelOffset);
      const enterX = targetEdgeX + (rightward ? -channelOffset : channelOffset);
      const laneY = 54 + topLane * 26;
      topLane += 1;
      path = roundedFlowPath([[startX, fromCenterY], [exitX, fromCenterY], [exitX, laneY], [enterX, laneY], [enterX, toCenterY], [endX, toCenterY]], 12);
      labelX = (exitX + enterX) / 2;
      labelY = laneY;
    } else if (columnDistance === 1) {
      const gapColumn = Math.min(from.column, to.column);
      const laneIndex = adjacentLaneCounts[gapColumn];
      adjacentLaneCounts[gapColumn] += 1;
      const leftEdgeX = columnX[gapColumn] + cardWidth;
      const rightEdgeX = columnX[gapColumn + 1];
      const channelX = leftEdgeX + (rightEdgeX - leftEdgeX)
        * ((laneIndex + 1) / (adjacentFlowCounts[gapColumn] + 1));
      path = roundedFlowPath([[startX, fromCenterY], [channelX, fromCenterY], [channelX, toCenterY], [endX, toCenterY]], 12);
      labelX = channelX;
      labelY = (fromCenterY + toCenterY) / 2;
    } else if (columnDistance === 0) {
      const loopRight = from.row <= to.row;
      const edgeX = loopRight ? from.x + cardWidth : from.x;
      const loopKey = `${from.column}:${loopRight ? 'right' : 'left'}`;
      const loopLane = loopLaneCounts.get(loopKey) ?? 0;
      loopLaneCounts.set(loopKey, loopLane + 1);
      const loopX = edgeX + (loopRight ? 1 : -1) * (34 + loopLane * 18);
      const targetX = (loopRight ? to.x + cardWidth : to.x) + (loopRight ? endpointGap : -endpointGap);
      path = roundedFlowPath([[edgeX, fromCenterY], [loopX, fromCenterY], [loopX, toCenterY], [targetX, toCenterY]], 12);
      labelX = loopX;
      labelY = (fromCenterY + toCenterY) / 2;
    }
    const label = `¥${amount(flow.amount)} · ${count}次`;
    const labelWidth = Math.min(148, Math.max(92, 24 + label.length * 6));
    return { flow, index, color, kind, strokeWidth, path, label, labelWidth, labelX, labelY };
  });
  const pathHalos = edgeModels.map(({ index, kind, path, strokeWidth }) => (
    `<path class="map-pool-flow-edge edge-halo ${kind}" data-flow-index="${index}" d="${path}" fill="none" stroke-width="${(strokeWidth + 3).toFixed(1)}"/>`
  )).join('');
  const pathLines = edgeModels.map(({ flow, index, color, kind, path, strokeWidth, label }) => (
    `<path class="map-pool-flow-edge edge-line ${kind}" data-flow-index="${index}" d="${path}" fill="none" stroke="${color}" stroke-width="${strokeWidth.toFixed(1)}"><title>${escapeHtml(`${flow.fromType} → ${flow.toType}，累计 ${label}`)}</title></path>`
  )).join('');
  const pathArrows = edgeModels.map(({ index, path }) => (
    `<path class="map-pool-flow-edge edge-arrow-carrier" data-flow-index="${index}" d="${path}" fill="none" stroke="transparent" stroke-width="1" marker-end="url(#pool-flow-arrow-${index})"/>`
  )).join('');
  const pathLabels = edgeModels.map(({ index, kind, label, labelWidth, labelX, labelY }) => (
    `<g class="map-pool-flow-edge edge-label ${kind}" data-flow-index="${index}" transform="translate(${labelX} ${labelY})"><rect x="${-labelWidth / 2}" y="-11" width="${labelWidth}" height="22" rx="6"/><text y="4" text-anchor="middle">${escapeHtml(label)}</text></g>`
  )).join('');
  const pathHits = edgeModels.map(({ flow, index, path, strokeWidth }) => {
    const selection = {
      fromType: flow.fromType,
      fromLabel: nodeByType.get(flow.fromType)?.label ?? flow.fromType,
      toType: flow.toType,
      toLabel: nodeByType.get(flow.toType)?.label ?? flow.toType,
      amount: flow.amount,
      groupIds: [...flow.groupIds],
    };
    return `<path class="map-pool-flow-edge edge-hit" data-flow-index="${index}" data-flow-selection="${escapeHtml(JSON.stringify(selection))}" d="${path}" fill="none" stroke="transparent" stroke-width="${Math.max(22, strokeWidth + 14).toFixed(1)}" role="button" tabindex="0"><title>查看${escapeHtml(selection.fromLabel)}到${escapeHtml(selection.toLabel)}的${selection.groupIds.length}次资金操作</title></path>`;
  }).join('');
  const nodeMarkup = nodes.map((node) => {
    const position = positions.get(node.type)!;
    const historicalNodeColors: Record<string, string> = {
      CUSTOMER: '#eb2f96', ADVANCE: '#faad14', WALLET: '#1890ff',
      SUB_ORDER: '#52c41a', FUND: '#722ed1', DEVELOPER: '#8c8c8c', OTHER: '#8c8c8c',
    };
    const nodeColor = historicalNodeColors[node.type] ?? historicalNodeColors.OTHER;
    return `<g class="map-pool-flow-node" data-flow-pool-type="${escapeHtml(node.type)}" role="button" tabindex="0" transform="translate(${position.x} ${position.y})">
      <title>查看${escapeHtml(node.label)}资金池明细</title>
      <rect class="node-bg" width="${cardWidth}" height="${position.h}" rx="12" style="--node-stroke:${nodeColor}"/>
      <circle class="node-icon-bg" cx="24" cy="27" r="11" style="--node-stroke:${nodeColor}"/>
      <circle cx="24" cy="27" r="4" fill="${nodeColor}"/>
      <text class="node-name" x="44" y="31">${escapeHtml(node.label)}</text>
      <text class="node-count" x="228" y="30" text-anchor="end">${node.poolCount} 个池</text>
      <text class="node-value" x="18" y="58">¥ ${escapeHtml(amount(Math.abs(node.balance)))}</text>
      <text class="node-meta" x="18" y="${Math.max(76, position.h - 13)}">${escapeHtml(node.type)} · ${node.operationCount} 次流转</text>
    </g>`;
  }).join('');
  const omittedHint = omitted
    ? `<span>${omitted} 组多对多关系未绘制，避免推测资金对应关系</span>` : '';
  const columnTitles = ['资金来源', '中间归集池', '业务承接池'].map((title, index) => (
    `<text class="flow-column-title" x="${columnX[index] + cardWidth / 2}" y="38" text-anchor="middle">${title}</text>`
  )).join('');
  return `<div class="map-pool-flow">
    <div class="map-pool-flow-title"><span><b>资金池流转</b><small>按 accountType 聚合展示资金去向，线宽按累计流转金额的平方根缩放</small></span><span class="map-pool-flow-legend"><i class="in"></i>入金 / 抵扣<i class="out"></i>退款 / 回流</span>${omittedHint}</div>
    <div class="map-pool-flow-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="资金池之间的聚合金额流转图"><defs>${definitions}</defs>${columnTitles}${pathHalos}${pathLines}${nodeMarkup}${pathArrows}${pathLabels}${pathHits}</svg></div>
  </div>`;
}

function mapPoolPosition(ctx: ViewContext): string {
  const held = ctx.pools.filter((pool) => pool.poolScope !== 'EXTERNAL' && number(pool.balance) > 0);
  if (!held.length) return '';
  const grouped = new Map<string, FundPool[]>();
  held.forEach((pool) => {
    const type = pool.poolType ?? 'OTHER';
    grouped.set(type, [...(grouped.get(type) ?? []), pool]);
  });
  const groups = [...grouped.entries()].map(([type, pools]) => ({
    type,
    pools: pools.sort((a, b) => number(b.balance) - number(a.balance)),
    total: pools.reduce((sum, pool) => sum + number(pool.balance), 0),
  })).sort((a, b) => b.total - a.total);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const distribution = groups.map((group) => {
    const palette = poolPalette(group.type);
    const ratio = total ? group.total / total * 100 : 0;
    const compact = ratio < 8 ? ' compact' : '';
    const compactHint = ratio < 8 ? '<i>小比例放大</i>' : '';
    return `<button type="button" class="map-position-segment${compact}" data-pool-type="${escapeHtml(group.type)}"
      style="--pool:${palette.main};--share:${ratio}" title="${escapeHtml(poolTypeLabel(group.type, group.pools))}：${amount(group.total)} 元，占 ${percentage(group.total, total)}">
      <span>${escapeHtml(poolTypeLabel(group.type, group.pools))}</span><b>${percentage(group.total, total)}</b>${compactHint}
    </button>`;
  }).join('');
  return `<section class="map-position-card">
    <header><span><b>客户资金分布</b><small>客户资金当前分散在哪些资金池；点击比例或池子查看明细</small></span><strong>${amount(total)} 元</strong></header>
    <div class="map-position-distribution">
      <div class="map-position-bar">${distribution}</div>
    </div>
    ${poolFlowGraph(ctx)}
  </section>`;
}

export function renderMoneyMap(target: HTMLElement, ctx: ViewContext, focus?: string): void {
  const groups = ctx.groups.slice().reverse();
  const actionStats = new Map<string, { label: string; count: number; amount: number; kind: string }>();
  groups.forEach((group) => {
    const key = group.groupType || 'UNKNOWN';
    const stat = actionStats.get(key) ?? { label: group.info.label, count: 0, amount: 0, kind: group.info.kind };
    stat.count += 1;
    stat.amount += group.amount;
    actionStats.set(key, stat);
  });

  const actionOverview = [...actionStats.entries()].map(([groupType, stat]) => {
    const css = stat.kind === 'PAY' ? 'pay' : stat.kind === 'REFUND' ? 'refund' : 'other';
    const events = groups.filter((group) => (group.groupType || 'UNKNOWN') === groupType)
      .map((group) => `<button type="button" data-group="${escapeHtml(group.groupId)}"><time>${escapeHtml(fmtDay(group.startTime))} ${escapeHtml(fmtClock(group.startTime))}</time><span>${escapeHtml(group.info.label)}</span><strong>${amount(group.amount)} 元</strong><i>→</i></button>`).join('');
    return `<details class="money-map-action-stat ${css}"><summary title="groupType: ${escapeHtml(groupType)}"><span><small>${escapeHtml(stat.label)}</small><em>累计 ${amount(stat.amount)} 元</em></span><b>${stat.count} 次</b></summary><div>${events}</div></details>`;
  }).join('');

  target.innerHTML = `<section class="money-map-hero compact">
      <div class="money-map-hero-copy"><span class="eyebrow">GLOBAL MONEY JOURNEY</span><h2>资金地图</h2>
        <p>沿时间向下阅读每一次资金操作，横向看钱从哪个资金池离开、进入哪里；点击任意一行可追溯到具体池号和业务证据。</p>
        <div class="money-map-hero-meta"><span>${groups.length} 次资金操作</span><i></i><span>${groups.length ? `${fmtDay(groups[0].startTime)} — ${fmtDay(groups[groups.length - 1].startTime)}` : '暂无操作'}</span></div>
      </div>
    </section>
    <div class="money-map-overview">${actionOverview}</div>
    ${mapPoolPosition(ctx)}
    <section id="mapFundStream" class="map-fund-stream"></section>`;

  const streamHost = target.querySelector<HTMLElement>('#mapFundStream');
  if (streamHost) renderFundStream(streamHost, ctx, focus);

  target.querySelectorAll<HTMLElement>('[data-group]').forEach((node) => {
    const open = (): void => ctx.openGroup(node.dataset.group as string);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      open();
    });
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
  target.querySelectorAll<HTMLElement>('[data-pool-type]').forEach((node) => {
    node.addEventListener('click', () => ctx.openPoolType(node.dataset.poolType as string));
  });
  target.querySelectorAll<SVGGElement>('[data-flow-pool-type]').forEach((node) => {
    const open = (): void => ctx.openPoolType(node.dataset.flowPoolType as string);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
  target.querySelectorAll<SVGPathElement>('[data-flow-selection]').forEach((node) => {
    const highlight = (active: boolean): void => {
      target.querySelectorAll(`[data-flow-index="${node.dataset.flowIndex}"]`)
        .forEach((part) => part.classList.toggle('is-active', active));
    };
    const open = (): void => {
      const raw = node.dataset.flowSelection;
      if (raw) ctx.openPoolFlow(JSON.parse(raw));
    };
    node.addEventListener('mouseenter', () => highlight(true));
    node.addEventListener('mouseleave', () => highlight(false));
    node.addEventListener('focus', () => highlight(true));
    node.addEventListener('blur', () => highlight(false));
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
}
