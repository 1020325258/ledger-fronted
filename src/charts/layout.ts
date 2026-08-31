/**
 * 图表共用的小工具：squarified 树图布局、金额缩写、色阶。
 *
 * 这里只有几何计算，不涉及账本口径。
 */

export interface Rect { x: number; y: number; w: number; h: number }

function worst(row: number[], side: number, scale: number): number {
  const sum = row.reduce((a, b) => a + b, 0) * scale;
  const max = Math.max(...row) * scale;
  const min = Math.min(...row) * scale;
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap（Bruls/Huizing/van Wijk）：把面积按 values 比例切成尽量接近正方形的块。
 * values 必须已按降序排列，返回的 rect 与 values 一一对应。
 */
export function squarify(values: number[], x: number, y: number, w: number, h: number): Rect[] {
  const out: Rect[] = [];
  let remaining = values.reduce((a, b) => a + b, 0);
  let i = 0;
  let [cx, cy, cw, ch] = [x, y, w, h];

  while (i < values.length && remaining > 0 && cw > 0 && ch > 0) {
    const side = Math.min(cw, ch);
    const scale = (cw * ch) / remaining;
    let row = [values[i]];
    let best = worst(row, side, scale);
    let j = i + 1;
    while (j < values.length) {
      const trial = [...row, values[j]];
      const w2 = worst(trial, side, scale);
      if (w2 > best) break;
      row = trial;
      best = w2;
      j += 1;
    }

    const rowArea = row.reduce((a, b) => a + b, 0) * scale;
    if (cw <= ch) {
      const rowH = rowArea / cw;
      let px = cx;
      row.forEach((v) => {
        const vw = (v * scale) / rowH;
        out.push({ x: px, y: cy, w: vw, h: rowH });
        px += vw;
      });
      cy += rowH;
      ch -= rowH;
    } else {
      const rowW = rowArea / ch;
      let py = cy;
      row.forEach((v) => {
        const vh = (v * scale) / rowW;
        out.push({ x: cx, y: py, w: rowW, h: vh });
        py += vh;
      });
      cx += rowW;
      cw -= rowW;
    }
    remaining -= row.reduce((a, b) => a + b, 0);
    i = j;
  }
  return out;
}

/** 图上标金额：万位以上压缩，完整值放 title。 */
export function shortAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${(value / 10000).toFixed(abs >= 100000 ? 1 : 2)}万`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: abs < 100 ? 2 : 0 });
}

/** 同类型内多个池的色阶：同一色相，按顺序递减明度区分。 */
export function shade(hex: string, index: number, total: number): string {
  if (total <= 1) return hex;
  const t = index / Math.max(1, total - 1);
  const mix = 0.55 * t; // 最多混入 55% 白
  const n = parseInt(hex.slice(1), 16);
  const to = (c: number): number => Math.round(c + (255 - c) * mix);
  return `rgb(${to((n >> 16) & 255)},${to((n >> 8) & 255)},${to(n & 255)})`;
}
