import type { ExpandedTags } from 'exifreader';

/**
 * EXIF GPS 读取（spec people-place §3 web 端）：
 * - 只读文件头结构化元数据，不做像素解码；切片 256KB 对 JPEG 必然覆盖 APP1 段，
 *   对 HEIC 尽力而为（失败静默）。
 * - exifreader 动态 import（先例：ChainAppearanceEditor 的 EmojiPickerPanel 懒加载），
 *   compose 流程外零加载体积。
 * - 十进制换算与 S/W 取负用 exifreader expanded gps 组的预计算值（源码核实：
 *   gps.Latitude 由 DMS 有理数换算、Ref 为 S/W 时取负）；S/W 行为由 fixture 测试钉死。
 * - 任何失败（无 GPS / 形状异常 / 越界坐标 / 解析抛错）一律 null，绝不提示错误。
 */

/** WGS-84 十进制坐标（server 落库原值，spec §4）。 */
export interface GpsCoords {
  lat: number;
  lng: number;
}

/** EXIF 切片上限（spec §3）：256 * 1024。 */
const EXIF_SLICE_BYTES = 256 * 1024;

/** 从 exifreader expanded tags 提取十进制 GPS；无 GPS / 非有限数 / 越界 → null。 */
export function extractGpsCoords(tags: ExpandedTags): GpsCoords | null {
  const lat = tags.gps?.Latitude;
  const lng = tags.gps?.Longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 客户端坐标是不可信输入（spec §3）：越界视为脏数据静默丢弃（server 还有一层 400）
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** 解析 ArrayBuffer；exifreader 动态 import，任何异常 → null（静默）。 */
export async function parseExifGps(buffer: ArrayBuffer): Promise<GpsCoords | null> {
  try {
    const { load } = await import('exifreader');
    return extractGpsCoords(load(buffer, { expanded: true }));
  } catch {
    return null;
  }
}

/** 对 image/* 的 File 切前 256KB 解析；非 image → null。 */
export async function readGpsFromFile(file: File): Promise<GpsCoords | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const buffer = await file.slice(0, EXIF_SLICE_BYTES).arrayBuffer();
    return await parseExifGps(buffer);
  } catch {
    return null;
  }
}

/** 多图取第一张含 GPS 的照片，其余忽略（spec §3：v1 不做多坐标合并）。 */
export async function firstGps(files: readonly File[]): Promise<GpsCoords | null> {
  for (const file of files) {
    const coords = await readGpsFromFile(file);
    if (coords) return coords;
  }
  return null;
}
