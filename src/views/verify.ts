/**
 * 对账与校验 —— 只给服务者。
 *
 * 全部结论由接口在 verify=true 时给出：顶层 isBalanced、逐池 balanceVerify、
 * 跨组 groupVerifySummary、归属告警 warnings。这里不重算，只把结论摊开。
 */

import { amount, escapeHtml, type VerifySummary } from '../api';
import type { ViewContext } from '../context';
import { poolDisplay } from '../groups';

function summaryCard(title: string, sub: string, summary: VerifySummary | undefined, rows: Array<[string, unknown]>): string {
  if (!summary) {
    return `<div class="card">
      <div class="card-head"><h3>${escapeHtml(title)}</h3></div>
      <div class="card-body"><div class="empty">未开启守恒校验：把顶部的「守恒校验」勾上重新查询</div></div>
    </div>`;
  }
  const pass = summary.allPass !== false;
  return `
    <div class="card">
      <div class="card-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="sub">${escapeHtml(sub)}</span>
        <span class="right"><span class="tag ${pass ? 'tag-in' : 'tag-out'}">${pass ? '全部通过' : '存在不通过'}</span></span>
      </div>
      <div class="card-body">
        <dl class="kv">${rows.filter(([, v]) => v != null).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
        ${summary.ruleDesc ? `<div class="verify-line">${escapeHtml(summary.ruleDesc)}</div>` : ''}
      </div>
    </div>`;
}

export function renderVerify(target: HTMLElement, ctx: ViewContext): void {
  const { data } = ctx;
  const balanced = data.isBalanced !== false;
  const bs = data.balanceVerifySummary;
  const gs = data.groupVerifySummary;

  // 逐池不通过：接口已在每个池的 balanceVerify.passed 上给了结论
  const mismatchPools = ctx.pools.filter((p) => p.balanceVerify?.passed === false);

  // 组内入金 − 出金 ≠ 0 的组；单边组按枚举契约豁免
  const unbalanced = ctx.groups.filter((g) => !g.info.singleSided && Math.abs(g.diff) > 0.01);

  const warnings = data.warnings ?? [];

  target.innerHTML = `
    <div class="view-head">
      <h2>对账与校验</h2>
      <p>结论全部由 /ledger/project 在 verify=true 时返回：顶层守恒、逐池余额对源表、跨池交易组两端配平。这里只摊开展示，不重新计算。</p>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>顶层守恒</h3>
        <span class="right"><span class="tag ${balanced ? 'tag-in' : 'tag-out'}">${balanced ? '守恒' : '不守恒'}</span></span>
      </div>
      <div class="card-body">
        <dl class="kv">
          <dt>客户累计实付</dt><dd>${amount(data.customerTotalPay)}</dd>
          <dt>客户累计退款</dt><dd>${amount(data.customerTotalRefund)}</dd>
          <dt>客户净投入</dt><dd>${amount(data.customerNetInvestment)}</dd>
          <dt>内部池余额</dt><dd>${amount(data.systemInternalBalance)}</dd>
          <dt>外部池余额</dt><dd>${amount(data.externalBalance)}</dd>
          <dt>系统内余额</dt><dd>${amount(data.systemBalance)}</dd>
        </dl>
        <div class="verify-line">${escapeHtml(data.balanceCheckMessage ?? '')}</div>
      </div>
    </div>

    ${summaryCard('资金池余额验证', '账本口径 vs 源表余额，容差 0.01 元', bs, [
      ['资金池总数', bs?.poolCount],
      ['可校验池数', bs?.checkedCount],
      ['通过', bs?.passedCount],
      ['不通过', bs?.mismatchCount],
      ['跳过（派生池）', bs?.skippedCount],
    ])}

    ${mismatchPools.length ? `
      <div class="card">
        <div class="card-head"><h3>余额不通过的池</h3><span class="sub">${mismatchPools.length} 个</span></div>
        <div class="card-body">
          ${mismatchPools.map((pool) => {
            const disp = poolDisplay(pool.poolId ?? '', pool.poolType, pool);
            const v = pool.balanceVerify;
            return `<div class="pool-card" style="margin-bottom:8px">
              <div class="pool-head" data-pool="${escapeHtml(pool.poolId ?? '')}">
                <span>${disp.icon}</span>
                <span>
                  <div class="pool-name">${escapeHtml(disp.name)} <span class="leg-id">${escapeHtml(disp.fullId)}</span></div>
                  <div class="pool-meta"><span>账本 ${amount(v?.ledgerBalance)}</span><span>源表 ${v?.dbBalance == null ? '无记录' : amount(v.dbBalance)}</span><span>差额 ${amount(v?.diff)}</span></div>
                  <div class="verify-line" style="border:0;padding:4px 0 0;margin:0">${escapeHtml(v?.verifyNote ?? '')}</div>
                </span>
                <span class="pool-balance negative">${amount(v?.diff)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

    ${summaryCard('跨池交易组守恒', '同组入金合计 − 出金合计 应为 0', gs, [
      ['全部交易组', gs?.groupCount],
      ['参与校验', gs?.checkedGroupCount],
      ['守恒通过', gs?.balancedGroupCount],
      ['不守恒', gs?.unbalancedGroupCount],
      ['执行中（待到账）', gs?.pendingGroupCount],
      ['单边组（豁免）', gs?.singleSidedGroupCount],
    ])}

    ${gs?.mismatchDetails?.length ? `
      <div class="card">
        <div class="card-head"><h3>接口返回的不守恒组明细</h3><span class="sub">${gs.mismatchDetails.length} 条</span></div>
        <div class="card-body"><ul class="warnlist">${gs.mismatchDetails.map((d) => `<li>${escapeHtml(typeof d === 'string' ? d : JSON.stringify(d))}</li>`).join('')}</ul></div>
      </div>` : ''}

    ${unbalanced.length ? `
      <div class="card">
        <div class="card-head"><h3>前端按组重算后仍不平的组</h3><span class="sub">${unbalanced.length} 组，点击定位</span></div>
        <div class="card-body">
          ${unbalanced.map((g) => `
            <div class="io-line" data-drawer="${escapeHtml(g.groupId)}">
              <span class="t">${escapeHtml(g.startTime.slice(5, 16))}</span>
              <span>${escapeHtml(g.info.label)} <span class="leg-id">${escapeHtml(g.groupId)}</span>
                ${g.pairingReason ? `<span class="dr-sub" style="display:block">未配对原因 ${escapeHtml(g.pairingReason)}</span>` : ''}</span>
              <span class="a negative">${amount(g.diff)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${warnings.length ? `
      <div class="card">
        <div class="card-head"><h3>资金池归属告警</h3><span class="sub">${warnings.length} 条</span></div>
        <div class="card-body"><ul class="warnlist">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>
      </div>` : ''}
  `;

  target.querySelectorAll<HTMLElement>('[data-pool]').forEach((node) => {
    node.addEventListener('click', () => ctx.goView('pools', node.dataset.pool));
  });
  target.querySelectorAll<HTMLElement>('[data-drawer]').forEach((node) => {
    node.addEventListener('click', () => ctx.openGroup(node.dataset.drawer as string));
  });
}
