import { useEffect, useMemo } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useLocalSearchParams, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { REACTION_EMOJIS, type MomentMedia } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { formatMomentTime, formatRelative } from '../../lib/format';
import { AppIcon } from '../../components/AppIcon';
import { AudioBar } from '../../components/AudioBar';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/Button';
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

const MomentContent = observer(function MomentContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = useService(MomentPageService);
  const auth = useService(AuthService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(id);
  }, [service, id]);

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  if (!service.moment && service.$model.loadMoment.loading) return <Loading />;
  if (service.deleted || (!service.moment && service.$model.loadMoment.error)) {
    return (
      <View style={styles.center}>
        <Text style={styles.deleted}>该时刻可能已被删除</Text>
      </View>
    );
  }
  if (!service.moment) return <Loading />;

  const m = service.moment;
  const myEmoji = m.myReaction; // ReactionSummary = { emoji, count } 无 mine；我的表情在 myReaction
  const isAuthor = auth.user?.id === m.author.id; // spec §4.1：编辑/删除入口仅作者本人可见
  const isVoice = m.type === 'voice';
  const audioMedia = isVoice ? m.media.filter((media) => media.mime.startsWith('audio/')) : [];
  const visualMedia = m.media.filter((media) =>
    isVoice ? media.mime.startsWith('image/') : media.mime.startsWith('image/') || media.mime.startsWith('video/')
  );

  function onEmoji(emoji: string): void {
    void service
      .setReaction(myEmoji === emoji ? null : emoji)
      .catch((err) => onError(err, '操作失败'));
  }

  function onDelete(): void {
    Alert.alert('删除这条时刻？', '删除后不可恢复', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void service
            .deleteMoment()
            .then(() => router.back()) // 刚删的是本页目标，回退比停留占位更顺（spec §3）
            .catch((err) => onError(err, '删除失败'));
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Text style={styles.author}>{m.author.nickname}</Text>
          <Text style={styles.time}>
            {formatMomentTime(m.happenedAt, m.happenedTzOffset)}
            {m.isBackfill ? ' · 补发' : ''} · 发布于 {formatRelative(m.createdAt)}
          </Text>
        </View>
        {isAuthor ? (
          <View style={styles.actionRow}>
            <Pressable onPress={() => router.push({ pathname: '/compose', params: { momentId: m.id } })}>
              <Text style={styles.actionEdit}>编辑</Text>
            </Pressable>
            <Pressable onPress={onDelete}>
              <Text style={styles.actionDelete}>删除</Text>
            </Pressable>
          </View>
        ) : null}
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
            {m.tags.map((t) => (
              <Text key={t.id} style={styles.tag}>#{t.name}</Text>
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
        {m.place?.name ? <Text style={styles.placeLine}>📍 {m.place.name}</Text> : null}

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

        <Text style={styles.sectionTitle}>评论（{m.commentCount}）</Text>
        {service.comments.map((c) => (
          <View key={c.id} style={styles.comment}>
            <View style={styles.commentHead}>
              <Text style={styles.commentAuthor}>{c.author.nickname}</Text>
              <Text style={styles.commentTime}>{formatRelative(c.createdAt)}</Text>
              <Pressable
                onPress={() => void service.deleteComment(c.id).catch((err) => onError(err, '删除失败'))}
              >
                <Text style={styles.commentDelete}>删除</Text>
              </Pressable>
            </View>
            <Text style={styles.commentBody}>{c.content}</Text>
          </View>
        ))}
        {service.comments.length === 0 ? <Text style={styles.noComment}>还没有评论</Text> : null}
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
        <View />
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={service.draft}
          onChangeText={(v) => (service.draft = v)}
          placeholder="写评论…（1000 字内）"
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
    </KeyboardAvoidingView>
  );
});

export const MomentPage = bindServices(MomentContent, [MomentPageService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space8 },
    deleted: { color: t.muted },
    body: { padding: t.space4, gap: t.space3 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    author: { fontWeight: '600', fontSize: t.fontInput, color: t.ink },
    time: { color: t.muted, fontSize: t.fontCaption },
    actionRow: { flexDirection: 'row', gap: t.space4 },
    actionEdit: { color: t.action, fontSize: t.fontLabel },
    actionDelete: { color: t.danger, fontSize: t.fontLabel },
    transcribing: { color: t.muted, fontSize: t.fontCaption, marginTop: t.space1 },
    content: { fontSize: t.fontInput, lineHeight: 24, color: t.ink },
    image: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: t.feedbackSkeleton },
    video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: t.ink },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    tag: { color: t.tag, fontSize: t.fontSupport },
    personRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    personChip: { paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    personChipText: { fontSize: t.fontSupport, color: t.ink },
    personAi: { color: t.muted, fontSize: t.fontCaption },
    placeLine: { color: t.muted, fontSize: t.fontSupport },
    reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    reaction: { flexDirection: 'row', alignItems: 'center', gap: t.space1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: t.hoverSoft },
    reactionActive: { backgroundColor: t.select },
    reactionText: { fontSize: t.fontLabel, color: t.ink },
    reactionTextActive: { color: t.selectFg },
    sectionTitle: { fontWeight: '600', fontSize: t.fontBody, color: t.ink, marginTop: t.space2 },
    comment: { backgroundColor: t.surface, borderRadius: 8, padding: 10 },
    commentHead: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    commentAuthor: { fontWeight: '600', fontSize: t.fontSupport, color: t.ink },
    commentTime: { color: t.muted, fontSize: t.fontCaption, flex: 1 },
    commentDelete: { color: t.danger, fontSize: t.fontCaption },
    commentBody: { fontSize: t.fontLabel, marginTop: t.space1, lineHeight: 20, color: t.ink },
    noComment: { color: t.muted, fontSize: t.fontSupport },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: t.space2, padding: t.space3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
    input: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: 10, paddingTop: t.space2, paddingBottom: t.space2, maxHeight: 100, color: t.ink },
  });
