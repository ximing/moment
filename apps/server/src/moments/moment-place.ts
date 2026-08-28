import type { PlaceInput, PlaceSource } from '@moment/dto';

/** moments 表 place 四列的写值形状（spec §2：三值列 + source 同生同灭） */
export interface PlaceColumns {
  placeLat: number | null;
  placeLng: number | null;
  placeName: string | null;
  placeSource: PlaceSource | null;
}

/**
 * place 赋值表（spec §6，source 只能 server 判定，客户端不传 source）：
 * - 坐标 + 名字 → manual（客户端地图选点/确认后的形态），不触发 geocode
 * - 仅坐标     → exif（EXIF 路），place_name 留空待 worker 回填
 * - 仅名字     → manual（无坐标），不触发 geocode
 * - null/缺省  → 四列全 null（PATCH 上为显式清除；create 上等价未传，P1 偏差 4）
 * 整体覆盖语义：提交 place 即整体覆盖四列（「仅名字」会把既有坐标清掉——三列同生同灭）。
 */
export function placeColumnsOf(place: PlaceInput | null | undefined): PlaceColumns {
  if (!place) return { placeLat: null, placeLng: null, placeName: null, placeSource: null };
  const hasCoords = place.lat !== undefined && place.lng !== undefined;
  if (hasCoords) {
    return {
      placeLat: place.lat as number,
      placeLng: place.lng as number,
      placeName: place.name ?? null,
      placeSource: place.name !== undefined ? 'manual' : 'exif',
    };
  }
  return { placeLat: null, placeLng: null, placeName: place.name ?? null, placeSource: 'manual' };
}

/** geocode 触发判据（spec §4）：仅坐标且 place_name 空（exif 形态）→ 同事务写 moment.geocode */
export function isGeocodePending(
  c: PlaceColumns
): c is PlaceColumns & { placeLat: number; placeLng: number; placeSource: 'exif' } {
  return c.placeSource === 'exif' && c.placeName === null && c.placeLat !== null && c.placeLng !== null;
}
