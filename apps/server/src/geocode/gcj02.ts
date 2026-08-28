/**
 * WGS-84 → GCJ-02 坐标换算（spec people-place §4）。
 *
 * 高德全家（regeo / 地图 SDK）使用 GCJ-02（俗称火星坐标系）；EXIF GPS 与手动地图选点
 * 均为 WGS-84。DB 恒存 WGS-84 原值（数据真相），仅在调用高德前做本换算；
 * 后续「地图足迹」展示同样复用本模块。
 *
 * 纯函数、零依赖；标准偏移算法（克拉索夫斯基椭球 + 多项式扰动），
 * 与业界通用实现（eviltransform 等）逐项一致。
 * 境外判断用经典矩形边界（见 outOfChina）；境外点原值返回，不偏移
 * （高德对境外坐标按 WGS-84 语义应答，spec §4「境外不偏移直接请求」）。
 */

/** 克拉索夫斯基椭球长半轴（米），GCJ-02 偏移计算的基准椭球 */
const SEMI_MAJOR_AXIS = 6378245.0;
/** 第一偏心率平方（克拉索夫斯基椭球；尾数 23 超出 double 精度，截断到可表示值） */
const ECCENTRICITY_SQ = 0.006693421622965943;

/** 换算结果点（度数） */
export interface Gcj02Point {
  lat: number;
  lng: number;
}

/**
 * 中国境外判断：经典矩形边界（业内通用实现；经典实现用严格不等式、边界值算境外，
 * 本计划用含等号、边界值算界内——本计划钉死，见计划偏差 6）。
 * 港澳台落在矩形内 → 按境内偏移处理。边界值本身算界内。
 */
export function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02（度数）。境内点偏移百米级（实测 dLat≈0.001..0.003、dLng≈0.003..0.006）；
 * 境外点原值返回（lat/lng 数值不变）。
 */
export function wgs84ToGcj02(lat: number, lng: number): Gcj02Point {
  if (outOfChina(lat, lng)) return { lat, lng };

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ECCENTRICITY_SQ * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQ)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
