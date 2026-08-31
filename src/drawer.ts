/**
 * 溯源抽屉 —— 点任意一笔资金操作，滑出它的完整证据链。
 *
 * 展示的每一项都是接口原样返回的事实：
 *   业务动作键（售后单号/变更单号/交易号）来自 PoolEntry.metadata；
 *   出入金腿来自同一个 transferGroupId 的条目；
 *   源表与记录 ID 来自 sourceTable / sourceRecordId。
 * 「后续去向」是按池 + 时间的筛选，不是推导出来的资金追踪，文案上也如实这么写。
 */

import { amount, escapeHtml, fmtTime, type FundPool, type LedgerEntry } from './api';
import { codeLabel, ACTION_TYPES, ENTRY_STATUS, METADATA_FIELDS, PAIRING_REASONS, PAIRING_STATUS, SOURCE_TABLES } from './codes';
import { legDisplay, type TxnGroup } from './groups';

export interface DrawerContext {
  index: Map<string, FundPool>;
  /** 全部交易组，用于列出同一资金池的后续出金操作 */
  groups: TxnGroup[];
  /** 抽屉内跳转到另一笔操作 */
  onOpen: (groupId: string) => void;
}

let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
  }
  return host;
}

export function closeDrawer(): void {
  if (host) host.innerHTML = '';
}

function actionLabel(entry: LedgerEntry): string {
  return entry.fundActionDesc || ACTION_TYPES[entry.fundActionType ?? ''] || entry.fundActionType || '资金变动';
}

function legBlock(entry: LedgerEntry, ctx: DrawerContext): string {
  const pool = legDisplay(entry, ctx.index);
  const inflow = entry.direction === 'INFLOW';
  const status = entry.status && entry.status !== 'SUCCESS'
    ? `<span class="tag tag-hold">${escapeHtml(ENTRY_STATUS[entry.status] ?? entry.status)}</span>` : '';
  const src = entry.sourceTable
    ? `<div class="dleg-src">${escapeHtml(SOURCE_TABLES[entry.sourceTable] ?? entry.sourceTable)}`
      + ` · ${escapeHtml(entry.sourceTable)}#${escapeHtml(entry.sourceRecordId ?? '—')}</div>`
    : '';
  return `
    <div class="dleg">
      <div class="dleg-top">
        <span>${pool.icon}</span>
        <span class="dleg-name">${escapeHtml(pool.name)}</span>
        ${pool.shortId ? `<span class="leg-id" title="${escapeHtml(pool.fullId)}">${escapeHtml(pool.shortId)}</span>` : ''}
        ${status}
        <span class="dleg-amount ${inflow ? 'amount-in' : 'amount-out'}">${inflow ? '+' : '−'}${amount(entry.amount)}</span>
      </div>
      <div class="dleg-desc">${escapeHtml(actionLabel(entry))} · ${escapeHtml(fmtTime(entry.finishTime))}</div>
      ${pool.note ? `<div class="dleg-desc">${escapeHtml(pool.note)}</div>` : ''}
      ${src}
    </div>`;
}

/** 业务动作字段：metadata 里的业务键，按 METADATA_FIELDS 的顺序逐行列出。 */
function fieldsBlock(group: TxnGroup, ctx: DrawerContext): string {
  const merged = new Map<string, unknown>();
  group.legs.forEach((leg) => {
    Object.entries(leg.metadata ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== '' && !merged.has(key)) merged.set(key, value);
    });
  });

  const rows = METADATA_FIELDS
    .filter((f) => merged.has(f.key))
    .map((f) => {
      const raw = merged.get(f.key);
      let value = codeLabel(raw, f.codes);
      if (f.key === 'pairingStatus') value = `${raw} ${PAIRING_STATUS[String(raw)] ?? ''}`.trim();
      if (f.key === 'pairingReason') value = `${raw} ${PAIRING_REASONS[String(raw)] ?? ''}`.trim();
      return `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(value)}</dd>`;
    });

  if (!rows.length) return '';
  return `<div class="dsec"><h4>业务动作</h4><dl class="dfields">${rows.join('')}</dl></div>`;
}

/**
 * 这笔钱进入的资金池，之后又发生了哪些出金操作。
 * 纯筛选：出金腿属于本组的入金池，且操作时间晚于本组。不声称是资金追踪。
 */
