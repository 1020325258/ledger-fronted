/**
 * 泳道图之外的两个流向视角：
 * 1. 来源 × 去向矩阵：聚合回答主要路径、反向路径和循环。
 * 2. 业务动作路径谱：按 fundActionDesc 回答哪种业务动作让钱从哪流到哪。
 *
 * 两张图都只使用 groupEdges() 能唯一确定的边；多对多与单边组不猜测、不画边。
 */

import { amount, escapeHtml, number } from '../api';
import type { ViewContext } from '../context';
import { groupEdges, poolDisplay, type TxnGroup } from '../groups';

interface Route {
  from: string;
  to: string;
  cents: number;
  count: number;
  groupIds: string[];
}

function typeName(type: string): string { return poolDisplay('', type).name; }

function descriptions(group: TxnGroup): string[] {
  const values = group.legs.map((leg) => String(leg.fundActionDesc ?? '').trim())
    .filter((value) => value && value !== 'null' && value !== 'undefined');
  return [...new Set(values)];
}

function routeData(ctx: ViewContext): { routes: Route[]; skipped: number } {
  const routes = new Map<string, Route>();
  let skipped = 0;
  ctx.groups.forEach((group) => {
    const edges = groupEdges(group);
    if (!edges?.length) { skipped += 1; return; }
    edges.forEach((edge) => {
      const from = ctx.index.get(edge.from)?.poolType ?? group.outLegs.find((leg) => leg.accountId === edge.from)?.accountType ?? 'OTHER';
      const to = ctx.index.get(edge.to)?.poolType ?? group.inLegs.find((leg) => leg.accountId === edge.to)?.accountType ?? 'OTHER';
      const key = `${from}→${to}`;
      const hit = routes.get(key) ?? { from, to, cents: 0, count: 0, groupIds: [] };
      hit.cents += Math.round(number(edge.amount) * 100);
      if (!hit.groupIds.includes(group.groupId)) {
        hit.groupIds.push(group.groupId);
        hit.count += 1;
      }
      routes.set(key, hit);
    });
  });
  return { routes: [...routes.values()].sort((a, b) => b.cents - a.cents), skipped };
}

