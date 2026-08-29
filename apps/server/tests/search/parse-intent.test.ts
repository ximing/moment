import { isoDatetime } from '@moment/dto';
import {
  degradedParsed,
  parseIntentJson,
  viewerWallDate,
} from '../../src/search/parse-intent.js';

describe('viewerWallDate（spec §3.1，与 wallDateOf 同一算术）', () => {
  it('东八区：UTC 08-28 16:30 → 查看者 08-29', () => {
    expect(viewerWallDate(-480, Date.parse('2026-08-28T16:30:00.000Z'))).toBe('2026-08-29');
  });

  it('tzOffset=0：UTC 历法日', () => {
    expect(viewerWallDate(0, Date.parse('2026-08-29T04:00:00.000Z'))).toBe('2026-08-29');
  });
});

describe('degradedParsed', () => {
  it('整句当 text', () => {
    expect(degradedParsed('外婆')).toEqual({
      personNames: [],
      place: null,
      time: null,
      text: '外婆',
    });
  });
});

describe('parseIntentJson（对齐 parseExtractJson 防御，spec §3.1）', () => {
  const ok = {
    personNames: ['外婆'],
    place: '朝阳公园',
    time: { kind: 'wall_date' as const, year: 2025, month: 8, day: 29 },
    text: '野餐',
  };

  it('合法 JSON', () => {
    expect(parseIntentJson(JSON.stringify(ok))).toEqual(ok);
  });

  it('剥 ```json 围栏', () => {
    expect(parseIntentJson('```json\n' + JSON.stringify(ok) + '\n```')).toEqual(ok);
  });

  it('personNames 非字符串元素丢弃；缺字段或非数组 = 畸形 null', () => {
    expect(parseIntentJson(JSON.stringify({ ...ok, personNames: ['外婆', 1, null, '朵朵'] }))).toEqual({
      ...ok,
      personNames: ['外婆', '朵朵'],
    });
    expect(parseIntentJson(JSON.stringify({ ...ok, personNames: '外婆' }))).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, personNames: undefined }))).toBeNull();
    const { personNames: _drop, ...rest } = ok;
    expect(parseIntentJson(JSON.stringify(rest))).toBeNull();
    void _drop;
  });

  it('place 必须 string 或 null；text 缺省 ""；text 非 string = 畸形', () => {
    expect(parseIntentJson(JSON.stringify({ ...ok, place: null, text: undefined }))).toEqual({
      ...ok,
      place: null,
      text: '',
    });
    expect(parseIntentJson(JSON.stringify({ ...ok, place: 1 }))).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, text: 1 }))).toBeNull();
  });

  it('time.kind=range：复用 isoDatetime，且 Date.parse(from)<=Date.parse(to)；否则畸形', () => {
    const range = {
      ...ok,
      time: { kind: 'range' as const, from: '2025-06-01T00:00:00.000Z', to: '2025-08-31T23:59:59.999Z' },
    };
    expect(parseIntentJson(JSON.stringify(range))).toEqual(range);
    expect(isoDatetime.safeParse(range.time.from).success).toBe(true);

    const offsetOk = {
      ...ok,
      time: {
        kind: 'range' as const,
        from: '2026-08-01T00:00:00+08:00',
        to: '2026-07-31T23:00:00Z',
      },
    };
    expect(parseIntentJson(JSON.stringify(offsetOk))).toEqual(offsetOk);

    expect(
      parseIntentJson(
        JSON.stringify({
          ...ok,
          time: { kind: 'range', from: '2026/06/01', to: '2026-08-31T00:00:00Z' },
        }),
      ),
    ).toBeNull();
    expect(
      parseIntentJson(
        JSON.stringify({
          ...ok,
          time: { kind: 'range', from: '2026-08-02T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
        }),
      ),
    ).toBeNull();
  });

  it('wall_date：year≥1 整数、month 1..12、day 1..31；否则畸形。2-30 仍过解析（SQL 零命中）', () => {
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2024, month: 2, day: 29 } })),
    ).toEqual({ ...ok, time: { kind: 'wall_date', year: 2024, month: 2, day: 29 } });
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025, month: 2, day: 30 } })),
    ).toEqual({ ...ok, time: { kind: 'wall_date', year: 2025, month: 2, day: 30 } });
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 0, month: 8, day: 29 } })),
    ).toBeNull();
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025, month: 13, day: 1 } })),
    ).toBeNull();
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025.5, month: 8, day: 29 } })),
    ).toBeNull();
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025, month: 8, day: 0 } })),
    ).toBeNull();
  });

  it('time 非法 kind / 非对象非 null = 畸形；time=null 合法', () => {
    expect(parseIntentJson(JSON.stringify({ ...ok, time: null }))).toEqual({ ...ok, time: null });
    expect(parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'today' } }))).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, time: '2025-08-29' }))).toBeNull();
  });

  it('非 JSON / 空串 / 数组根 = null；多余 tag 字段忽略（意图不抽 tag）', () => {
    expect(parseIntentJson('not json')).toBeNull();
    expect(parseIntentJson('')).toBeNull();
    expect(parseIntentJson('[]')).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, tag: '野餐', tags: ['野餐'] }))).toEqual(ok);
  });
});