function nextBlock(group: TxnGroup, ctx: DrawerContext): string {
  const landed = new Set(group.inLegs.map((leg) => leg.accountId ?? ''));
  if (!landed.size) return '';
  const followups = ctx.groups
    .filter((g) => g.groupId !== group.groupId && g.startTime > group.endTime)
    .filter((g) => g.outLegs.some((leg) => landed.has(leg.accountId ?? '')))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 6);
  if (!followups.length) return '';

  const poolNames = [...landed]
    .map((id) => legDisplay({ accountId: id, accountType: ctx.index.get(id)?.poolType }, ctx.index).name);
  const lines = followups.map((g) => {
    const out = g.outLegs.filter((leg) => landed.has(leg.accountId ?? ''));
    const sum = out.reduce((s, leg) => s + Math.round((leg.amount ?? 0) * 100), 0) / 100;
    const target = g.inLegs.length === 1
      ? legDisplay(g.inLegs[0], ctx.index).name
      : `${g.inLegs.length} 个去处`;
    return `<div class="dnext-line" data-goto="${escapeHtml(g.groupId)}">
      <span>${escapeHtml(fmtTime(g.startTime).slice(5, 16))}</span>
      <span>${g.info.label} → ${escapeHtml(target)}</span>
      <span class="a">${amount(sum)}</span>
    </div>`;
  }).join('');

  return `<div class="dsec">
    <h4>这笔钱进入的资金池，之后的出金操作</h4>
    <div class="dnext">
      <div class="dleg-desc" style="margin:0 0 6px">${escapeHtml(poolNames.join('、'))}</div>
      ${lines}
    </div>
  </div>`;
}

export function openGroupDrawer(group: TxnGroup, ctx: DrawerContext): void {
  const kind = group.info.kind;
  const balanceNote = group.info.singleSided
    ? '单边操作，无本地对端腿，组级守恒豁免'
    : Math.abs(group.diff) <= 0.01
      ? '组内入金 − 出金 = 0，两端配平'
      : `组内入金 − 出金 = ${amount(group.diff)}，存在缺腿或双计`;

  const serviceMeta = `
    <div class="dsec">
      <h4>配对与守恒</h4>
      <dl class="dfields">
        <dt>交易组号</dt><dd>${escapeHtml(group.groupId)}</dd>
        <dt>组类型</dt><dd>${escapeHtml(group.info.label)}</dd>
        <dt>守恒</dt><dd>${escapeHtml(balanceNote)}</dd>
      </dl>
    </div>`;

  const el = ensureHost();
  el.innerHTML = `
    <div class="scrim" data-close="1"></div>
    <aside class="drawer" role="dialog" aria-label="资金操作溯源">
      <div class="drawer-head">
        <div class="dh-top">
          <span class="txn-icon ${kind}">${group.info.icon}</span>
          <h3>${escapeHtml(group.info.label)}</h3>
          <button class="drawer-close" data-close="1" aria-label="关闭">×</button>
        </div>
        <div class="drawer-amount">${amount(group.amount)} <small style="font-size:13px;font-weight:400">元</small></div>
        <div class="drawer-time">${escapeHtml(fmtTime(group.startTime))}${
          group.endTime !== group.startTime ? ` → ${escapeHtml(fmtTime(group.endTime).slice(11))}` : ''
        }${group.hasExecuting ? ' · 含未到账明细' : ''}</div>
      </div>
      <div class="drawer-body">
        ${fieldsBlock(group, ctx)}
        ${group.outLegs.length ? `<div class="dsec"><h4>出金 ${group.outLegs.length} 笔</h4>${group.outLegs.map((l) => legBlock(l, ctx)).join('')}</div>` : ''}
        ${group.inLegs.length ? `<div class="dsec"><h4>入金 ${group.inLegs.length} 笔</h4>${group.inLegs.map((l) => legBlock(l, ctx)).join('')}</div>` : ''}
        ${nextBlock(group, ctx)}
        ${serviceMeta}
      </div>
    </aside>`;

  el.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', closeDrawer));
  el.querySelectorAll('[data-goto]').forEach((node) => node.addEventListener('click', () => {
    const id = (node as HTMLElement).dataset.goto;
    if (id) ctx.onOpen(id);
  }));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});
