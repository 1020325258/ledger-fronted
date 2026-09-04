/**
 * 客户资金全景：每笔客户实付单独作为起点，沿后端已经配对好的
 * transferGroupId 逐级展开。节点不按 accountType 合并，无法唯一确定的
 * 多对多关系也不会在前端猜测。
 */
import { amount, escapeHtml, number, type LedgerEntry } from '../api';
import { type PoolFlowSelection, type ViewContext } from '../context';
import { groupEdges, legDisplay, type TxnGroup } from '../groups';

type NodeKind = 'payment' | 'prepay' | 'order' | 'account' | 'operation' | 'other';
interface FlowNode { id:string; column:number; kind:NodeKind; eyebrow:string; title:string; amountText:string; meta:string; poolType?:string; groupId?:string; x:number; y:number }
interface FlowEdge { from:string; to:string; kind:'payment'|'allocate'|'refund'|'exit'; amount:number; groupIds:Set<string> }
const COLUMN_X = [16,268,520,772,1024];
const NODE_WIDTH = 204;
const NODE_HEIGHT = 126;
const keyboardCleanups = new WeakMap<HTMLElement,()=>void>();

function poolKind(type:string):NodeKind {
  if (type === 'ADVANCE') return 'prepay';
  if (type === 'SUB_ORDER') return 'order';
  if (type === 'CUSTOMER' || type === 'WALLET') return 'account';
  return 'other';
}
function timeText(value:string):string { return value ? value.replace('T',' ').slice(0,19) : '时间待后端补充'; }
function entryTime(entry:LedgerEntry):string { return String(entry.finishTime??''); }
function entryEffect(entry:LedgerEntry):number { return (entry.direction==='OUTFLOW'?-1:1)*number(entry.amount); }
function addPoolNode(nodes:Map<string,FlowNode>, entry:LedgerEntry, ctx:ViewContext, asOf:string):string {
  const pool = ctx.index.get(entry.accountId ?? '');
  // 模板的订单承接层按 CT 展示，S 单仍保留在点击后的池明细中。
  const isSubOrder = (entry.accountType ?? pool?.poolType) === 'SUB_ORDER';
  const compositeNo = pool?.compositOrderNo;
  const id = isSubOrder && compositeNo ? `combo:${compositeNo}` : `pool:${entry.accountId ?? entry.accountType ?? 'unknown'}`;
  if (nodes.has(id)) return id;
  const display = legDisplay(entry,ctx.index);
  const type = entry.accountType ?? pool?.poolType ?? 'OTHER';
  const children = isSubOrder && compositeNo ? ctx.pools.filter(item=>item.poolType==='SUB_ORDER'&&item.compositOrderNo===compositeNo) : [pool].filter(Boolean);
  const childIds=new Set(children.map(item=>item?.poolId).filter(Boolean));
  const visibleEntries=ctx.entries.filter(item=>childIds.has(item.accountId)&&entryTime(item)<=asOf);
  const balance = visibleEntries.reduce((sum,item)=>sum+entryEffect(item),0);
  const entries = visibleEntries.length;
  const amountText=type==='WALLET'
    ?`${balance<=0?'本单累计使用':'本单净回流'} ¥${amount(Math.abs(balance))}`
    :`当前余额 ¥${amount(Math.abs(balance))}`;
  nodes.set(id,{ id,column:1,kind:poolKind(type),eyebrow:isSubOrder?'商品订单':display.name,
    title:isSubOrder&&compositeNo?compositeNo:(display.fullId||display.name),amountText,
    meta:isSubOrder?`${children.length} 个销售子单 · ${entries} 条账本明细`:[display.note,`${entries} 条账本明细`].filter(Boolean).join(' · '),poolType:type,x:0,y:0 });
  return id;
}

