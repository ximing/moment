import { useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { isHttpUrl } from '../../lib/media-src';
import { useMediaUri } from '../../lib/use-media-uri';

/** 对齐 web 链封面 `h-[30vh]`，随窗口高度比例伸缩，不是一次性 px。 */
export function chainCoverHeight(windowHeight: number): number {
  return Math.round(windowHeight * 0.3);
}

/** 链首页大封面：签发 https 直出，否则 mediaId 走鉴权缓存。滚动时图片相对画框下移，形成滑走视差。 */
export function ChainCover({
  mediaId,
  src,
  height,
  fallbackColor,
  scrollY,
  onError,
}: {
  mediaId: string | null;
  src: string | null;
  height: number;
  fallbackColor: string;
  scrollY: Animated.Value;
  onError?: () => void;
}) {
  const signed = isHttpUrl(src) ? src : null;
  const fetched = useMediaUri(signed ? undefined : (mediaId ?? undefined));
  const uri = signed ?? fetched;
  const [failed, setFailed] = useState(false);

  const extra = Math.round(height * 0.25);
  const imageShift = scrollY.interpolate({
    inputRange: [0, height],
    outputRange: [0, extra],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.frame, { height, backgroundColor: fallbackColor }]} accessibilityElementsHidden>
      {uri && !failed ? (
        <Animated.View style={[styles.shift, { transform: [{ translateY: imageShift }] }]}>
          <Image
            source={{ uri }}
            resizeMode="cover"
            onError={() => {
              setFailed(true);
              onError?.();
            }}
            style={{ width: '100%', height: height + extra }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden' },
  shift: { width: '100%' },
});
