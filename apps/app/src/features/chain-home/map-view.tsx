import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle } from 'react-native-maps';
import type { AggregateResponse } from '@moment/dto';
import { formatMomentTime } from '../../lib/format';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// 足迹地图（travel 模板）：react-native-maps（Expo Go 内置，EAS autolinking）。
// iOS 默认 Apple Maps 零配置；Android 正式包需 Google Maps API key
// （app.config.ts 的 android.config.googleMaps.apiKey，发布前配置，见 DoD 风险声明）。
// 点位用 Circle 不用 Marker——Marker 的 callout 样式定制成本高，Circle 满足足迹场景。
// 聚合投影无 happenedTzOffset，弹层时间用查看者本地偏移（继承 P4 决策 7）。
// 地图嵌在链主页聚合段的 ScrollView 内：固定高容器 + Android 手势竞争需手动验收（DoD 清单第 9 项）。

export function FootprintMap({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (aggregate.points.length === 0) {
    return <Text style={styles.empty}>还没有足迹，发时刻时添加位置。</Text>;
  }
  const first = aggregate.points[0]!;
  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: first.lat,
          longitude: first.lng,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
      >
        {aggregate.points.map((p) => (
          <Circle
            key={p.momentId}
            center={{ latitude: p.lat, longitude: p.lng }}
            radius={300}
            fillColor={t.action}
            strokeColor={t.action}
          />
        ))}
      </MapView>
      <View style={styles.list}>
        {aggregate.points.map((p) => (
          <Text key={p.momentId} style={styles.item}>
            📍 {p.placeName ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`} · {formatMomentTime(p.happenedAt, new Date().getTimezoneOffset())}
          </Text>
        ))}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { padding: t.space4, gap: t.space2 },
    // 320pt 是组件视口尺寸（非布局间距档位），同 web 端 h-80 先例（P4 S9）
    map: { height: 320, borderRadius: t.radiusMd },
    list: { gap: t.space1 },
    item: { fontSize: t.fontSupport, color: t.ink },
    empty: { color: t.muted, fontSize: t.fontSupport, textAlign: 'center', padding: t.space8 },
  });
