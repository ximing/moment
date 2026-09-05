import { useEffect, useMemo, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { REACTION_EMOJIS, type MomentMedia } from '@moment/dto';
import { formatMomentTimeShort, formatRelative } from '../../lib/format';
import { AppIcon } from '../../components/AppIcon';
import { Icon } from '../../components/Icon';
import { AudioBar } from '../../components/AudioBar';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/Button';
import { UserAvatar } from '../../components/UserAvatar';
import { EmptyState, confirm, toast } from '../../components/feedback';
import { isHttpUrl, originalDisplayUrl } from '../../lib/media-src';
import { useMediaUri } from '../../lib/use-media-uri';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { MomentPageService } from './moment.service';

function MomentImage({ media }: { media: MomentMedia }) {
  // Lightbox 同构（spec §7.3）：详情大图/视频永远 original，即使行上 derivedUrl 非空
  const signed = originalDisplayUrl(media);
  const fetched = useMediaUri(isHttpUrl(signed) ? undefined : media.id);
  const uri = isHttpUrl(signed) ? signed : fetched;
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (!uri) return <View style={styles.image} />;
  return <Image source={{ uri }} style={styles.image} resizeMode="contain" />;
}

function ReadyVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return <VideoView player={player} contentFit="contain" style={styles.video} allowsFullscreen />;
}

function VideoBlock({ media }: { media: MomentMedia }) {
  // Lightbox 同构（spec §7.3）：详情大图/视频永远 original，即使行上 derivedUrl 非空
  const signed = originalDisplayUrl(media);
  const fetched = useMediaUri(isHttpUrl(signed) ? undefined : media.id);
  const uri = isHttpUrl(signed) ? signed : fetched;
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (!uri) return <View style={styles.video} />;
  return <ReadyVideo uri={uri} />;
}

