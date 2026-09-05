import { describe, expect, it } from 'vitest';
import { formatLocalDateTime, formatMomentTime, formatMomentTimeShort } from './format';

describe('formatMomentTimeShort', () => {
  it('同一墙钟日显示 今天 HH:mm', () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    expect(formatMomentTimeShort(now.toISOString(), offset)).toMatch(/^今天 \d{2}:\d{2}$/);
  });

  it('昨天显示 昨天 HH:mm', () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const yest = new Date(now.getTime() - 86_400_000);
    expect(formatMomentTimeShort(yest.toISOString(), offset)).toMatch(/^昨天 \d{2}:\d{2}$/);
  });

  it('跨年走 年年月月日', () => {
    expect(formatMomentTimeShort('2020-01-15T04:00:00.000Z', -480)).toBe('2020年1月15日');
  });
});

describe('formatMomentTime', () => {
  it('按提交方时区墙钟，不叠设备时区', () => {
    expect(formatMomentTime('2020-01-15T04:00:00.000Z', -480)).toBe('2020-01-15 12:00');
  });
});

describe('formatLocalDateTime', () => {
  it('今天显示 今天 HH:mm', () => {
    expect(formatLocalDateTime(new Date())).toMatch(/^今天 \d{2}:\d{2}$/);
  });
});
