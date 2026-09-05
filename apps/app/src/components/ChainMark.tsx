import { Image, StyleSheet, Text, View } from 'react-native';
import type { ChainAppearanceColor } from '@moment/dto';
import { chainColorToken, resolveChainAppearanceColor } from '../lib/chain-color';
import { useTheme } from '../theme/use-theme';

/** 链身份标记：头像 > emoji > 色点。 */
export function ChainMark({
  chain,
  size,
}: {
  chain: {
    id: string;
    color: ChainAppearanceColor | null;
    icon: string | null;
    avatarUrl: string | null;
  };
  size: number;
}) {
  const t = useTheme();
  const fill = chainColorToken(t, resolveChainAppearanceColor(chain.id, chain.color));
  const radius = size / 2;
  if (chain.avatarUrl) {
    return (
      <Image
        source={{ uri: chain.avatarUrl }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.fieldBg }}
      />
    );
  }
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: radius, backgroundColor: fill },
      ]}
    >
      {chain.icon ? <Text style={{ fontSize: Math.round(size * 0.45) }}>{chain.icon}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { alignItems: 'center', justifyContent: 'center' },
});