function addSingleSidedOperationNode(nodes:Map<string,FlowNode>, group:TxnGroup, ctx:ViewContext):void {
  const entry = group.legs[0];
  if (!entry) return;
  const display = legDisplay(entry,ctx.index);
  const direction = entry.direction === 'INFLOW' ? '转入' : '转出';
  const id = `operation:${group.groupId}`;
  nodes.set(id,{id,column:2,kind:'operation',eyebrow:'资金池内操作',title:group.info.label,
    amountText:`${direction} ¥${amount(group.amount)}`,
    meta:[display.name,display.fullId,`${group.legs.length} 条账本明细`].filter(Boolean).join(' · '),
    poolType:entry.accountType ?? ctx.index.get(entry.accountId ?? '')?.poolType,
    groupId:group.groupId,x:0,y:0});
}

function buildNetwork(ctx:ViewContext, groups:TxnGroup[], asOf:string, visibleGroupIds:Set<string>):{nodes:FlowNode[];edges:FlowEdge[];omitted:number;standalone:number} {
  const nodes = new Map<string,FlowNode>(); const edgeMap=new Map<string,FlowEdge>(); let omitted=0; let standalone=0;
  groups.slice().reverse().forEach(group=>{
    const resolved=groupEdges(group);
    if (resolved==null){ if(visibleGroupIds.has(group.groupId))omitted+=1; return; }
    if (!resolved.length){
      // 后端明确标记 singleSided 的单边操作没有跨池对端，但仍是客户链路中的真实步骤。
      // 展示为独立的“资金池内操作”节点，不虚构一条自环或跨池连线。
      if(group.info.singleSided){ addSingleSidedOperationNode(nodes,group,ctx); if(visibleGroupIds.has(group.groupId))standalone+=1; }
      else if(visibleGroupIds.has(group.groupId))omitted+=1;
      return;
    }
    resolved.forEach(edge=>{
      const fromEntry=group.outLegs.find(entry=>entry.accountId===edge.from);
      const toEntry=group.inLegs.find(entry=>entry.accountId===edge.to);
      if(!fromEntry||!toEntry)return;
      const fromCustomer=fromEntry.accountType==='CUSTOMER'; const toCustomer=toEntry.accountType==='CUSTOMER';
      let fromId:string; let toId:string;
      if(fromCustomer){
        fromId=`pay:${group.groupId}`;
        if(!nodes.has(fromId))nodes.set(fromId,{id:fromId,column:0,kind:'payment',eyebrow:'实际支付流水',
          title:fromEntry.fundActionDesc||group.info.label,amountText:`¥${amount(group.amount)}`,
          meta:timeText(group.startTime),groupId:group.groupId,x:0,y:0});
      }else fromId=addPoolNode(nodes,fromEntry,ctx,asOf);
      if(toCustomer){
        toId=`refund:${group.groupId}`;
        if(!nodes.has(toId))nodes.set(toId,{id:toId,column:4,kind:'account',eyebrow:'资金退出',title:'退回客户钱包',
          amountText:`已退 ¥${amount(group.amount)}`,meta:`${timeText(group.endTime)} · ${group.info.label}`,groupId:group.groupId,x:0,y:0});
      }else toId=addPoolNode(nodes,toEntry,ctx,asOf);
      const kind=fromCustomer?'payment':toCustomer?'exit':group.info.kind==='REFUND'?'refund':'allocate';
      const key=`${fromId}\u0000${toId}\u0000${kind}`;
      const aggregate=edgeMap.get(key)??{from:fromId,to:toId,kind,amount:0,groupIds:new Set<string>()};
      aggregate.amount+=edge.amount; aggregate.groupIds.add(group.groupId); edgeMap.set(key,aggregate);
    });
  });
  const edges=[...edgeMap.values()];
  // 横向表达业务阶段，而不是假装存在固定的“第 N 次承接”。
  // 首次承接来自客户支付的直接去向；有后续出金的是内部流转；终点是当前归属。
  const rootIds=new Set([...nodes.values()].filter(node=>node.column===0).map(node=>node.id));
  const firstIds=new Set(edges.filter(edge=>rootIds.has(edge.from)).map(edge=>edge.to));
  nodes.forEach(node=>{
    if(node.column===0)return;
    if(node.kind==='operation'){node.column=2;return;}
    if(node.kind==='account'&&node.id.startsWith('refund:')){node.column=4;return;}
    const hasLater=edges.some(edge=>edge.from===node.id&&!edge.to.startsWith('refund:'));
    node.column=firstIds.has(node.id)?1:2;
    if(!hasLater)node.column=3;
  });
  const columns=[0,1,2,3,4].map(column=>[...nodes.values()].filter(node=>node.column===column)
    .sort((a,b)=>a.kind.localeCompare(b.kind)||a.meta.localeCompare(b.meta)||a.title.localeCompare(b.title)));
  // 独立的资金池内操作没有跨池连线，单独排在主链路下方，避免卡片压住或穿过真实连线。
  const flowRowCount=Math.max(1,...columns.map(column=>column.filter(node=>node.kind!=='operation').length));
  columns.forEach((column,col)=>column.filter(node=>node.kind!=='operation').forEach((node,row)=>{node.x=COLUMN_X[col];node.y=28+row*160;}));
  columns[2].filter(node=>node.kind==='operation').forEach((node,row)=>{node.x=COLUMN_X[2];node.y=28+(flowRowCount+row)*160;});
  // 支付根按其首个承接节点的纵向位置排列，减少扇出线交叉。
  columns[0].sort((a,b)=>{
    const targetY=(node:FlowNode)=>edges.filter(edge=>edge.from===node.id).map(edge=>nodes.get(edge.to)?.y??0).reduce((s,v)=>s+v,0)/Math.max(1,edges.filter(edge=>edge.from===node.id).length);
    return targetY(a)-targetY(b)||a.meta.localeCompare(b.meta);
  }).forEach((node,row)=>{node.y=28+row*160;});
  return {nodes:[...nodes.values()],edges,omitted,standalone};
}

