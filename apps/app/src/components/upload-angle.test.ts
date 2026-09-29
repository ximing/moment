import { describe, expect, it } from 'vitest';
import { unsentSectorPath } from './upload-angle';

function parse(d: string): {
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  r: number;
  large: number;
  x2: number;
  y2: number;
} {
  const m = d.match(/^M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+) A ([-\d.]+) \5 0 ([01]) 1 ([-\d.]+) ([-\d.]+) Z$/);
  if (!m) throw new Error(`unparsed: ${d}`);
  return {
    cx: Number(m[1]),
    cy: Number(m[2]),
    x1: Number(m[3]),
    y1: Number(m[4]),
    r: Number(m[5]),
    large: Number(m[6]),
    x2: Number(m[7]),
    y2: Number(m[8]),
  };
}

describe('unsentSectorPath', () => {
  it('还没发送或已经发完时不画扇形', () => {
    expect(unsentSectorPath(0, 100, 100)).toBeNull();
    expect(unsentSectorPath(1, 100, 100)).toBeNull();
    expect(unsentSectorPath(-0.2, 100, 100)).toBeNull();
    expect(unsentSectorPath(1.2, 100, 100)).toBeNull();
    expect(unsentSectorPath(0.4, 0, 40)).toBeNull();
  });

  it('25% 从 3 点顺时针画回 12 点，走大弧', () => {
    const arc = parse(unsentSectorPath(0.25, 100, 100)!);
    expect(arc.cx).toBe(50);
    expect(arc.cy).toBe(50);
    expect(arc.large).toBe(1);
    expect(arc.x1).toBeGreaterThan(arc.cx);
    expect(arc.y1).toBeCloseTo(arc.cy, 0);
    expect(arc.x2).toBeCloseTo(arc.cx, 0);
    expect(arc.y2).toBeLessThan(arc.cy);
    expect(arc.r).toBeGreaterThan(Math.hypot(50, 50));
  });

  it('50% 从 6 点画回 12 点，不是大弧', () => {
    const arc = parse(unsentSectorPath(0.5, 100, 100)!);
    expect(arc.large).toBe(0);
    expect(arc.x1).toBeCloseTo(arc.cx, 0);
    expect(arc.y1).toBeGreaterThan(arc.cy);
    expect(arc.y2).toBeLessThan(arc.cy);
  });

  it('75% 从 9 点画回 12 点', () => {
    const arc = parse(unsentSectorPath(0.75, 100, 100)!);
    expect(arc.large).toBe(0);
    expect(arc.x1).toBeLessThan(arc.cx);
    expect(arc.y1).toBeCloseTo(arc.cy, 0);
  });

  it('宽条按真实宽高取圆心，扇形不被压成椭圆', () => {
    const arc = parse(unsentSectorPath(0.25, 200, 40)!);
    expect(arc.cx).toBe(100);
    expect(arc.cy).toBe(20);
    expect(arc.x1).toBeGreaterThan(arc.cx);
    expect(arc.y2).toBeLessThan(arc.cy);
    expect(arc.r).toBeGreaterThan(Math.hypot(100, 20));
  });
});
