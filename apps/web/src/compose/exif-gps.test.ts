import { describe, expect, it } from 'vitest';
import { extractGpsCoords, firstGps, parseExifGps, readGpsFromFile } from './exif-gps';

// jsdom 未实现 Blob.prototype.arrayBuffer（生产浏览器有）；用 FileReader 兜底，
// 只在测试环境补、不改 setup.ts（基座文件不可动）也不改生产实现（plan 钉死）。
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/**
 * 手写最小 JPEG + EXIF APP1（GPS IFD）fixture（spec people-place §9：EXIF 解析函数用
 * 含 GPS 的 fixture buffer 单测）。TIFF 小端布局（字节偏移）：
 *   0x00 'II' + 0x2A + IFD0 offset 8 → IFD0@0x08（1 entry：GPSInfo IFD pointer 0x8825
 *   → 0x1A）→ GPS IFD@0x1A（4 entries，tag 升序 1/2/3/4：LatRef 内联 ASCII、Lat RATIONAL
 *   → 0x50、LngRef 内联、Lng RATIONAL → 0x68）→ 0x50/0x68 各 3 个 RATIONAL（×100/100 保两位小数）。
 */
function buildGpsJpeg(
  latDms: [number, number, number],
  latRef: 'N' | 'S',
  lngDms: [number, number, number],
  lngRef: 'E' | 'W',
): ArrayBuffer {
  const tiff = new ArrayBuffer(0x80);
  const view = new DataView(tiff);
  const bytes = new Uint8Array(tiff);

  const writeAscii = (offset: number, tag: number, s: string) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 2, true); // ASCII
    view.setUint32(offset + 4, s.length + 1, true); // count 含终止符
    for (let i = 0; i < 4; i++) bytes[offset + 8 + i] = i < s.length ? s.charCodeAt(i) : 0;
  };
  const writeRationalOffset = (offset: number, tag: number, valueOffset: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 5, true); // RATIONAL
    view.setUint32(offset + 4, 3, true);
    view.setUint32(offset + 8, valueOffset, true);
  };
  const writeRationals = (offset: number, dms: [number, number, number]) => {
    dms.forEach((v, i) => {
      view.setUint32(offset + i * 8, Math.round(v * 100), true);
      view.setUint32(offset + i * 8 + 4, 100, true);
    });
  };

  // TIFF header（little endian）
  bytes.set([0x49, 0x49], 0);
  view.setUint16(2, 0x2a, true);
  view.setUint32(4, 8, true);
  // IFD0：仅一个 GPSInfo IFD pointer（0x8825）
  view.setUint16(8, 1, true);
  view.setUint16(0x0a, 0x8825, true);
  view.setUint16(0x0c, 4, true); // LONG
  view.setUint32(0x0e, 1, true);
  view.setUint32(0x12, 0x1a, true); // GPSInfo 指针 value：entry 自 0x0a 起（tag 2 + type 2 + count 4），value 在 0x12
  view.setUint32(0x16, 0, true); // next IFD：1 个 entry（12 字节）之后，即 0x16
  // GPS IFD
  view.setUint16(0x1a, 4, true);
  writeAscii(0x1c, 0x0001, latRef);
  writeRationalOffset(0x28, 0x0002, 0x50);
  writeAscii(0x34, 0x0003, lngRef);
  writeRationalOffset(0x40, 0x0004, 0x68);
  view.setUint32(0x4c, 0, true); // next IFD
  writeRationals(0x50, latDms);
  writeRationals(0x68, lngDms);

  const jpeg = new ArrayBuffer(12 + tiff.byteLength);
  const jv = new DataView(jpeg);
  const jb = new Uint8Array(jpeg);
  jb.set([0xff, 0xd8, 0xff, 0xe1], 0); // SOI + APP1 marker
  jv.setUint16(4, 2 + 6 + tiff.byteLength, true); // 段长（含自身 2 字节）
  jb.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // 'Exif\0\0'
  jb.set(new Uint8Array(tiff), 12);
  return jpeg;
}

describe('parseExifGps（spec people-place §3 web 端）', () => {
  it('N/E 半球 → 正十进制（39°54\'15.12" / 116°24\'26.64"）', async () => {
    const buf = buildGpsJpeg([39, 54, 15.12], 'N', [116, 24, 26.64], 'E');
    const coords = await parseExifGps(buf);
    expect(coords).not.toBeNull();
    expect(coords!.lat).toBeCloseTo(39.9042, 4);
    expect(coords!.lng).toBeCloseTo(116.4074, 4);
  });

  it('S/W 半球 → 取负（spec §3：S/W 半球取负）', async () => {
    const buf = buildGpsJpeg([33, 52, 7.68], 'S', [151, 12, 33.48], 'W');
    const coords = await parseExifGps(buf);
    expect(coords!.lat).toBeCloseTo(-33.8688, 4);
    expect(coords!.lng).toBeCloseTo(-151.2093, 4);
  });

  it('无 EXIF 的 JPEG（SOI+EOI）→ null（静默）', async () => {
    const buf = new ArrayBuffer(4);
    new Uint8Array(buf).set([0xff, 0xd8, 0xff, 0xd9]);
    expect(await parseExifGps(buf)).toBeNull();
  });

  it('垃圾字节 → null（解析失败静默，不抛错，spec §3）', async () => {
    expect(await parseExifGps(new ArrayBuffer(64))).toBeNull();
  });
});

describe('readGpsFromFile / firstGps', () => {
  it('image/* File 走切片解析；非 image → null', async () => {
    const buf = buildGpsJpeg([39, 54, 15.12], 'N', [116, 24, 26.64], 'E');
    const coords = await readGpsFromFile(new File([buf], 'a.jpg', { type: 'image/jpeg' }));
    expect(coords?.lat).toBeCloseTo(39.9042, 4);
    expect(await readGpsFromFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBeNull();
  });

  it('多图取第一张含 GPS 的，其余忽略（spec §3）', async () => {
    const withGps = buildGpsJpeg([39, 54, 15.12], 'N', [116, 24, 26.64], 'E');
    const noExif = new ArrayBuffer(4);
    new Uint8Array(noExif).set([0xff, 0xd8, 0xff, 0xd9]);
    // 第一张无 GPS、第二张有 → 取第二张；顺序反过来 → 取第一张
    const second = await firstGps([
      new File([noExif], 'a.jpg', { type: 'image/jpeg' }),
      new File([withGps], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    expect(second?.lng).toBeCloseTo(116.4074, 4);
    const first = await firstGps([
      new File([withGps], 'a.jpg', { type: 'image/jpeg' }),
      new File([withGps], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    expect(first?.lat).toBeCloseTo(39.9042, 4);
    expect(await firstGps([])).toBeNull();
  });
});

describe('extractGpsCoords 纯函数', () => {
  it('缺 Latitude/Longitude → null；越界坐标 → null（脏数据静默丢弃）', () => {
    expect(extractGpsCoords({})).toBeNull();
    expect(extractGpsCoords({ gps: { Latitude: 91, Longitude: 0 } })).toBeNull();
    expect(extractGpsCoords({ gps: { Latitude: 0, Longitude: 181 } })).toBeNull();
    expect(extractGpsCoords({ gps: { Latitude: 39.9, Longitude: 116.4 } })).toEqual({ lat: 39.9, lng: 116.4 });
  });
});