function selection(edge:FlowEdge,nodes:Map<string,FlowNode>):PoolFlowSelection {
  const from=nodes.get(edge.from)!; const to=nodes.get(edge.to)!;
  return {fromType:from.poolType??'CUSTOMER',fromLabel:from.title,toType:to.poolType??'CUSTOMER',toLabel:to.title,amount:edge.amount,groupIds:[...edge.groupIds]};
}
function renderNetwork(ctx:ViewContext, visibleGroups:TxnGroup[], asOf:string, currentGroupId:string, isFinal:boolean):string {
  const visibleGroupIds=new Set(visibleGroups.map(group=>group.groupId));
  // 始终用完整链路计算节点位置；回放仅改变状态和余额，避免节点在步骤间左右跳动。
  const network=buildNetwork(ctx,ctx.groups,asOf,visibleGroupIds); const nodeMap=new Map(network.nodes.map(node=>[node.id,node]));
  const height=Math.max(360,...network.nodes.map(node=>node.y+NODE_HEIGHT+18));
  const visibleEdges=network.edges.filter(edge=>[...edge.groupIds].some(id=>visibleGroupIds.has(id)));
  const currentEdges=network.edges.filter(edge=>edge.groupIds.has(currentGroupId));
  const currentEdge=currentEdges[0];
  const currentFrom=currentEdge?nodeMap.get(currentEdge.from):undefined; const currentTo=currentEdge?nodeMap.get(currentEdge.to):undefined;
  const currentGroup=ctx.groups.find(group=>group.groupId===currentGroupId);
  const currentLeg=currentGroup?.legs[0];
  const currentPool=currentLeg?legDisplay(currentLeg,ctx.index):undefined;
  const edgeState=(edge:FlowEdge)=>{
    const visible=[...edge.groupIds].some(id=>visibleGroupIds.has(id));
    if(isFinal&&visible)return 'complete';
    return edge.groupIds.has(currentGroupId)?'current':visible?'history':'future';
  };
  const stateOrder={future:0,history:1,complete:2,current:3};
  // 同一路径可能承载多次操作，当前线必须最后绘制，避免被浅色历史/未来线覆盖。
  const paths=network.edges.slice().sort((a,b)=>stateOrder[edgeState(a)]-stateOrder[edgeState(b)]).map(edge=>{
    const from=nodeMap.get(edge.from)!; const to=nodeMap.get(edge.to)!; const forward=to.x>=from.x;
    const sx=forward?from.x+NODE_WIDTH:from.x; const ex=forward?to.x:to.x+NODE_WIDTH;
    const outgoing=network.edges.filter(item=>item.from===edge.from);
    const incoming=network.edges.filter(item=>item.to===edge.to);
    const port=(index:number,count:number)=>count===1?NODE_HEIGHT/2:24+index*(NODE_HEIGHT-48)/(count-1);
    const sy=from.y+port(outgoing.indexOf(edge),outgoing.length);
    const ey=to.y+port(incoming.indexOf(edge),incoming.length);
    const bend=Math.max(34,Math.abs(ex-sx)*.42);
    const d=forward?`M ${sx} ${sy} C ${sx+bend} ${sy}, ${ex-bend} ${ey}, ${ex} ${ey}`:`M ${sx} ${sy} C ${sx-bend} ${sy}, ${ex+bend} ${ey}, ${ex} ${ey}`;
    const state=edgeState(edge);
    return `<g class="customer-template-edge ${edge.kind} ${state}" data-customer-flow='${escapeHtml(JSON.stringify(selection(edge,nodeMap)))}' role="button" tabindex="0"><path d="${d}" marker-end="url(#template-arrow-${edge.kind})"/><g class="customer-template-edge-label" transform="translate(${(sx+ex)/2} ${(sy+ey)/2-16})"><rect x="-46" y="-10" width="92" height="20" rx="3"/><text y="4" text-anchor="middle">¥${amount(edge.amount)}${edge.groupIds.size>1?` · ${edge.groupIds.size}次`:''}</text></g></g>`;
  }).join('');
  const activeNodeIds=new Set(visibleEdges.flatMap(edge=>[edge.from,edge.to]));
  network.nodes.filter(node=>node.groupId&&visibleGroupIds.has(node.groupId)).forEach(node=>activeNodeIds.add(node.id));
  const currentNodeIds=new Set(currentEdges.flatMap(edge=>[edge.from,edge.to]));
  network.nodes.filter(node=>node.groupId===currentGroupId).forEach(node=>currentNodeIds.add(node.id));
  const cards=network.nodes.map(node=>{
    const visible=activeNodeIds.has(node.id); const nodeState=!visible?'future':isFinal?'complete':currentNodeIds.has(node.id)?'current-focus':'history';
    const role=node.column===0?'起点':node.column===4?'退出':node.kind==='operation'?'内部操作':'承接';
    return `<foreignObject x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}"><article xmlns="http://www.w3.org/1999/xhtml" class="customer-template-node ${node.kind} ${nodeState}" ${currentNodeIds.has(node.id)?'data-current-node="true"':''} ${currentEdges.some(edge=>edge.from===node.id)?'data-current-source="true"':''} ${node.poolType?`data-customer-pool-type="${escapeHtml(node.poolType)}"`:''} ${node.groupId?`data-customer-group="${escapeHtml(node.groupId)}"`:''} role="button" tabindex="0"><div><span>${escapeHtml(node.eyebrow)}</span><small>${role}</small></div><strong title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</strong><b>${visible?escapeHtml(node.amountText):'尚未发生'}</b><small title="${escapeHtml(node.meta)}">${escapeHtml(node.meta)}</small></article></foreignObject>`;
  }).join('');
  const defs=[['payment','#009261'],['allocate','#0052d9'],['refund','#ed7b2f'],['exit','#e81f52']].map(([kind,color])=>`<marker id="template-arrow-${kind}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="${color}"/></marker>`).join('');
  const standaloneVisible=network.standalone;
  const answer=currentEdge
    ? `<span><b>${escapeHtml(currentFrom?.eyebrow??'来源待补充')}</b></span><i>→</i><span><b>${escapeHtml(currentTo?.eyebrow??'去向待补充')}</b></span>`
    : currentGroup?.info.singleSided
      ? `<span><b>${escapeHtml(currentPool?.name??'资金池')}</b></span><i>·</i><span><b>资金池内调整</b></span>`
      : `<span><b>来源待补充</b></span><i>→</i><span><b>去向待补充</b></span>`;
  return `<div class="customer-template-toolbar"><div><span class="customer-template-status">${visibleGroups.filter(group=>group.outLegs.some(entry=>entry.accountType==='CUSTOMER')).length} 笔实际支付流水</span><span>${visibleEdges.length} / ${network.edges.length} 条资金流转关系${standaloneVisible?` · ${standaloneVisible} 条资金池内操作`:''}</span></div><div class="customer-template-legend"><span><i class="current-line"></i>本次操作</span><span><i class="history-line"></i>已发生</span><span><i class="future-line"></i>尚未发生</span></div></div><div class="customer-template-answer current"><strong>本次资金变化</strong><div>${answer}<span class="amount">¥${amount(visibleGroups.at(-1)?.amount??0)}</span></div></div><div class="customer-template-network"><div class="customer-template-columns">${['资金进入','首次承接','内部流转','当前归属','退回客户'].map(name=>`<span>${name}</span>`).join('')}</div><svg viewBox="0 0 1244 ${height}" style="min-height:${height}px"><defs>${defs}</defs>${paths}${cards}</svg></div>${network.omitted?`<div class="customer-template-note">${network.omitted} 次操作缺少可确定的跨池配对，前端未猜测连线，可到资金地图查看原始明细。</div>`:''}`;
}

