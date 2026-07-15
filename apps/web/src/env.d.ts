/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** 地图栅格 tile URL（含 {z}/{x}/{y} 占位）；缺省用 OSM 公共 tile */
  readonly VITE_MAP_TILE_URL?: string;
}
