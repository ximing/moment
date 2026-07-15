import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import type { AggregateResponse } from '@moment/dto';
import { formatHappenedClock } from '@/lib/time';
import { EmptyState } from '@/ui/feedback/index';

// 足迹地图（travel 模板）：leaflet + 栅格 tile。tile URL 走 VITE_MAP_TILE_URL，
// 缺省 OSM 公共 tile（自建/商用 tile 通过环境变量切换，见 .env.example）。
// 用 CircleMarker 不用默认 Marker——leaflet 默认图标资源在 Vite 下 404。

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function MapView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) {
  if (aggregate.points.length === 0) {
    return <EmptyState variant="plain" scope="section" title="还没有足迹" description="发时刻时添加位置，足迹会一个个落在这张地图上。" />;
  }
  const first = aggregate.points[0]!;
  return (
    <div className="overflow-hidden rounded-surface-md border border-line">
      {/* h-80 是组件视口尺寸（同 MediaBlock 的 max-h-40 先例），非布局间距，不受 4–32 档位约束 */}
      <MapContainer center={[first.lat, first.lng]} zoom={4} scrollWheelZoom className="h-80 w-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {aggregate.points.map((p) => (
          <CircleMarker
            key={p.momentId}
            center={[p.lat, p.lng]}
            radius={8}
            pathOptions={{ color: 'var(--action)', fillColor: 'var(--action)', fillOpacity: 0.7 }}
          >
            <Popup>
              {p.placeName && <strong>{p.placeName}<br /></strong>}
              {formatHappenedClock(p.happenedAt, new Date().getTimezoneOffset())}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
