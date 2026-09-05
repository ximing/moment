import { useMemo } from 'react';
import { Image, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MomentMedia } from '@moment/dto';
import { CapsuleIconButton } from '../../components/OverlayNav';
import { toast } from '../../components/feedback';
import { isHttpUrl, originalDisplayUrl } from '../../lib/media-src';
import { shareImageFile } from '../../lib/share-file';
import { useMediaUri } from '../../lib/use-media-uri';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

export function MediaLightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: MomentMedia[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const media = items[index];
  const signed = media ? originalDisplayUrl(media) : null;
  const fetched = useMediaUri(isHttpUrl(signed) ? undefined : media?.id);
  const uri = isHttpUrl(signed) ? signed : fetched;

  function onDownload(): void {
    if (!uri || !media) return;
    void shareImageFile(uri, `moment-${media.id}.jpg`)
      .then(() => toast.show('选择保存到相册或文件'))
      .catch((err) => toast.error(err, '保存失败'));
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        {uri ? (
          <Image source={{ uri }} resizeMode="contain" style={styles.image} accessibilityLabel="原图" />
        ) : (
          <View style={styles.image} />
        )}
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + t.space2 }]}>
          <CapsuleIconButton name="x" label="关闭" tone="media" onPress={onClose} />
          <View style={styles.grow} />
          <CapsuleIconButton name="download" label="下载图片" tone="media" onPress={onDownload} />
        </View>
        {items.length > 1 ? (
          <>
            <View style={[styles.side, styles.sideLeft]}>
              <CapsuleIconButton
                name="chevron-left"
                label="上一张"
                tone="media"
                onPress={() => onIndex((index - 1 + items.length) % items.length)}
              />
            </View>
            <View style={[styles.side, styles.sideRight]}>
              <CapsuleIconButton
                name="chevron-right"
                label="下一张"
                tone="media"
                onPress={() => onIndex((index + 1) % items.length)}
              />
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: t.scheme === 'dark' ? t.bg : t.ink,
      justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    top: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: t.space3,
      paddingBottom: t.space2,
      gap: t.space2,
    },
    grow: { flex: 1 },
    side: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },
    sideLeft: { left: t.space3 },
    sideRight: { right: t.space3 },
  });
