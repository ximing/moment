/**
 * 原生 EXIF GPS 解析（spec people-place §3 app 端）：
 * expo-image-picker `launchImageLibraryAsync({ exif: true })` 读取**压缩前原始 asset** 的
 * EXIF（绕开压缩剥 EXIF 的失败模式，spec §0）；本模块从 asset.exif 里取出十进制 WGS-84
 * 坐标（server 落库原值，spec §4）。
 *
 * 结构兼容两种形态（spec §3）：
 * - 扁平键 GPSLatitude/GPSLongitude/GPSLatitudeRef/GPSLongitudeRef：Android 实测形态
 *   （ExifInterface.latLong，十进制 double、已带符号）；iOS 在 expo-image-picker 17.x
 *   也已拍平为同一形态（ImageUtils.readExifFrom 源码核实，见 P6 计划偏差 1）；
 * - 嵌套 GPS / '{GPS}' 子字典（内层 Latitude/LatitudeRef/...）：旧 Expo 版本 iOS 把
 *   UIImagePickerController 原始 metadata 直传的形态（spec §3 字面要求兼容）。
 * 值形态兼容 number 与 string（EXIF tag 序列化后可能是字符串）。
 *
 * 任何失败（缺 GPS / 形状异常 / 越界 / (0,0) 幽灵值）一律 null，绝不抛错、不提示
 * （spec §3 失败静默）。本文件零 expo/RN import——纯函数，node 环境可测。
 */

/** WGS-84 十进制坐标（server 落库原值，spec §4）。 */
export interface GpsCoords {
  lat: number;
  lng: number;
}

type ExifDict = Record<string, unknown>;

/** number 或可解析为有限数的 string → number；其余形态（DMS 有理数串/数组/NaN）→ null。 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 半球符号（spec §3：S/W 取负）。用 -Math.abs 幂等：Android latLong 已带符号（S/W 为负数）
 * 时不会二次取负；N/E/缺 Ref 原样保留（不翻转 Android 已带符号的负值）。Ref 匹配大小写不敏感。
 */
function applyHemisphere(value: number, ref: unknown): number {
  const r = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (r === 'S' || r === 'W') return -Math.abs(value);
  return value;
}

/** 从单个 GPS 视图（扁平 exif 本身，或嵌套 GPS 子字典内层）取 {lat, lng}；任一缺失/畸形 → null。 */
function readLatLng(view: ExifDict | null | undefined): { lat: number; lng: number } | null {
  if (!view || typeof view !== 'object') return null;
  const lat = toFiniteNumber(view.Latitude ?? view.GPSLatitude);
  const lng = toFiniteNumber(view.Longitude ?? view.GPSLongitude);
  if (lat === null || lng === null) return null;
  return {
    lat: applyHemisphere(lat, view.LatitudeRef ?? view.GPSLatitudeRef),
    lng: applyHemisphere(lng, view.LongitudeRef ?? view.GPSLongitudeRef),
  };
}

/** 取嵌套 GPS 子字典（键名 'GPS' 或带花括号的 '{GPS}'，旧 Expo iOS 两种键名都接）。 */
function pickGpsDict(exif: ExifDict): ExifDict | null {
  const nested = exif.GPS ?? exif['{GPS}'];
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as ExifDict) : null;
}

/** 从 picker asset 的 exif 对象提取十进制 GPS；无 GPS / 畸形 / 越界 / (0,0) → null（静默）。 */
export function extractAssetGps(exif: ExifDict | null | undefined): GpsCoords | null {
  if (!exif || typeof exif !== 'object') return null;
  // 扁平键优先（Android / iOS 17.x 实测形态）；嵌套 GPS 子字典兜底（旧 Expo iOS）
  const raw = readLatLng(exif) ?? readLatLng(pickGpsDict(exif));
  if (!raw) return null;
  // 客户端坐标是不可信输入（spec §3）：越界视为脏数据静默丢弃（server 还有一层 400 PLACE_COORDS_INVALID）
  if (Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) return null;
  // (0,0) 幽灵值防御（P6 计划偏差 3）：Android ExifInterface.getAttributeDouble 默认 0.0
  // 的失败模式——原始串存在但 latLong 因缺 Ref 为 null 时暴露 0.0
  if (raw.lat === 0 && raw.lng === 0) return null;
  return raw;
}

/** EXIF 拍摄墙钟 → YYYY-MM-DDTHH:mm（与 web datetime-local 同形）。 */
export function parseExifDateToWallClock(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/** 墙钟字符串 → 设备本地 Date（不走 Date.parse 的无时区歧义）。 */
export function wallClockToLocalDate(wall: string): Date | null {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
}

function pickExifDict(exif: ExifDict): ExifDict | null {
  const nested = exif.Exif ?? exif['{Exif}'];
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as ExifDict) : null;
}

function readDateTimeRaw(view: ExifDict | null | undefined): string | null {
  if (!view) return null;
  const raw = view.DateTimeOriginal ?? view.DateTimeDigitized ?? view.DateTime;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/** 从 picker asset 的 exif 对象提取拍摄墙钟；无/畸形 → null（静默）。 */
export function extractAssetDateTime(exif: ExifDict | null | undefined): string | null {
  if (!exif || typeof exif !== 'object') return null;
  const raw = readDateTimeRaw(exif) ?? readDateTimeRaw(pickExifDict(exif));
  return parseExifDateToWallClock(raw);
}

/** 多图取第一张含拍摄时间的照片。 */
export function firstAssetDateTime(assets: readonly { exif?: ExifDict | null }[]): string | null {
  for (const asset of assets) {
    const wall = extractAssetDateTime(asset.exif);
    if (wall) return wall;
  }
  return null;
}

/** 多图取第一张含 GPS 的照片，其余忽略（spec §3：v1 不做多坐标合并）。 */
export function firstAssetGps(assets: readonly { exif?: ExifDict | null }[]): GpsCoords | null {
  for (const asset of assets) {
    const coords = extractAssetGps(asset.exif);
    if (coords) return coords;
  }
  return null;
}
