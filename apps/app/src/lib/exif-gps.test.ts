import { describe, expect, it } from 'vitest';
import {
  extractAssetDateTime,
  extractAssetGps,
  firstAssetDateTime,
  firstAssetGps,
  parseExifDateToWallClock,
  wallClockToLocalDate,
} from './exif-gps';

// EXIF GPS 解析契约（spec people-place §3 app 端 + 编排 T6「先 fixture 测试验证两条
// 解析路径再真机确认」）：
// - 扁平键 GPSLatitude/GPSLongitude(±Ref)：Android 实测形态（latLong 十进制 double，
//   已带符号）；iOS expo-image-picker 17.x 同为扁平键（ImageUtils 拍平，源码核实）；
// - 嵌套 GPS / '{GPS}' 子字典（内层 Latitude/LatitudeRef/...）：旧 Expo iOS 直传
//   UIImagePickerController metadata 的形态（spec §3 字面要求兼容）；
// - 值兼容 number 与 string（EXIF tag 序列化后可能是字符串）；
// - S/W 取负用 -Math.abs 幂等（Android 已带符号不双负；Ref 大小写不敏感）；缺 Ref 按 N/E、
//   N/E 时负值输入原样保留；
// - 越界 / (0,0) 幽灵值（Android getAttributeDouble 默认 0.0 失败模式）/ 畸形 → null。

