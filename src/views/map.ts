/**
 * 全局资金地图：以 transferGroupId 为唯一事件单位，把该主单的全部资金操作
 * 按时间串成一条可读、可核对的资金旅程。
 */
import { amount, escapeHtml, fmtClock, fmtDay, number, type LedgerEntry } from '../api';
import { poolInk, poolSoft, type ViewContext } from '../context';
import { CHANGE_SOURCES, CHANGE_TYPES, REFUND_MODES, poolTypeInfo } from '../codes';
import { groupEdges, type TxnGroup } from '../groups';

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function descriptions(group: TxnGroup): string[] {
  return unique(group.legs.map((leg) => String(leg.fundActionDesc ?? '').trim()))
    .filter((value) => value !== 'null' && value !== 'undefined');
}
function internalDelta(group: TxnGroup, ctx: ViewContext): number {
  return group.legs.reduce((sum, leg) => {
    const pool = ctx.index.get(leg.accountId ?? '');
    if (!pool || pool.poolScope === 'EXTERNAL') return sum;
    const cents = Math.round(number(leg.amount) * 100);
    return sum + (leg.direction === 'INFLOW' ? cents : -cents);
  }, 0) / 100;
}
function mergedMetadata(group: TxnGroup): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  group.legs.forEach((leg) => Object.entries(leg.metadata ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== '' && result[key] === undefined) result[key] = value;
  }));
  return result;
}
function reason(group: TxnGroup): string[] {
  const meta = mergedMetadata(group);
  const result: string[] = [];
  const changeType = CHANGE_TYPES[Number(meta.changeType)];
  const changeSource = CHANGE_SOURCES[Number(meta.changeSource)];
  const refundMode = REFUND_MODES[Number(meta.refundMode)];
  if (changeType && changeType !== '默认') result.push(`报价变更：${changeType}`);
  if (changeSource && changeSource !== '未知') result.push(`变动来源：${changeSource}`);
  if (refundMode) result.push(`退款去向：${refundMode}`);
  if (meta.afterSaleNo ?? meta.afterSalesNo) result.push(`售后单 ${String(meta.afterSaleNo ?? meta.afterSalesNo)}`);
  if (meta.projectChangeNo) result.push(`变更单 ${String(meta.projectChangeNo)}`);
  if (meta.transactionNo) result.push(`资金流水 ${String(meta.transactionNo)}`);
  return result;
}
function effect(delta: number): { css: string; label: string } {
  if (delta > .005) return { css: 'in', label: `内部存量 +${amount(delta)}` };
  if (delta < -.005) return { css: 'out', label: `内部存量 −${amount(Math.abs(delta))}` };
  return { css: 'move', label: '内部移动 · 总存量不变' };
}
function shortText(value: string, size = 18): string { return value.length > size ? `${value.slice(0, size - 1)}…` : value; }
function legPoolType(leg: LedgerEntry, ctx: ViewContext): string {
  return leg.accountType || ctx.index.get(leg.accountId ?? '')?.poolType || 'OTHER';
}
function poolTypeLabel(type: string): string {
  if (type === 'CUSTOMER') return '客户付款来源';
  return poolTypeInfo(type).label;
}