function flowMatrix(ctx: ViewContext, routes: Route[], skipped: number): string {
  const types = [...new Set(routes.flatMap((route) => [route.from, route.to]))];
  const totals = new Map(types.map((type) => [type, routes.filter((route) => route.from === type || route.to === type)
    .reduce((sum, route) => sum + route.cents, 0)]));
  types.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  const byKey = new Map(routes.map((route) => [`${route.from}→${route.to}`, route]));
  const max = Math.max(...routes.map((route) => route.cents), 1);
  const total = routes.reduce((sum, route) => sum + route.cents, 0);
  const externalTypes = new Set(ctx.pools.filter((pool) => pool.poolScope === 'EXTERNAL').map((pool) => pool.poolType ?? ''));
  externalTypes.add('CUSTOMER');
  externalTypes.add('DEVELOPER');
  const externalIn = routes.filter((route) => externalTypes.has(route.from) && !externalTypes.has(route.to))
    .reduce((sum, route) => sum + route.cents, 0);
  const externalOut = routes.filter((route) => !externalTypes.has(route.from) && externalTypes.has(route.to))
    .reduce((sum, route) => sum + route.cents, 0);
  const internalMove = routes.filter((route) => !externalTypes.has(route.from) && !externalTypes.has(route.to))
    .reduce((sum, route) => sum + route.cents, 0);
  const routeTone = (route: Route): string => route.from === 'CUSTOMER' ? 'in'
    : route.to === 'CUSTOMER' ? 'out' : 'move';
  const highlights = routes.slice(0, 3).map((route, index) => {
    const pct = total > 0 ? (route.cents / total) * 100 : 0;
    const inPct = externalIn > 0 && externalTypes.has(route.from) && !externalTypes.has(route.to)
      ? (route.cents / externalIn) * 100 : null;
    return `<button class="flow-highlight ${routeTone(route)}" type="button" data-group="${escapeHtml(route.groupIds[0])}">
      <span class="flow-highlight-rank">0${index + 1}</span>
      <span class="flow-highlight-route"><b>${escapeHtml(typeName(route.from))}</b><i>→</i><b>${escapeHtml(typeName(route.to))}</b></span>
      <strong>${amount(route.cents / 100)}<small>元</small></strong>
      <span class="flow-highlight-meta">占全部流量 ${pct.toFixed(1)}%${inPct == null ? '' : ` · 占外部进入 ${inPct.toFixed(1)}%`} · ${route.count} 次操作</span>
    </button>`;
  }).join('');
  const head = types.map((type) => `<span title="${escapeHtml(typeName(type))}">${escapeHtml(typeName(type))}</span>`).join('');
  const rows = types.map((from) => `<div class="flow-matrix-row" style="--flow-cols:${types.length}">
    <span class="flow-matrix-axis">${escapeHtml(typeName(from))}<small>资金来源</small></span>
    ${types.map((to) => {
      const route = byKey.get(`${from}→${to}`);
      if (!route) return '<span class="flow-matrix-empty">—</span>';
      const strength = route.cents / max;
      const pct = total > 0 ? (route.cents / total) * 100 : 0;
      return `<button class="flow-matrix-cell ${routeTone(route)}${from === to ? ' self' : ''}" type="button" data-group="${escapeHtml(route.groupIds[0])}"
        style="--cell-strength:${(.12 + strength * .68).toFixed(2)}"
        title="${escapeHtml(`${typeName(from)} → ${typeName(to)}：${amount(route.cents / 100)} 元，${route.count} 笔流向`)}">
        <i>↗</i><b>${amount(route.cents / 100)}</b><span>${pct.toFixed(1)}%</span><small>${route.count} 次操作</small>
      </button>`;
    }).join('')}
  </div>`).join('');
  return `<div class="card chart-card flow-matrix-card">
    <div class="chart-titlebar"><div><span class="chart-kicker">SOURCE × DESTINATION</span><h3>资金来源与去向矩阵</h3>
      <p>先看金额最大的主路径，再用方向热力矩阵查全部来源与去向；颜色越深，累计流量越大</p></div>
      <div class="flow-perspective-total"><strong>${routes.length}</strong><small>条聚合路径</small></div></div>
    <div class="flow-volume-summary">
      <span class="total"><small>累计可还原资金流量</small><b>${amount(total / 100)}</b><em>流量，不是余额</em></span>
      <span class="in"><small>外部进入内部池</small><b>${amount(externalIn / 100)}</b><em>新增内部池存量</em></span>
      <span class="move"><small>内部池间移动</small><b>${amount(internalMove / 100)}</b><em>重复流经，不增加存量</em></span>
      <span class="out"><small>内部池流向外部</small><b>${amount(externalOut / 100)}</b><em>减少内部池存量</em></span>
    </div>
    <div class="flow-highlights">${highlights}</div>
    <div class="flow-matrix-scroll"><div class="flow-matrix-head" style="--flow-cols:${types.length}"><span>来源 ↓ / 去向 →</span>${head}</div>${rows}</div>
    <div class="distribution-foot"><span class="hint-pulse"></span>点击主路径或热力格查看其中一笔代表性操作；A → B 与 B → A 分开统计${skipped ? `；${skipped} 次单边、断链或多对多操作未猜测路径` : ''}</div>
  </div>`;
}

