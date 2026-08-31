/**
 * 泳道时序流向图 —— 自绘 SVG。
 *
 * Y 轴是资金池泳道，X 轴是时间（按交易组顺序等距排列，不按真实时间间隔，
 * 否则 6/16 到 8/07 的空白会把图撑散）。**一列就是一个交易组**，
 * 所以列上任何位置都可以点开该次操作的溯源抽屉。
 *
 * 为什么不用桑基：预收款和商品子单之间存在互为反向的边（减项退回 8,400、
 * 抵扣回去 10,200），这是家装资金的典型形态。桑基和一切 DAG 布局不支持环，
 * 净流向画法会把「退回来又用掉」这段抹掉。泳道上环在时间轴方向自然展开。
 *
 * 连边一律来自 groupEdges()，账本确定不了的组不画、如实列出来。
 */

import { amount, escapeHtml, fmtClock, fmtDay, number, type FundPool } from '../api';
import { poolInk, type ViewContext } from '../context';
import { groupEdges, poolDisplay, type PoolEdge, type TxnGroup } from '../groups';
import { poolIcon } from './icons';
import { shortAmount } from './layout';

/** 泳道顺序：钱从上往下流 —— 站外 → 归集池 → 承接池。 */
const LANE_ORDER = ['CUSTOMER', 'WALLET', 'ADVANCE', 'FUND', 'SUB_ORDER', 'DEVELOPER'];

const GUTTER = 158;
const COL_W = 74;
const LANE_H = 52;
const PAD_TOP = 38;
const PAD_BOTTOM = 26;
/**
 * 操作配色。语义方向不变（支付红 / 抵扣蓝 / 退款绿），只是从满饱和度往下压了一档：
 * 一屏上十几条满饱和红线会互相抢，压过一档后仍然一眼分得清红蓝绿。
 */
const KIND_COLOR: Record<string, string> = {
  PAY: '#c2414a', DEDUCT: '#2f63d8', REFUND: '#07815f', EXTERNAL: '#6d4cd3', FALLBACK: '#b45309',
};

export type LaneMode = 'type' | 'pool';

interface Lane {
  key: string;
  /** 池类型键，画图标用 */
  iconType: string;
  name: string;
  /** 余额那一行的完整文案 */
  metric: string;
  color: string;
  /** 该泳道对应的池 id，点击时展开下方池卡片 */
  poolIds: string[];
}

interface Column {
  group: TxnGroup;
  edges: PoolEdge[] | null;
  x: number;
}

function laneKeyOf(poolId: string, ctx: ViewContext, mode: LaneMode): string {
  if (mode === 'pool') return poolId;
  return ctx.index.get(poolId)?.poolType ?? 'OTHER';
}

/**
 * 余额文案。CUSTOMER / DEVELOPER 是系统外实体虚拟池，余额天生是负数（客户付出去的钱），
 * 直接写「余额 −130,539.80」会被读成欠款，按方向改成「已投入 / 已收到」。
 */
function metricOf(pool: FundPool | undefined, balance: number): string {
  if (pool?.poolScope === 'EXTERNAL') {
    return balance < 0 ? `已投入 ${amount(-balance)}` : `已收到 ${amount(balance)}`;
  }
  return `余额 ${amount(balance)}`;
}

/** 泳道集合：只保留图上真正出现的池/类型，避免 0 流水的空泳道占位。 */
function buildLanes(ctx: ViewContext, mode: LaneMode, used: Set<string>): Lane[] {
  const lanes = new Map<string, { lane: Lane; type: string; ct: string; sort: number }>();
  used.forEach((poolId) => {
    const pool = ctx.index.get(poolId);
    const key = laneKeyOf(poolId, ctx, mode);
    const type = pool?.poolType ?? 'OTHER';
    const existing = lanes.get(key);
    if (existing) {
      existing.lane.poolIds.push(poolId);
      return;
    }
    const disp = poolDisplay(poolId, type, pool);
    // 类型泳道的余额取该类型全部池之和，与下方分区标题的口径一致
    const samePools = mode === 'type' ? ctx.pools.filter((p) => (p.poolType ?? 'OTHER') === type) : [pool];
    const balance = samePools.reduce((sum, p) => sum + number(p?.balance), 0);
    lanes.set(key, {
      type,
      ct: pool?.compositOrderNo ?? '',
      sort: balance,
      lane: {
        key,
        iconType: disp.iconType,
        name: mode === 'type' ? poolDisplay('', type).name : disp.name,
        metric: mode === 'type'
          ? metricOf(pool, balance)
          : `${disp.shortId ? `${disp.shortId} · ` : ''}${metricOf(pool, balance)}`,
        color: poolInk(type),
        poolIds: [poolId],
      },
    });
  });

  return [...lanes.values()]
    .sort((a, b) => {
      const byType = LANE_ORDER.indexOf(a.type) - LANE_ORDER.indexOf(b.type);
      if (byType !== 0) return byType;
      const byCt = a.ct.localeCompare(b.ct);
      return byCt !== 0 ? byCt : b.sort - a.sort;
    })
    .map((x) => x.lane);
}

