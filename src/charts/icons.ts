/**
 * 资金池图标 —— 单色线性 SVG，替掉原来的彩色 emoji。
 *
 * emoji 的字重、颜色和渲染结果由系统字体决定，控制不了，在图上和列表里
 * 都比周围的文字重一档，显得业余。这里统一成 16×16 描边图标，
 * 颜色由 currentColor 决定，所以放在 HTML 里跟文字同色、放在 SVG 泳道里可以单独染色。
 *
 * 返回值同时可用于 HTML 和 SVG：嵌套 <svg> 在 SVG 1.1 里合法，
 * 传 x/y 就是 SVG 用法，不传就是 HTML 行内用法。
 */

/** 16×16 viewBox 内的路径，统一 stroke 画法，不用 fill。 */
const PATHS: Record<string, string> = {
  // 客户本人：头肩
  CUSTOMER: '<circle cx="8" cy="5.2" r="2.6"/><path d="M2.8 13.6c0-2.6 2.3-4.1 5.2-4.1s5.2 1.5 5.2 4.1"/>',
  // 开发商：楼宇
  DEVELOPER: '<path d="M2.6 13.8V4.2h5.6v9.6"/><path d="M8.2 13.8V7h5.2v6.8"/><path d="M4.6 6.4h1.6M4.6 9h1.6M10.2 9.4h1.4"/>',
  // 商品子单：包裹
  SUB_ORDER: '<path d="M8 2.4 13.6 5v6L8 13.6 2.4 11V5z"/><path d="M2.4 5 8 7.6 13.6 5M8 7.6v6"/>',
  // 预收款/首期款：保险柜
  ADVANCE: '<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.4"/><circle cx="8" cy="8" r="2.3"/><path d="M8 4.6v1.1M8 10.3v1.1"/>',
  // 整装款项：房屋
  FUND: '<path d="M2.6 7 8 2.8 13.4 7v6.2H2.6z"/><path d="M6.4 13.2V9.4h3.2v3.8"/>',
  // 客户余额：钱包
  WALLET: '<path d="M2.6 5.4h9.4a1.4 1.4 0 0 1 1.4 1.4v5.4a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M2.6 5.4V4.2A1.4 1.4 0 0 1 4 2.8h6.6v2.6"/><circle cx="10.6" cy="9.5" r=".9"/>',
  OTHER: '<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.6"/><path d="M5.4 6.4h5.2M5.4 9.2h3.4"/>',
};

export interface IconOpts {
  /** SVG 里定位用；不传就是 HTML 行内图标 */
  x?: number;
  y?: number;
  size?: number;
  color?: string;
}

export function poolIcon(poolType: string | undefined, opts: IconOpts = {}): string {
  const d = PATHS[poolType ?? 'OTHER'] ?? PATHS.OTHER;
  const size = opts.size ?? 16;
  const pos = opts.x != null ? ` x="${opts.x}" y="${opts.y ?? 0}"` : '';
  const color = opts.color ? ` color="${opts.color}"` : '';
  return `<svg${pos} width="${size}" height="${size}" viewBox="0 0 16 16" fill="none"`
    + ` stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`
    + ` class="pool-icon"${color} aria-hidden="true">${d}</svg>`;
}
