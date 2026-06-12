import { useEffect } from 'react';
import { Alert, Button, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { REACTION_EMOJIS, type MomentMedia } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { formatMomentTime, formatRelative } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { useMediaUri } from '../../lib/use-media-uri';
import { MomentPageService } from './moment.service';

function MomentImage({ media }: { media: MomentMedia }) {
  const uri = useMediaUri(media.id);
  if (!uri) return <View style={styles.image} />;
  return <Image source={{ uri }} style={styles.image} resizeMode="contain" />;
}

function ReadyVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} contentFit="contain" style={styles.video} allowsFullscreen />;
}

function VideoBlock({ media }: { media: MomentMedia }) {
  const uri = useMediaUri(media.id);
  if (!uri) return <View style={styles.video} />;
  return <ReadyVideo uri={uri} />;
}

const MomentContent = observer(function MomentContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = useService(MomentPageService);

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

  function onEmoji(emoji: string): void {
    void service
      .setReaction(myEmoji === emoji ? null : emoji)
      .catch((err) => onError(err, '操作失败'));
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
        {m.content.length > 0 ? <Text style={styles.content}>{m.content}</Text> : null}
        {m.media.map((media) =>
          media.mime.startsWith('video/') ? (
            <VideoBlock key={media.id} media={media} />
          ) : (
            <MomentImage key={media.id} media={media} />
          )
        )}
        {m.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {m.tags.map((t) => (
              <Text key={t.id} style={styles.tag}>#{t.name}</Text>
            ))}
          </View>
        ) : null}

        <View style={styles.reactionRow}>
          {REACTION_EMOJIS.map((emoji) => {
            const summary = m.reactions.find((r) => r.emoji === emoji);
            const active = myEmoji === emoji;
            return (
              <Pressable key={emoji} style={[styles.reaction, active && styles.reactionActive]} onPress={() => onEmoji(emoji)}>
                <Text style={styles.reactionText}>
                  {emoji}
                  {summary && summary.count > 0 ? ` ${summary.count}` : ''}
                </Text>
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
            title={service.$model.loadMoreComments.loading ? '加载中…' : '加载更多评论'}
            onPress={() => void service.loadMoreComments().catch((err) => onError(err, '加载失败'))}
          />
        ) : null}
        <View />
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={service.draft}
          onChangeText={(v) => (service.draft = v)}
          placeholder="写评论…（1000 字内）"
          placeholderTextColor="#aaa"
          multiline
        />
        <Button
          title="发送"
          disabled={service.$model.submitComment.loading || service.draft.trim().length === 0}
          onPress={() => void service.submitComment().catch((err) => onError(err, '发送失败'))}
        />
      </View>
    </KeyboardAvoidingView>
  );
});

export const MomentPage = bindServices(MomentContent, [MomentPageService]);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  deleted: { color: '#999' },
  body: { padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { fontWeight: '600', fontSize: 16 },
  time: { color: '#999', fontSize: 12 },
  content: { fontSize: 16, lineHeight: 24 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: '#eee' },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#000' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { color: '#4a90d9', fontSize: 13 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reaction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f2f2f2' },
  reactionActive: { backgroundColor: '#dcebff' },
  reactionText: { fontSize: 14 },
  sectionTitle: { fontWeight: '600', fontSize: 15, marginTop: 8 },
  comment: { backgroundColor: '#fafafa', borderRadius: 8, padding: 10 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAuthor: { fontWeight: '600', fontSize: 13 },
  commentTime: { color: '#999', fontSize: 12, flex: 1 },
  commentDelete: { color: '#d33', fontSize: 12 },
  commentBody: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  noComment: { color: '#999', fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, maxHeight: 100 },
});