function DetailNav({
  showMore,
  onMore,
}: {
  showMore?: boolean;
  onMore?: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingTop: insets.top }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回"
        onPress={() => router.back()}
        style={styles.backBtn}
      >
        <Icon name="chevron-left" size={t.fontInput} color={t.ink} />
        <Text style={styles.backText}>返回</Text>
      </Pressable>
      <View style={styles.navGrow} />
      {showMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="更多"
          onPress={onMore}
          style={styles.headerBtn}
        >
          <Icon name="ellipsis" size={t.fontInput} color={t.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

const MomentContent = observer(function MomentContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = useService(MomentPageService);
  const auth = useService(AuthService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const momentId = Array.isArray(id) ? id[0] : id;
    if (momentId) service.hydrate(momentId);
  }, [service, id]);

  function onError(err: unknown, action: string): void {
    toast.error(err, action);
  }

  const [moreOpen, setMoreOpen] = useState(false);

  if (!service.moment && service.$model.loadMoment.loading) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailNav />
        <Loading />
      </View>
    );
  }
  if (service.deleted || (!service.moment && service.$model.loadMoment.error)) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailNav />
        <View style={styles.center}>
          <EmptyState
            variant="plain"
            scope="page"
            title="该时刻可能已被删除"
            description="它不在这条时间线上了。"
            action={{ label: '返回', emphasis: 'quiet', onPress: () => router.back() }}
          />
        </View>
      </View>
    );
  }
  if (!service.moment) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailNav />
        <Loading />
      </View>
    );
  }

  const m = service.moment;
  const myEmoji = m.myReaction; // ReactionSummary = { emoji, count } 无 mine；我的表情在 myReaction
  const isAuthor = auth.user?.id === m.author.id; // spec §4.1：编辑/删除入口仅作者本人可见
  const isVoice = m.type === 'voice';
  const audioMedia = isVoice ? m.media.filter((media) => media.mime.startsWith('audio/')) : [];
  const visualMedia = m.media.filter((media) =>
    isVoice ? media.mime.startsWith('image/') : media.mime.startsWith('image/') || media.mime.startsWith('video/')
  );
  const timeBits = [
    formatMomentTimeShort(m.happenedAt, m.happenedTzOffset),
    m.isBackfill ? '补发' : null,
  ].filter(Boolean);

  function onEmoji(emoji: string): void {
    void service
      .setReaction(myEmoji === emoji ? null : emoji)
      .catch((err) => onError(err, '操作失败'));
  }

  function onDelete(): void {
    void confirm({
      title: '删除这条时刻？',
      body: '删除后不可恢复',
      confirmLabel: '删除',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void service
        .deleteMoment()
        .then(() => router.back()) // 刚删的是本页目标，回退比停留占位更顺（spec §3）
        .catch((err) => onError(err, '删除失败'));
    });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <DetailNav showMore={isAuthor} onMore={() => setMoreOpen(true)} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.authorRow}>
          <UserAvatar url={m.author.avatarUrl} name={m.author.nickname} size={t.controlH} />
          <View style={styles.authorText}>
            <Text style={styles.author}>{m.author.nickname}</Text>
            <Text style={styles.time}>{timeBits.join(' · ')}</Text>
          </View>
        </View>
        {isVoice && m.transcriptionStatus === 'pending' ? (
          <Text style={styles.transcribing}>转写中…</Text>
        ) : null}
        {m.content.length > 0 ? <Text style={styles.content}>{m.content}</Text> : null}
        {visualMedia.map((media) =>
          media.mime.startsWith('video/') ? (
            <VideoBlock key={media.id} media={media} />
          ) : media.mime.startsWith('image/') ? (
            <MomentImage key={media.id} media={media} />
          ) : null
        )}
        {audioMedia.map((media) => <AudioBar key={media.id} media={media} />)}
        {m.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {m.tags.map((tag) => (
              <Text key={tag.id} style={styles.tag}>#{tag.name}</Text>
            ))}
          </View>
        ) : null}
        {/* 人物与地点（spec people-place §7）：只读展示，不可点击（过滤属 M2）；
            name 为 null 的 exif 待回填坐标不显示地点行（P5 偏差 9 镜像） */}
        {m.persons.length > 0 ? (
          <View style={styles.personRow} accessibilityLabel="和谁在一起">
            {m.persons.map((p) => (
              <View key={p.id} style={styles.personChip}>
                <Text style={styles.personChipText}>
                  {p.name}
                  {p.source === 'ai' ? <Text style={styles.personAi}> AI</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {m.place?.name ? (
          <View style={styles.placeRow}>
            <Icon name="map-pin" size={t.fontSupport} />
            <Text style={styles.placeLine}>{m.place.name}</Text>
          </View>
        ) : null}

        <View style={styles.reactionRow}>
          {REACTION_EMOJIS.map((emoji) => {
            const summary = m.reactions.find((r) => r.emoji === emoji);
            const active = myEmoji === emoji;
            return (
              <Pressable key={emoji} style={[styles.reaction, active && styles.reactionActive]} onPress={() => onEmoji(emoji)}>
                {/* 数据值走 AppIcon：白名单 emoji 渲染 svg（P3-2）；值契约不变，onEmoji 仍回传 emoji 原文 */}
                <AppIcon value={emoji} size={t.fontLabel} />
                {summary && summary.count > 0 ? (
                  <Text style={[styles.reactionText, active && styles.reactionTextActive]}>{summary.count}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>评论 {m.commentCount > 0 ? m.commentCount : ''}</Text>
        {service.comments.map((c) => {
          const mine = auth.user?.id === c.author.id;
          return (
            <View key={c.id} style={styles.comment}>
              <UserAvatar url={c.author.avatarUrl} name={c.author.nickname} size={t.space8} />
              <View style={styles.commentBodyCol}>
                <View style={styles.commentHead}>
                  <Text style={styles.commentAuthor}>{c.author.nickname}</Text>
                  <Text style={styles.commentTime}>{formatRelative(c.createdAt)}</Text>
                  {mine ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="删除评论"
                      onPress={() =>
                        void confirm({
                          title: '删除这条评论？',
                          body: '删除后不可恢复',
                          confirmLabel: '删除',
                          danger: true,
                        }).then((ok) => {
                          if (!ok) return;
                          void service.deleteComment(c.id).catch((err) => onError(err, '删除失败'));
                        })
                      }
                    >
                      <Text style={styles.commentDelete}>删除</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.commentBody}>{c.content}</Text>
              </View>
            </View>
          );
        })}
        {service.comments.length === 0 ? (
          <EmptyState variant="plain" scope="section" title="还没有评论" description="写下第一句回应。" />
        ) : null}
        {service.hasMore ? (
          <Button
            variant="secondary"
            loading={service.$model.loadMoreComments.loading}
            loadingText="加载中…"
            onPress={() => void service.loadMoreComments().catch((err) => onError(err, '加载失败'))}
          >
            加载更多评论
          </Button>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.composer,
          { paddingBottom: t.space3 + (insets.bottom > 0 ? insets.bottom : t.space8) },
        ]}
      >
        <TextInput
          style={styles.input}
          value={service.draft}
          onChangeText={(v) => (service.draft = v)}
          placeholder="写评论…"
          placeholderTextColor={t.muted}
          multiline
        />
        <Button
          loading={service.$model.submitComment.loading}
          disabled={service.draft.trim().length === 0}
          onPress={() => void service.submitComment().catch((err) => onError(err, '发送失败'))}
        >
          发送
        </Button>
      </View>
      <Modal
        visible={moreOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMoreOpen(false)}
      >
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMoreOpen(false)} accessibilityLabel="关闭" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, t.space4) }]}>
            <View style={styles.handle} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="编辑"
              onPress={() => {
                setMoreOpen(false);
                router.push({ pathname: '/compose', params: { momentId: m.id } });
              }}
              style={styles.sheetItem}
            >
              <Text style={styles.sheetItemText}>编辑</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除"
              onPress={() => {
                setMoreOpen(false);
                onDelete();
              }}
              style={styles.sheetItem}
            >
              <Text style={styles.sheetDanger}>删除</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消"
              onPress={() => setMoreOpen(false)}
              style={styles.sheetCancel}
            >
              <Text style={styles.sheetCancelText}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
});

export const MomentPage = bindServices(MomentContent, [MomentPageService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space8 },
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: t.space2,
      paddingBottom: t.space1,
      backgroundColor: t.bg,
      minHeight: t.touchMin,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: t.touchMin,
      paddingHorizontal: t.space1,
      gap: t.space1,
    },
    backText: { fontSize: t.fontBody, color: t.ink },
    navGrow: { flex: 1 },
    headerBtn: { width: t.touchMin, height: t.touchMin, alignItems: 'center', justifyContent: 'center' },
    scrim: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radiusLg,
      borderTopRightRadius: t.radiusLg,
      paddingTop: t.space3,
      paddingHorizontal: t.space3,
    },
    handle: {
      alignSelf: 'center',
      width: t.space8,
      height: t.space1,
      borderRadius: t.space1,
      backgroundColor: t.line,
      marginBottom: t.space3,
    },
    sheetItem: {
      minHeight: t.touchMin,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
      marginBottom: t.space2,
    },
    sheetItemText: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    sheetDanger: { fontSize: t.fontBody, color: t.danger, fontWeight: '600' },
    sheetCancel: {
      minHeight: t.touchMin,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: t.space1,
    },
    sheetCancelText: { fontSize: t.fontBody, color: t.muted },
    body: { padding: t.space4, gap: t.space3 },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: t.space3 },
    authorText: { flex: 1, minWidth: 0, gap: t.space1 },
    author: { fontWeight: '600', fontSize: t.fontInput, color: t.ink },
    time: { color: t.muted, fontSize: t.fontCaption },
    transcribing: { color: t.muted, fontSize: t.fontCaption },
    content: { fontSize: t.fontInput, lineHeight: 24, color: t.ink },
    image: { width: '100%', aspectRatio: 4 / 3, borderRadius: t.radiusMd, backgroundColor: t.feedbackSkeleton },
    video: { width: '100%', aspectRatio: 16 / 9, borderRadius: t.radiusMd, backgroundColor: t.ink },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    tag: { color: t.tag, fontSize: t.fontSupport },
    personRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 },
    personChip: { paddingHorizontal: t.space2, paddingVertical: t.space1, borderRadius: t.buttonRadius, backgroundColor: t.hoverSoft },
    personChipText: { fontSize: t.fontCaption, color: t.muted },
    personAi: { color: t.muted, fontSize: t.fontCaption },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: t.space1 },
    placeLine: { color: t.muted, fontSize: t.fontSupport },
    reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    reaction: { flexDirection: 'row', alignItems: 'center', gap: t.space1, paddingHorizontal: t.space3, paddingVertical: t.space2, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    reactionActive: { backgroundColor: t.select },
    reactionText: { fontSize: t.fontLabel, color: t.ink },
    reactionTextActive: { color: t.selectFg },
    sectionTitle: { fontWeight: '600', fontSize: t.fontBody, color: t.ink, marginTop: t.space2 },
    comment: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space3 },
    commentBodyCol: { flex: 1, minWidth: 0 },
    commentHead: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    commentAuthor: { fontWeight: '600', fontSize: t.fontSupport, color: t.ink },
    commentTime: { color: t.muted, fontSize: t.fontCaption, flex: 1 },
    commentDelete: { color: t.muted, fontSize: t.fontCaption },
    commentBody: { fontSize: t.fontLabel, marginTop: t.space1, lineHeight: 20, color: t.ink },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: t.space2, paddingHorizontal: t.space3, paddingTop: t.space3, backgroundColor: t.bg },
    input: { flex: 1, borderRadius: t.fieldRadius, paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space2, maxHeight: 100, color: t.ink, backgroundColor: t.fieldBg },
  });
