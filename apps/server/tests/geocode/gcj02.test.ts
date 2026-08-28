import { outOfChina, wgs84ToGcj02 } from '../../src/geocode/gcj02.js';

describe('wgs84ToGcj02（spec people-place §4 坐标系：境内偏移、境外不偏移）', () => {
  it('境内已知点（北京）产生百米级偏移：两个方向的偏移量均在 0.0005°..0.02°（约 55m..2.2km）', () => {
    const g = wgs84ToGcj02(39.9042, 116.4074);
    const dLat = Math.abs(g.lat - 39.9042);
    const dLng = Math.abs(g.lng - 116.4074);
    // 实测（标准算法）：北京 dLat≈0.0014、dLng≈0.0062 —— 断言量级带而非精确值
    // （算法输入输出连续光滑，量级带对实现细节稳健；精确回归值无权威参照系）
    expect(dLat).toBeGreaterThan(0.0005);
    expect(dLat).toBeLessThan(0.02);
    expect(dLng).toBeGreaterThan(0.0005);
    expect(dLng).toBeLessThan(0.02);
  });

  it('境内已知点（上海/广州/乌鲁木齐/哈尔滨）偏移量级一致（南北东西全覆盖）', () => {
    const points: Array<[number, number]> = [
      [31.2304, 121.4737], // 上海（dLat 为负——不假设偏移方向）
      [23.1291, 113.2644], // 广州
      [43.8256, 87.6168], // 乌鲁木齐（近西界）
      [45.8038, 126.535], // 哈尔滨（近北界）
    ];
    for (const [lat, lng] of points) {
      const g = wgs84ToGcj02(lat, lng);
      expect(Math.abs(g.lat - lat)).toBeGreaterThan(0.0005);
      expect(Math.abs(g.lat - lat)).toBeLessThan(0.02);
      expect(Math.abs(g.lng - lng)).toBeGreaterThan(0.0005);
      expect(Math.abs(g.lng - lng)).toBeLessThan(0.02);
    }
  });

  it('境外点不偏移：原值返回（东京/纽约，spec §4「境外不偏移直接请求」）', () => {
    expect(wgs84ToGcj02(35.6895, 139.6917)).toEqual({ lat: 35.6895, lng: 139.6917 });
    expect(wgs84ToGcj02(40.7128, -74.006)).toEqual({ lat: 40.7128, lng: -74.006 });
  });

  it('中国区域矩形边界外紧邻点不偏移（北界 55.8271 / 西界 72.004 / 南界 0.8293 之外）', () => {
    expect(wgs84ToGcj02(55.9, 116.4)).toEqual({ lat: 55.9, lng: 116.4 });
    expect(wgs84ToGcj02(39.9, 71.9)).toEqual({ lat: 39.9, lng: 71.9 });
    expect(wgs84ToGcj02(0.5, 110.0)).toEqual({ lat: 0.5, lng: 110.0 });
  });

  it('outOfChina 边界矩形：界内 false、界外 true、边界值按界内（含港澳台按境内，见计划偏差 6）', () => {
    expect(outOfChina(39.9042, 116.4074)).toBe(false); // 北京
    expect(outOfChina(22.3193, 114.1694)).toBe(false); // 香港（矩形内 → 境内处理）
    expect(outOfChina(35.6895, 139.6917)).toBe(true); // 东京
    expect(outOfChina(40.7128, -74.006)).toBe(true); // 纽约
    expect(outOfChina(0.8293, 72.004)).toBe(false); // 边界值在界内
    expect(outOfChina(55.8271, 137.8347)).toBe(false);
    expect(outOfChina(0.8292, 72.004)).toBe(true); // 越出南界
    expect(outOfChina(55.8272, 137.8347)).toBe(true); // 越出北界
  });
});
