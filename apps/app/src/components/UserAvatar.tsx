import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/use-theme';

/** 用户头像：有 URL 用图，否则昵称首字。 */
export function UserAvatar({
  url,
  name,
  size,
}: {
  url: string | null;
  name: string;
  size: number;
}) {
  const t = useTheme();
  const radius = size / 2;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.fieldBg }}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: t.secondaryBg,
        },
      ]}
    >
      <Text style={{ fontSize: Math.round(size * 0.4), color: t.muted, fontWeight: '600' }}>
        {name.slice(0, 1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