export function renderFlowMap(ctx: ViewContext, mode: LaneMode): string {
  // 时间正序：图从左到右读
  const groups = ctx.groups.slice().reverse();
  const withEdges = groups.map((group) => ({ group, edges: groupEdges(group) }));

  const drawable = withEdges.filter((c) => c.edges && c.edges.length);
  const ambiguous = withEdges.filter((c) => c.edges === null);
  const single = withEdges.filter((c) => c.edges && !c.edges.length);

  if (!drawable.length) {
    const why = [
      single.length ? `${single.length} 次操作在账本里只有一侧记录（对端资金池归属断链或本就是单边操作）` : '',
      ambiguous.length ? `${ambiguous.length} 次操作出入金各涉及多个资金池，账本没有记一对一的对应关系` : '',
    ].filter(Boolean);
    return `
      <div class="card">
        <div class="card-head"><h3>资金流向图</h3></div>
        <div class="card-body"><div class="empty">
          画不出流向图。<br>${escapeHtml(why.join('；') || '账本里没有跨池流转记录')}
        </div></div>
      </div>`;
  }

  const used = new Set<string>();
  drawable.forEach(({ edges }) => edges?.forEach((e) => { used.add(e.from); used.add(e.to); }));
  const lanes = buildLanes(ctx, mode, used);
  const laneY = new Map(lanes.map((lane, i) => [lane.key, PAD_TOP + i * LANE_H + LANE_H / 2]));

  const cols: Column[] = drawable.map((c, i) => ({ ...c, x: GUTTER + COL_W * i + COL_W / 2 }));
  const width = GUTTER + COL_W * cols.length + 24;
  const height = PAD_TOP + lanes.length * LANE_H + PAD_BOTTOM;

  // 泳道：交替底纹分行 + 左侧标签。竖线是列，横向底纹让"这条箭头落在哪条泳道"一眼可读
  const laneSvg = lanes.map((lane, i) => {
    const y = laneY.get(lane.key) as number;
    return `
      <g class="fm-lane" data-lane="${escapeHtml(lane.poolIds.join(','))}">
        <rect x="0" y="${y - LANE_H / 2}" width="${width}" height="${LANE_H}"
              class="fm-lane-bg ${i % 2 ? 'alt' : ''}"/>
        <line x1="${GUTTER - 8}" y1="${y}" x2="${width - 12}" y2="${y}" class="fm-lane-line"/>
        ${poolIcon(lane.iconType, { x: 14, y: y - 17, size: 15, color: lane.color })}
        <text x="36" y="${y - 4}" class="fm-lane-name">${escapeHtml(lane.name)}</text>
        <text x="36" y="${y + 12}" class="fm-lane-sub">${escapeHtml(lane.metric)}</text>
      </g>`;
  }).join('');

  // 泳道名与绘图区之间的分隔线，两边各是一套阅读单位
  const gutterLine = `<line x1="${GUTTER - 14}" y1="${PAD_TOP - 26}" x2="${GUTTER - 14}"
        y2="${height - PAD_BOTTOM + 6}" class="fm-gutter"/>`;

  // 日期分隔线：只在换天的列前画
  let lastDay = '';
  const daySvg = cols.map((col) => {
    const day = fmtDay(col.group.startTime);
    if (day === lastDay) return '';
    lastDay = day;
    const x = col.x - COL_W / 2;
    return `
      <line x1="${x}" y1="${PAD_TOP - 20}" x2="${x}" y2="${height - PAD_BOTTOM + 6}" class="fm-day-line"/>
      <text x="${x + 4}" y="${PAD_TOP - 24}" class="fm-day-label">${escapeHtml(day.slice(5))}</text>`;
  }).join('');

  // 每列 = 一个交易组
  const colSvg = cols.map((col) => {
    const { group, edges } = col;
    const color = KIND_COLOR[group.info.kind] ?? '#6b7280';
    const from = laneKeyOf((edges as PoolEdge[])[0].from, ctx, mode);
    const fromY = laneY.get(from) as number;

    // 类型聚合时，同一列可能有多条边落在同一泳道（如一次支付分摊给两个 S 单），
    // 合并成一个箭头并把金额相加，避免标签互相遮挡；明细在 title 与溯源抽屉里
    const merged = new Map<string, { key: string; y: number; total: number; legs: PoolEdge[] }>();
    (edges as PoolEdge[]).forEach((edge) => {
      const key = laneKeyOf(edge.to, ctx, mode);
      const hit = merged.get(key);
      if (hit) {
        hit.total = Math.round((hit.total + edge.amount) * 100) / 100;
        hit.legs.push(edge);
        return;
      }
      merged.set(key, { key, y: laneY.get(key) as number, total: edge.amount, legs: [edge] });
    });
    const targets = [...merged.values()];

    const ys = [fromY, ...targets.map((t) => t.y)];
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);

    const arrows = targets.map(({ key, y, total, legs }) => {
      const detail = legs.map((edge) => {
        const d = poolDisplay(edge.to, undefined, ctx.index.get(edge.to));
        return `  ${d.name}${d.shortId ? ` ${d.shortId}` : ''}  ${amount(edge.amount)}`;
      }).join('\n');
      const title = `${escapeHtml(group.info.label)} ${escapeHtml(fmtDay(group.startTime))} ${escapeHtml(fmtClock(group.startTime))}\n`
        + `${escapeHtml(poolDisplay(legs[0].from, undefined, ctx.index.get(legs[0].from)).name)} → ${amount(total)} 元`
        + `${legs.length > 1 ? `（${legs.length} 笔）` : ''}\n${escapeHtml(detail)}`;
      // 同一泳道内的流转（类型聚合下才可能出现）画成泳道上方的小弧
      if (key === from) {
        return `<path d="M ${col.x - 13} ${y} A 13 11 0 0 1 ${col.x + 13} ${y}" class="fm-self" stroke="${color}">
          <title>${title}</title></path>`;
      }
      const down = y > fromY;
      const tip = down ? y - 5 : y + 5;
      return `<g class="fm-arrow"><title>${title}</title>
        <polygon points="${col.x},${y} ${col.x - 5},${tip} ${col.x + 5},${tip}" fill="${color}"/>
        <text x="${col.x + 9}" y="${y + (down ? -7 : 14)}" class="fm-amt" fill="${color}">${escapeHtml(shortAmount(total))}${legs.length > 1 ? `<tspan class="fm-amt-n"> ×${legs.length}</tspan>` : ''}</text>
      </g>`;
    }).join('');

    const strokeWidth = Math.min(5, 1.2 + Math.log10(Math.max(10, group.amount)) * 0.55);
    return `
      <g class="fm-col" data-group="${escapeHtml(group.groupId)}">
        <rect x="${col.x - COL_W / 2}" y="${PAD_TOP - 12}" width="${COL_W}" height="${height - PAD_TOP - PAD_BOTTOM + 18}" class="fm-col-hit"/>
        ${bottom > top ? `<line x1="${col.x}" y1="${top}" x2="${col.x}" y2="${bottom}" stroke="${color}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity=".78"/>` : ''}
        <circle cx="${col.x}" cy="${fromY}" r="5" fill="#fff" stroke="${color}" stroke-width="2.2"/>
        <circle cx="${col.x}" cy="${fromY}" r="1.7" fill="${color}"/>
        ${arrows}
      </g>`;
  }).join('');

  const notDrawn = [
    single.length ? `${single.length} 次单边/断链操作没有对端腿，图上不画` : '',
    ambiguous.length ? `${ambiguous.length} 次操作出入金各涉及多个池，账本未记一对一对应，图上不画` : '',
  ].filter(Boolean).join('　·　');

  return `
    <div class="card chart-card flow-story-card">
      <div class="chart-titlebar flow-titlebar">
        <div>
          <span class="chart-kicker">MONEY MOVEMENT MAP</span>
          <h3>钱从哪里来，又流向哪里</h3>
          <p>横向是操作时间，纵向是资金所在位置；每一列代表一次跨池资金操作，线的方向就是钱的方向</p>
        </div>
        <div class="flow-title-actions">
          <strong>${cols.length}<small>次可还原流向</small></strong>
          <span class="fm-toggle">
            <button type="button" data-lane-mode="type"${mode === 'type' ? ' class="on"' : ''}>按类型</button>
            <button type="button" data-lane-mode="pool"${mode === 'pool' ? ' class="on"' : ''}>按资金池</button>
          </span>
        </div>
      </div>
      <div class="card-body tight">
        <div class="fm-legend">
          ${Object.entries({ PAY: '客户支付', DEDUCT: '抵扣', REFUND: '退款' })
            .map(([k, label]) => `<span><i style="background:${KIND_COLOR[k]}"></i>${label}</span>`).join('')}
          <span class="fm-shape"><svg width="13" height="13" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="4.4" fill="#fff" stroke="#667085" stroke-width="2"/><circle cx="6.5" cy="6.5" r="1.6" fill="#667085"/></svg>出金方</span>
          <span class="fm-shape"><svg width="13" height="13" viewBox="0 0 13 13"><polygon points="6.5,10.5 2.4,3.5 10.6,3.5" fill="#667085"/></svg>收钱方</span>
          <span class="fm-hint">线宽 ∝ 金额 · 点任意一列看这次操作的证据链 · 点泳道名展开下方该池账本</span>
        </div>
        <div class="fm-scroll">
          <svg width="${width}" height="${height}" class="fm-svg" role="img" aria-label="资金流向图">
            ${laneSvg}${gutterLine}${daySvg}${colSvg}
          </svg>
        </div>
        ${notDrawn ? `<div class="fm-note">${escapeHtml(notDrawn)}</div>` : ''}
      </div>
    </div>`;
}