export function renderMoneyMap(target: HTMLElement, ctx: ViewContext): void {
  const groups = ctx.groups.slice().reverse();
  let balance = 0;
  let inflow = 0;
  let outflow = 0;
  let moved = 0;
  const balanceAfter = new Map<string, number>();
  groups.forEach((group) => {
    const delta = internalDelta(group, ctx);
    balance += delta;
    if (delta > .005) inflow += delta;
    else if (delta < -.005) outflow += Math.abs(delta);
    else moved += group.amount;
    balanceAfter.set(group.groupId, balance);
  });

  const typeOrder = ['CUSTOMER', 'DEVELOPER', 'FUND', 'SUB_ORDER', 'ADVANCE', 'WALLET', 'OTHER'];
  const usedTypes = new Set(groups.flatMap((group) => group.legs.map((leg) => legPoolType(leg, ctx))));
  const lanes = [...usedTypes].sort((a, b) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });
  const AXIS_LEFT = 196;
  const availableWidth = Math.max(860, target.clientWidth - 2);
  const COL_W = Math.max(176, Math.floor((availableWidth - AXIS_LEFT - 24) / Math.max(1, lanes.length)));
  const HEADER_H = 82;
  const ROW_H = 112;
  const CARD_W = Math.min(226, Math.max(144, COL_W - 34));
  const CARD_H = 58;
  const width = AXIS_LEFT + lanes.length * COL_W + 24;
  const height = HEADER_H + groups.length * ROW_H + 24;
  const laneX = new Map(lanes.map((type, index) => [type, AXIS_LEFT + index * COL_W + COL_W / 2]));
  const laneIndex = new Map(lanes.map((type, index) => [type, index]));
  const tone = { in: '#2c987a', move: '#7464c4', out: '#d15b67' };

  const headers = lanes.map((type, index) => {
    const info = poolTypeInfo(type);
    const pools = ctx.pools.filter((pool) => pool.poolType === type);
    const typeBalance = pools.reduce((sum, pool) => sum + number(pool.balance), 0);
    const x = AXIS_LEFT + index * COL_W;
    return `<g><rect x="${x}" y="0" width="${COL_W}" height="${HEADER_H}" class="map-axis-head"/>
      <rect x="${x + 1}" y="0" width="${COL_W - 2}" height="3" fill="${poolInk(type)}" opacity=".78"/>
      <circle cx="${x + 20}" cy="27" r="5" fill="${poolInk(type)}"/>
      <text x="${x + 34}" y="31" class="map-axis-pool">${escapeHtml(poolTypeLabel(type))}</text>
      <text x="${x + 20}" y="53" class="map-axis-id">${escapeHtml(info.scope === 'EXTERNAL' ? '系统外资金起点 / 终点' : `${pools.length} 个具体资金池`)}</text>
      <text x="${x + 20}" y="69" class="map-axis-balance">${escapeHtml(info.scope === 'EXTERNAL' ? '不计入内部账面存量' : `当前存量 ${amount(typeBalance)}`)}</text>
      <line x1="${x + COL_W / 2}" y1="${HEADER_H}" x2="${x + COL_W / 2}" y2="${height - 16}" class="map-axis-lane"/></g>`;
  }).join('');

  const rows = groups.map((group, index) => {
    const edges = groupEdges(group);
    const y = HEADER_H + index * ROW_H + ROW_H / 2;
    const state = effect(internalDelta(group, ctx));
    const color = tone[state.css as keyof typeof tone];
    const descs = descriptions(group);
    const why = reason(group);
    const day = fmtDay(group.startTime);
    const rowBg = `<rect x="0" y="${y - ROW_H / 2}" width="${width}" height="${ROW_H}" class="map-axis-row ${index % 2 ? 'alt' : ''}"/><rect x="0" y="${y - ROW_H / 2}" width="${AXIS_LEFT}" height="${ROW_H}" class="map-axis-time-cell ${index % 2 ? 'alt' : ''}"/>`;
    const dayChanged = index === 0 || day !== fmtDay(groups[index - 1].startTime);
    const timeLabel = `${dayChanged ? `<text x="12" y="${y - 20}" class="map-axis-day">${escapeHtml(day)}</text>` : ''}
      <text x="12" y="${y - 3}" class="map-axis-time">${escapeHtml(fmtClock(group.startTime))}</text>
      <text x="72" y="${y - 3}" class="map-axis-action">${escapeHtml(group.info.label)}</text>
      <text x="12" y="${y + 16}" class="map-axis-group-amount">${escapeHtml(amount(group.amount))} 元</text>
      <text x="72" y="${y + 16}" class="map-axis-effect ${state.css}">${escapeHtml(shortText(state.label, 16))}</text>`;
    if (!edges?.length) return `<g class="map-axis-event" data-group="${escapeHtml(group.groupId)}"><title>${escapeHtml(`${group.info.label} · ${descs.join(' / ')} · ${why.join(' / ')}`)}</title>${rowBg}${timeLabel}<text x="${AXIS_LEFT + 16}" y="${y + 4}" class="map-axis-unresolved">路径无法由账本唯一还原，点击查看详情</text></g>`;
    const endpointMap = new Map<string, { type: string; direction: 'OUTFLOW' | 'INFLOW'; amount: number; descriptions: string[]; pools: Set<string> }>();
    group.legs.forEach((leg) => {
      const type = legPoolType(leg, ctx);
      const direction = leg.direction === 'OUTFLOW' ? 'OUTFLOW' : 'INFLOW';
      const key = `${direction}:${type}`;
      const endpoint = endpointMap.get(key) ?? { type, direction, amount: 0, descriptions: [], pools: new Set<string>() };
      endpoint.amount += number(leg.amount);
      const description = String(leg.fundActionDesc ?? '').trim();
      if (description && !endpoint.descriptions.includes(description)) endpoint.descriptions.push(description);
      if (leg.accountId) endpoint.pools.add(leg.accountId);
      endpointMap.set(key, endpoint);
    });
    const sameType = new Set<string>();
    lanes.forEach((type) => { if (endpointMap.has(`OUTFLOW:${type}`) && endpointMap.has(`INFLOW:${type}`)) sameType.add(type); });
    const cardCenterY = (direction: 'OUTFLOW' | 'INFLOW', type: string): number => sameType.has(type) ? y + (direction === 'OUTFLOW' ? -28 : 28) : y;
    const routePairs = new Map<string, { from: string; to: string }>();
    edges.forEach((edge) => {
      const fromLeg = group.outLegs.find((leg) => leg.accountId === edge.from);
      const toLeg = group.inLegs.find((leg) => leg.accountId === edge.to);
      const from = fromLeg ? legPoolType(fromLeg, ctx) : 'OTHER';
      const to = toLeg ? legPoolType(toLeg, ctx) : 'OTHER';
      routePairs.set(`${from}>${to}`, { from, to });
    });
    const pairs = [...routePairs.values()];
    const fromTypes = unique(pairs.map((pair) => pair.from));
    const toTypes = unique(pairs.map((pair) => pair.to));
    const fanOutSource = fromTypes.length === 1 && toTypes.length > 1 ? fromTypes[0] : '';
    const fanOutDirections = fanOutSource ? unique(toTypes.map((type) => String(Math.sign((laneIndex.get(type) ?? 0) - (laneIndex.get(fanOutSource) ?? 0))))) : [];
    const canDrawFanOut = Boolean(fanOutSource && fanOutDirections.length === 1 && fanOutDirections[0] !== '0');
    const drawRoute = ({ from, to }: { from: string; to: string }, routeIndex: number, sharedStart?: { x: number; y: number }): string => {
      const x1 = laneX.get(from) as number;
      const x2 = laneX.get(to) as number;
      const y1 = cardCenterY('OUTFLOW', from);
      const y2 = cardCenterY('INFLOW', to);
      if (x1 === x2) {
        const right = x1 + CARD_W / 2;
        return `<path d="M ${right} ${y1} C ${right + 30} ${y1}, ${right + 30} ${y2}, ${right} ${y2}" class="map-axis-route" style="stroke:${color}"/><polygon points="${right},${y2} ${right + 8},${y2 - 5} ${right + 8},${y2 + 5}" fill="${color}"/>`;
      }
      const direction = x2 > x1 ? 1 : -1;
      const start = sharedStart?.x ?? x1 + direction * (CARD_W / 2);
      const startY = sharedStart?.y ?? y1;
      const end = x2 - direction * (CARD_W / 2);
      const tip = end - direction * 8;
      const triangle = `${end},${y2} ${tip},${y2 - 5} ${tip},${y2 + 5}`;
      const fromIndex = laneIndex.get(from) ?? 0;
      const toIndex = laneIndex.get(to) ?? 0;
      const span = Math.abs(toIndex - fromIndex);
      const blocked = lanes.slice(Math.min(fromIndex, toIndex) + 1, Math.max(fromIndex, toIndex))
        .some((type) => endpointMap.has(`OUTFLOW:${type}`) || endpointMap.has(`INFLOW:${type}`));
      if (span <= 1 || !blocked) return `<path d="M ${start} ${startY} C ${(start + end) / 2} ${startY}, ${(start + end) / 2} ${y2}, ${tip} ${y2}" class="map-axis-route" style="stroke:${color}"/><polygon points="${triangle}" fill="${color}"/>`;
      const trackY = y - 40 - routeIndex * 5;
      const startBend = start + direction * 14;
      const endBend = end - direction * 14;
      const route = `M ${start} ${startY} L ${startBend} ${startY} Q ${startBend} ${trackY} ${startBend + direction * 10} ${trackY} L ${endBend - direction * 10} ${trackY} Q ${endBend} ${trackY} ${endBend} ${y2} L ${tip} ${y2}`;
      return `<path d="${route}" class="map-axis-route map-axis-route-bypass" style="stroke:${color}"/><polygon points="${triangle}" fill="${color}"/>`;
    };
    let paths: string;
    if (canDrawFanOut) {
      const sourceX = laneX.get(fanOutSource) as number;
      const sourceY = cardCenterY('OUTFLOW', fanOutSource);
      const direction = Number(fanOutDirections[0]);
      const cardEdge = sourceX + direction * (CARD_W / 2);
      const branchX = cardEdge + direction * 18;
      const farTarget = toTypes.reduce((best, type) => Math.abs((laneX.get(type) as number) - sourceX) > Math.abs((laneX.get(best) as number) - sourceX) ? type : best, toTypes[0]);
      const labelX = (branchX + (laneX.get(farTarget) as number)) / 2;
      paths = `<line x1="${cardEdge}" y1="${sourceY}" x2="${branchX}" y2="${sourceY}" class="map-axis-route" style="stroke:${color}"/>
        <circle cx="${branchX}" cy="${sourceY}" r="5" class="map-axis-branch" style="fill:${color}"/>
        <rect x="${labelX - 62}" y="${sourceY - 51}" width="124" height="20" rx="10" class="map-axis-branch-pill"/>
        <text x="${labelX}" y="${sourceY - 37}" text-anchor="middle" class="map-axis-branch-label">同一笔付款 · 拆分 ${toTypes.length} 笔</text>
        ${pairs.map((pair, routeIndex) => drawRoute(pair, routeIndex, { x: branchX, y: sourceY })).join('')}`;
    } else {
      paths = pairs.map((pair, routeIndex) => drawRoute(pair, routeIndex)).join('');
    }
    const cards = [...endpointMap.values()].map((endpoint) => {
      const x = laneX.get(endpoint.type) as number;
      const cardY = cardCenterY(endpoint.direction, endpoint.type);
      const outgoing = endpoint.direction === 'OUTFLOW';
      const operation = endpoint.descriptions.length ? endpoint.descriptions.join(' / ') : group.info.label;
      const poolCount = endpoint.pools.size > 1 ? ` · ${endpoint.pools.size}个池` : '';
      const cardLeft = x - CARD_W / 2;
      const cardTop = cardY - CARD_H / 2;
      return `<g class="map-axis-endpoint ${outgoing ? 'out' : 'in'}"><title>${escapeHtml(`${poolTypeLabel(endpoint.type)}${outgoing ? '出金' : '入金'} ${amount(endpoint.amount)} 元 · ${operation}${poolCount}`)}</title>
        <rect x="${cardLeft}" y="${cardTop}" width="${CARD_W}" height="${CARD_H}" rx="12" class="map-axis-card-bg"/>
        <rect x="${cardLeft}" y="${cardTop + 8}" width="4" height="${CARD_H - 16}" rx="2" fill="${poolInk(endpoint.type)}"/>
        <rect x="${cardLeft + 13}" y="${cardTop + 10}" width="${outgoing ? 38 : 36}" height="17" rx="8.5" fill="${poolSoft(endpoint.type)}"/>
        <text x="${cardLeft + 32}" y="${cardTop + 22}" text-anchor="middle" class="map-axis-card-role" style="fill:${poolInk(endpoint.type)}">${outgoing ? '出金' : '入金'}</text>
        <text x="${x + CARD_W / 2 - 14}" y="${cardTop + 23}" class="map-axis-card-value">${escapeHtml(amount(endpoint.amount))}</text>
        <text x="${cardLeft + 14}" y="${cardTop + 45}" class="map-axis-card-desc">${escapeHtml(shortText(operation, 16))}${escapeHtml(poolCount)}</text></g>`;
    }).join('');
    return `<g class="map-axis-event" data-group="${escapeHtml(group.groupId)}"><title>${escapeHtml(`${group.info.label} · ${descs.join(' / ')}${why.length ? ` · ${why.join(' / ')}` : ''} · 操作后存量 ${amount(balanceAfter.get(group.groupId))}`)}</title>${rowBg}${timeLabel}${paths}${cards}</g>`;
  }).join('');

  target.innerHTML = `<div class="view-head money-map-head"><span class="eyebrow">GLOBAL MONEY JOURNEY</span><h2>资金地图</h2>
    <p>纵轴是操作时间，横轴是资金池类型；每一行代表一次完整资金操作，两端卡片分别解释为什么出金、为什么入金。</p></div>
    <div class="money-map-overview">
      <span><small>资金操作</small><b>${groups.length} 次</b><em>${groups.length ? `${fmtDay(groups[0].startTime).slice(5)} — ${fmtDay(groups[groups.length - 1].startTime).slice(5)}` : '—'}</em></span>
      <span class="in"><small>累计进入内部池</small><b>${amount(inflow)}</b><em>改变内部存量</em></span>
      <span class="move"><small>内部池间累计移动</small><b>${amount(moved)}</b><em>只换位置，不增加存量</em></span>
      <span class="out"><small>累计离开内部池</small><b>${amount(outflow)}</b><em>减少内部存量</em></span>
      <span class="current"><small>当前内部池账面存量</small><b>${amount(balance)}</b><em>不是客户可用余额或银行余额</em></span>
    </div>
    <div class="money-map-legend"><span><i class="in"></i>进入内部池</span><span><i class="move"></i>内部池间移动</span><span><i class="out"></i>离开内部池</span><em>${lanes.length} 类资金池 · 点击任意操作查看具体池号、完整业务动作、原因和证据链</em></div>
    <div class="card coordinate-map-card"><div class="coordinate-map-scroll"><svg width="${width}" height="${height}" class="coordinate-map-svg" role="img" aria-label="资金池类型时间坐标地图"><rect x="0" y="0" width="${AXIS_LEFT}" height="${HEADER_H}" class="map-axis-corner"/><text x="14" y="31" class="map-axis-corner-title">操作时间 ↓</text><text x="14" y="51" class="map-axis-corner-sub">资金池类型 →</text>${headers}${rows}</svg></div><div class="coordinate-map-foot"><span class="hint-pulse"></span>每笔操作只占一行：来源卡说明出金动作，目标卡说明入金动作；箭头表示真实资金方向</div></div>`;

  target.querySelectorAll<HTMLElement>('[data-group]').forEach((node) => node.addEventListener('click', (event) => {
    event.stopPropagation();
    ctx.openGroup(node.dataset.group as string);
  }));
}