function actionRoutes(ctx: ViewContext, routes: Route[]): string {
  const max = Math.max(...routes.map((route) => route.cents), 1);
  const actionMap = new Map<string, Map<string, Route>>();
  ctx.groups.forEach((group) => {
    const edges = groupEdges(group);
    if (!edges?.length) return;
    const descs = descriptions(group);
    // 同组多个描述无法从账本确定金额分别属于哪个动作，因此合并成一个“多动作操作”，
    // 不把整组金额复制计入多个动作，避免聚合总额被放大。
    const actions = [descs.length === 0 ? '业务动作待补充'
      : descs.length === 1 ? descs[0] : `多动作操作：${descs.join(' / ')}`];
    actions.forEach((desc) => {
      const map = actionMap.get(desc) ?? new Map<string, Route>();
      edges.forEach((edge) => {
        const from = ctx.index.get(edge.from)?.poolType ?? group.outLegs.find((leg) => leg.accountId === edge.from)?.accountType ?? 'OTHER';
        const to = ctx.index.get(edge.to)?.poolType ?? group.inLegs.find((leg) => leg.accountId === edge.to)?.accountType ?? 'OTHER';
        const key = `${from}→${to}`;
        const hit = map.get(key) ?? { from, to, cents: 0, count: 0, groupIds: [] };
        hit.cents += Math.round(number(edge.amount) * 100);
        if (!hit.groupIds.includes(group.groupId)) {
          hit.groupIds.push(group.groupId);
          hit.count += 1;
        }
        map.set(key, hit);
      });
      actionMap.set(desc, map);
    });
  });

  const actions = [...actionMap.entries()].map(([desc, map]) => ({
    desc, routes: [...map.values()].sort((a, b) => b.cents - a.cents),
    cents: [...map.values()].reduce((sum, route) => sum + route.cents, 0),
  })).sort((a, b) => b.cents - a.cents);
  const actionTotal = actions.reduce((sum, action) => sum + action.cents, 0);

  const cards = actions.map((action, index) => {
    const compound = action.desc.startsWith('多动作操作：');
    const descs = compound ? action.desc.slice('多动作操作：'.length).split(' / ') : [action.desc];
    const count = new Set(action.routes.flatMap((route) => route.groupIds)).size;
    const pct = actionTotal > 0 ? (action.cents / actionTotal) * 100 : 0;
    return `<section class="action-route-card${compound ? ' compound' : ''}">
    <span class="action-route-rank">${String(index + 1).padStart(2, '0')}</span>
    <header><span><em>${compound ? `复合动作 · ${descs.length} 个账务动作` : '单一业务动作'}</em><b>${escapeHtml(compound ? '一次操作包含多个业务动作' : action.desc)}</b><small>${count} 次可还原操作</small></span><strong>${amount(action.cents / 100)}<small>占动作流量 ${pct.toFixed(1)}%</small></strong></header>
    ${compound ? `<div class="action-desc-tags">${descs.map((desc) => `<span>${escapeHtml(desc)}</span>`).join('')}</div>` : ''}
    <div class="action-route-lines">${action.routes.map((route) => `<button type="button" data-group="${escapeHtml(route.groupIds[0])}" class="action-route-line">
      <span class="action-route-names"><b>${escapeHtml(typeName(route.from))}</b><i>→</i><b>${escapeHtml(typeName(route.to))}</b></span>
      <span class="action-route-track"><i style="width:${Math.max(2, (route.cents / max) * 100).toFixed(1)}%"></i></span>
      <span class="action-route-value"><b>${amount(route.cents / 100)}</b><small>${route.count} 次操作</small></span>
    </button>`).join('')}</div>
  </section>`;
  }).join('');
  return `<div class="card chart-card action-route-atlas">
    <div class="chart-titlebar"><div><span class="chart-kicker">BUSINESS ACTION ROUTES</span><h3>业务动作把钱带向了哪里</h3>
      <p>按同一次资金操作中的 fundActionDesc 组合聚合；先看动作排行，再看每组动作对应的真实来源 → 去向</p></div>
      <div class="flow-perspective-total"><strong>${actions.length}</strong><small>组动作组合</small></div></div>
    <div class="action-route-grid">${cards}</div>
    <div class="distribution-foot"><span class="hint-pulse"></span>同组出现多个 fundActionDesc 时合并为“多动作操作”，避免重复累计金额；点击路径查看对应操作与证据链</div>
  </div>`;
}

export function renderFlowPerspectives(ctx: ViewContext): string {
  const { routes, skipped } = routeData(ctx);
  if (!routes.length) return '';
  return `${flowMatrix(ctx, routes, skipped)}${actionRoutes(ctx, routes)}`;
}
