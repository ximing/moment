/**
 * 未发送扇形的 SVG path。
 * 12 点为 0，顺时针量已发送角度；path 只覆盖还没传完的那一扇，已发送区域留空（透明）。
 * 坐标系 y 向下，半径盖过矩形四角，调用方按条目真实宽高绘制，避免宽条被拉成椭圆。
 * progress<=0 或 >=1 返回 null：0 用整块遮罩，1 不再盖。
 */
export function unsentSectorPath(progress: number, width: number, height: number): string | null {
  if (!(progress > 0) || progress >= 1 || !(width > 0) || !(height > 0)) return null;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.hypot(cx, cy) + 1;
  const sweep = (1 - progress) * Math.PI * 2;
  const start = progress * Math.PI * 2;
  const p1 = clockPoint(cx, cy, r, start);
  const p2 = clockPoint(cx, cy, r, 0);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${fmt(cx)} ${fmt(cy)} L ${fmt(p1.x)} ${fmt(p1.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(p2.x)} ${fmt(p2.y)} Z`;
}

function clockPoint(cx: number, cy: number, r: number, clockwiseFrom12: number): { x: number; y: number } {
  return {
    x: cx + r * Math.sin(clockwiseFrom12),
    y: cy - r * Math.cos(clockwiseFrom12),
  };
}

function fmt(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