export function renderCustomerJourney(target:HTMLElement,ctx:ViewContext):void {
  const internal=ctx.pools.filter(pool=>pool.poolScope!=='EXTERNAL');
  const ctCount=new Set(internal.map(pool=>pool.compositOrderNo).filter(Boolean)).size;
  const subCount=internal.filter(pool=>pool.poolType==='SUB_ORDER').length;
  const moments=ctx.groups.slice().sort((a,b)=>a.endTime.localeCompare(b.endTime));
  let cursor=Math.max(0,moments.length-1); let timer:number|undefined; let shouldFocus=false;
  const paint=()=>{
    const visible=moments.slice(0,cursor+1); const current=moments[cursor]; const asOf=current?.endTime??'';
    const visibleEntries=ctx.entries.filter(entry=>entryTime(entry)<=asOf);
    const paid=visibleEntries.filter(entry=>entry.accountType==='CUSTOMER'&&entry.direction==='OUTFLOW').reduce((sum,entry)=>sum+number(entry.amount),0);
    const refunded=visibleEntries.filter(entry=>entry.accountType==='CUSTOMER'&&entry.direction==='INFLOW').reduce((sum,entry)=>sum+number(entry.amount),0);
    const balances=new Map<string,number>(); visibleEntries.filter(entry=>entry.accountType!=='CUSTOMER').forEach(entry=>balances.set(entry.accountId??'',(balances.get(entry.accountId??'')??0)+entryEffect(entry)));
    const active=[...balances.values()].filter(value=>Math.abs(value)>.005).length;
    target.innerHTML=`<section class="customer-template-summary"><div class="customer-template-identity"><div><strong>当前客户</strong><span>${visible.length} / ${moments.length} 笔资金变动</span></div><b>UCID ${escapeHtml(String(ctx.data.ucid??'接口未提供'))}</b><small>${asOf?`回放至 ${escapeHtml(timeText(asOf))}`:'当前查询主单'}</small></div><div><span>累计实付</span><strong class="in">¥${amount(paid)}</strong><small>截至当前时间</small></div><div><span>累计退回</span><strong class="out">¥${amount(refunded)}</strong><small>退款及凭证冲销回流</small></div><div><span>当前有效资金</span><strong class="balance">¥${amount(paid-refunded)}</strong><small>${active} 个有余额资金池</small></div><div><span>订单规模</span><strong>${ctCount} CT / ${subCount} S</strong><small>${internal.length} 个内部资金池</small></div></section><section class="customer-template-panel"><header><h2>实际支付流水全链路</h2><span>拖动时间轴，回看每次资金操作发生后的资金位置</span></header><div class="customer-replay"><button type="button" data-replay-prev aria-label="上一步">‹</button><button type="button" data-replay-play>${timer?'暂停':'播放'}</button><input data-replay-range type="range" min="0" max="${Math.max(0,moments.length-1)}" value="${cursor}" step="1" ${moments.length<2?'disabled':''}/><button type="button" data-replay-next aria-label="下一步">›</button><div><strong>${escapeHtml(current?.info.label??'暂无资金操作')}</strong><span>${escapeHtml(timeText(asOf))}${current?` · ¥${amount(current.amount)}`:''}</span></div></div>${renderNetwork(ctx,visible,asOf,current?.groupId??'',cursor===moments.length-1)}<div class="customer-template-reconcile"><div><span>累计实付</span><strong>¥${amount(paid)}</strong></div><b>−</b><div><span>累计退回</span><strong>¥${amount(refunded)}</strong></div><b>=</b><div><span>当前有效资金</span><strong>¥${amount(paid-refunded)}</strong></div></div></section>`;
    if(shouldFocus){window.requestAnimationFrame(()=>target.querySelector<HTMLElement>('[data-current-source="true"]')?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'}));shouldFocus=false;}
    const move=(next:number)=>{cursor=Math.max(0,Math.min(moments.length-1,next));shouldFocus=true;paint();};
    target.querySelector<HTMLElement>('[data-replay-prev]')?.addEventListener('click',()=>move(cursor-1));
    target.querySelector<HTMLElement>('[data-replay-next]')?.addEventListener('click',()=>move(cursor+1));
    target.querySelector<HTMLInputElement>('[data-replay-range]')?.addEventListener('input',event=>move(Number((event.target as HTMLInputElement).value)));
    target.querySelector<HTMLElement>('[data-replay-play]')?.addEventListener('click',()=>{if(timer){window.clearInterval(timer);timer=undefined;paint();return;}if(cursor>=moments.length-1)cursor=0;shouldFocus=true;timer=window.setInterval(()=>{if(cursor>=moments.length-1){window.clearInterval(timer);timer=undefined;paint();return;}cursor+=1;shouldFocus=true;paint();},1100);paint();});
    target.querySelectorAll<HTMLElement>('[data-customer-pool-type]').forEach(node=>{const open=()=>ctx.openPoolType(node.dataset.customerPoolType??'OTHER');node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open();});});
    target.querySelectorAll<HTMLElement>('[data-customer-group]').forEach(node=>{const open=()=>ctx.openGroup(node.dataset.customerGroup??'');node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open();});});
    target.querySelectorAll<HTMLElement>('[data-customer-flow]').forEach(node=>{const open=()=>ctx.openPoolFlow(JSON.parse(node.dataset.customerFlow??'{}') as PoolFlowSelection);node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open();});});
    keyboardCleanups.get(target)?.();
    const onKey=(event:KeyboardEvent)=>{
      if(!target.isConnected||!target.querySelector('[data-replay-range]'))return;
      const tag=(event.target as HTMLElement|null)?.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||tag==='BUTTON')return;
      if(event.code==='Space'){event.preventDefault();target.querySelector<HTMLElement>('[data-replay-play]')?.click();}
      else if(event.key==='ArrowLeft'){event.preventDefault();move(cursor-1);}
      else if(event.key==='ArrowRight'){event.preventDefault();move(cursor+1);}
    };
    window.addEventListener('keydown',onKey);
    keyboardCleanups.set(target,()=>window.removeEventListener('keydown',onKey));
  };
  paint();
}
