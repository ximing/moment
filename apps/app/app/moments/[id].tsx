import { useState } from 'react';
import { Alert, Button, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REACTION_EMOJIS, type MomentMedia } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { formatMomentTime, formatRelative } from '../../src/lib/format';
import { Loading } from '../../src/components/Loading';
import { RequireAuth } from '../../src/components/RequireAuth';
import { useMediaUri } from '../../src/lib/use-media-uri';

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

function MomentDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const moment = useQuery({ queryKey: qk.moment(id), queryFn: () => client.getMoment(id) });
  // 评论分页：listComments 返回 CommentListResponse = { comments, nextCursor }（不是裸数组）；
  // 服务端默认每页仅 20 条，limit: 50 + 「加载更多」消费 nextCursor（与 Phase 6 web 版同构）
  const comments = useInfiniteQuery({
    queryKey: qk.comments(id),
    queryFn: ({ pageParam }) => client.listComments(id, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.moment(id) });
    void queryClient.invalidateQueries({ queryKey: qk.comments(id) });
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() });
  };

  const react = useMutation({
    mutationFn: (emoji: string | null) => (emoji === null ? client.removeReaction(id) : client.setReaction(id, emoji)),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误'),
  });

  const send = useMutation({
    mutationFn: (content: string) => client.createComment(id, content),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
    onError: (err) => Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误'),
  });

  const removeComment = useMutation({
    mutationFn: (commentId: string) => client.deleteComment(commentId),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误'),
  });

  if (moment.isPending) return <Loading />;
  if (moment.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.deleted}>该时刻可能已被删除（{moment.error instanceof ApiError ? moment.error.code : '加载失败'}）</Text>
      </View>
    );
  }

  const m = moment.data;
  // Phase 5 契约：ReactionSummary = { emoji, count } 无 mine 字段，「我的表情」在 MomentResponse.myReaction
  const myEmoji = m.myReaction;
  const commentList = comments.data?.pages.flatMap((p) => p.comments) ?? [];

  function onEmoji(emoji: string): void {
    react.mutate(myEmoji === emoji ? null : emoji);
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
              <Pressable
                key={emoji}
                style={[styles.reaction, active && styles.reactionActive]}
                onPress={() => onEmoji(emoji)}
              >
                <Text style={styles.reactionText}>
                  {emoji}
                  {summary && summary.count > 0 ? ` ${summary.count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>评论（{m.commentCount}）</Text>
        {commentList.map((c) => (
          <View key={c.id} style={styles.comment}>
            <View style={styles.commentHead}>
              <Text style={styles.commentAuthor}>{c.author.nickname}</Text>
              <Text style={styles.commentTime}>{formatRelative(c.createdAt)}</Text>
              <Pressable onPress={() => removeComment.mutate(c.id)}>
                <Text style={styles.commentDelete}>删除</Text>
              </Pressable>
            </View>
            <Text style={styles.commentBody}>{c.content}</Text>
          </View>
        ))}
        {commentList.length === 0 ? <Text style={styles.noComment}>还没有评论</Text> : null}
        {comments.hasNextPage ? (
          <Button
            title={comments.isFetchingNextPage ? '加载中…' : '加载更多评论'}
            onPress={() => void comments.fetchNextPage()}
          />
        ) : null}
        <View />
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="写评论…（1000 字内）"
          placeholderTextColor="#aaa"
          multiline
        />
        <Button
          title="发送"
          disabled={send.isPending || draft.trim().length === 0}
          onPress={() => send.mutate(draft.trim())}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

export default function MomentDetailScreen() {
  return (
    <RequireAuth>
      <MomentDetailInner />
    </RequireAuth>
  );
}

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