describe('extractAssetGps：扁平键（Android / iOS 17.x 实测形态）', () => {
  it('number 值 + N/E Ref → 正十进制', () => {
    expect(
      extractAssetGps({
        GPSLatitude: 39.9042,
        GPSLongitude: 116.4074,
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('string 值（EXIF tag 序列化形态）同样解析', () => {
    expect(
      extractAssetGps({
        GPSLatitude: '39.9042',
        GPSLongitude: '116.4074',
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('S/W Ref → 取负（spec §3：S/W 半球取负）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: 33.8688,
        GPSLongitude: 151.2093,
        GPSLatitudeRef: 'S',
        GPSLongitudeRef: 'W',
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('Android latLong 已带符号 + S Ref → 幂等不双负（偏差 2）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: -33.8688,
        GPSLongitude: -151.2093,
        GPSLatitudeRef: 'S',
        GPSLongitudeRef: 'W',
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('lowercase Ref（s/w）同判取负（偏差 2：Ref 匹配大小写不敏感）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: 33.8688,
        GPSLongitude: 151.2093,
        GPSLatitudeRef: 's',
        GPSLongitudeRef: 'w',
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('N/E Ref + 负值输入 → 原样保留符号（不翻转，偏差 2）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: -33.8688,
        GPSLongitude: -116.4074,
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: -33.8688, lng: -116.4074 });
  });

  it('缺 Ref → 按 N/E 正半球（默认）', () => {
    expect(extractAssetGps({ GPSLatitude: 39.9042, GPSLongitude: 116.4074 })).toEqual({
      lat: 39.9042,
      lng: 116.4074,
    });
  });
});

describe('extractAssetGps：嵌套 {GPS} 子字典（旧 Expo iOS 形态，spec §3 字面）', () => {
  it('GPS 键嵌套 + N/E → 解析', () => {
    expect(
      extractAssetGps({
        GPS: { Latitude: 39.9042, Longitude: 116.4074, LatitudeRef: 'N', LongitudeRef: 'E' },
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('带花括号的 {GPS} 键（UIImagePickerController metadata 原始键名）同样解析', () => {
    expect(
      extractAssetGps({
        '{GPS}': { Latitude: 39.9042, Longitude: 116.4074, LatitudeRef: 'N', LongitudeRef: 'E' },
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('嵌套 + S/W → 取负', () => {
    expect(
      extractAssetGps({
        GPS: { Latitude: 33.8688, Longitude: 151.2093, LatitudeRef: 'S', LongitudeRef: 'W' },
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('嵌套内层用 GPS 前缀键名（GPSLatitude）同样接', () => {
    expect(extractAssetGps({ GPS: { GPSLatitude: 39.9, GPSLongitude: 116.4 } })).toEqual({
      lat: 39.9,
      lng: 116.4,
    });
  });
});

describe('extractAssetGps：静默 null 的全部失败形态（spec §3：失败静默不提示）', () => {
  it('exif 为 null / undefined / 空对象 / 只有无关 tag → null（缺 GPS）', () => {
    expect(extractAssetGps(null)).toBeNull();
    expect(extractAssetGps(undefined)).toBeNull();
    expect(extractAssetGps({})).toBeNull();
    expect(extractAssetGps({ Make: 'Apple', Model: 'iPhone' })).toBeNull();
  });

  it('只有纬度没有经度（或反之）→ null', () => {
    expect(extractAssetGps({ GPSLatitude: 39.9, GPSLatitudeRef: 'N' })).toBeNull();
    expect(extractAssetGps({ GPSLongitude: 116.4, GPSLongitudeRef: 'E' })).toBeNull();
  });

  it('越界坐标 → null（脏数据静默丢弃；server 还有一层 400，spec §3）', () => {
    expect(extractAssetGps({ GPSLatitude: 91, GPSLongitude: 0 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: 0, GPSLongitude: 181 })).toBeNull();
    expect(
      extractAssetGps({ GPSLatitude: -90.0000001, GPSLongitude: 0, GPSLatitudeRef: 'S' }),
    ).toBeNull();
  });

  it('(0,0) 幽灵值 → null（偏差 3：Android getAttributeDouble 默认 0.0 失败模式）', () => {
    expect(extractAssetGps({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
  });

  it('畸形值（DMS 有理数串 / 数组 / NaN / 空串）→ null', () => {
    expect(extractAssetGps({ GPSLatitude: '39/1,54/1,1512/100', GPSLongitude: 116.4 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: [39, 54, 15], GPSLongitude: 116.4 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: 'abc', GPSLongitude: 116.4 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: '', GPSLongitude: 116.4 })).toBeNull();
  });
});

describe('extractAssetDateTime / firstAssetDateTime', () => {
  it('扁平 DateTimeOriginal 冒号日期 → 墙钟', () => {
    expect(extractAssetDateTime({ DateTimeOriginal: '2026:05:17 11:51:10' })).toBe('2026-05-17T11:51');
  });

  it('嵌套 {Exif} DateTimeOriginal', () => {
    expect(extractAssetDateTime({ '{Exif}': { DateTimeOriginal: '2026:05:17 11:51:10' } })).toBe(
      '2026-05-17T11:51',
    );
  });

  it('无时间 / 畸形 → null', () => {
    expect(extractAssetDateTime({ Make: 'Apple' })).toBeNull();
    expect(extractAssetDateTime({ DateTimeOriginal: 'not-a-date' })).toBeNull();
    expect(parseExifDateToWallClock('2026:13:01 00:00:00')).toBeNull();
  });

  it('多图取第一张含拍摄时间的', () => {
    expect(
      firstAssetDateTime([{ exif: null }, { exif: { DateTimeOriginal: '2026:05:17 11:51:10' } }]),
    ).toBe('2026-05-17T11:51');
  });

  it('wallClockToLocalDate 按本地字段构造', () => {
    const d = wallClockToLocalDate('2026-05-17T11:51');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4);
    expect(d!.getDate()).toBe(17);
    expect(d!.getHours()).toBe(11);
    expect(d!.getMinutes()).toBe(51);
  });
});

describe('firstAssetGps：多图取第一张含 GPS 的（spec §3）', () => {
  const withGps = { exif: { GPSLatitude: 39.9042, GPSLongitude: 116.4074, GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } };

  it('第一张无 GPS、第二张有 → 取第二张；顺序反转 → 取第一张', () => {
    expect(firstAssetGps([{ exif: null }, withGps])?.lng).toBeCloseTo(116.4074, 4);
    expect(firstAssetGps([withGps, withGps])?.lat).toBeCloseTo(39.9042, 4);
  });

  it('全无 GPS / 空数组 → null；exif 键缺省（undefined）也接', () => {
    expect(firstAssetGps([{ exif: { Make: 'Apple' } }, {}])).toBeNull();
    expect(firstAssetGps([])).toBeNull();
  });
});
