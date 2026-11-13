import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import { GeocodeController } from '../../src/geocode/geocode.controller.js';

/** 与日志断言绑定的坐标。不得出现在 warn 文本里。 */
const LAT = 12.340001;
const LNG = -77.770002;

describe('GeocodeController.reverse 失败观测', () => {
  let log: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    setGeocodeProvider(undefined);
    log.mockRestore();
  });

  function loggedText(): string {
    return log.mock.calls.map((args) => args.map((part) => String(part)).join(' ')).join('\n');
  }

  it('provider.reverse 抛错 → { name: null }，warn 含错误且不含坐标', async () => {
    setGeocodeProvider({
      reverse: jest.fn(async () => {
        throw new Error('AMAP_DOWN');
      }),
    } as unknown as GeocodeProvider);

    const res = await new GeocodeController().reverse({ lat: LAT, lng: LNG });

    expect(res).toEqual({ name: null });
    const logged = loggedText();
    expect(logged).toContain('geocode reverse failed');
    expect(logged).toContain('AMAP_DOWN');
    expect(logged).not.toContain(String(LAT));
    expect(logged).not.toContain(String(LNG));
  });

  it('没有 provider → { name: null }，不 warn', async () => {
    setGeocodeProvider(null);

    const res = await new GeocodeController().reverse({ lat: LAT, lng: LNG });

    expect(res).toEqual({ name: null });
    expect(loggedText()).not.toContain('geocode reverse failed');
  });
});
