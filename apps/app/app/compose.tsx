import { useMemo, useState } from 'react';
import { Alert, Button, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_IMAGE_BYTES, type MediaCompleteResponse, type MomentType } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../src/lib/api';
import { qk } from '../src/lib/keys';
import { Screen } from '../src/components/Screen';
import { SegmentBar } from '../src/components/SegmentBar';
import { RequireAuth } from '../src/components/RequireAuth';
import { compressImage, pickImages, pickVideo, validateVideo, type PickedVideo, type ReadyImage } from '../src/lib/media';

/** 总尝试次数 = 初始 1 次 + ≤2 次重试（与 Global Constraints「≤2 次重试」一致；网络类失败才重试）。
 *  服务端 complete 幂等，重试会重新 presign 拿新 mediaId，
 *  旧 mediaId 残留为 uploading 行由 Phase 8 sweeper 清理。 */
const UPLOAD_ATTEMPTS = 3;

async function uploadWithRetry(
  input: Parameters<typeof client.uploadMedia>[0]
): Promise<MediaCompleteResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await client.uploadMedia(input);
    } catch (err) {
      lastError = err;
      // 仅网络类（status 0）/服务端 5xx 重试：413 本地预校验、401（refresh 已失败并 clear 后的
      // 残余请求）、403（CHAIN_ROLE_INSUFFICIENT）等 4xx 重试无意义且可能重复打已清态请求
      if (err instanceof ApiError && err.status !== 0 && err.status < 500) throw err;
    }
  }
  throw lastError;
}

function ComposeInner() {
  const params = useLocalSearchParams<{ chainId?: string }>();
  const queryClient = useQueryClient();

  const chains = useQuery({ queryKey: qk.chains(), queryFn: () => client.listChains() });
  const editableChains = useMemo(() => (chains.data ?? []).filter((c) => c.myRole !== 'viewer'), [chains.data]);
  const [chainId, setChainId] = useState<string | undefined>(params.chainId ?? editableChains[0]?.id);
  const activeChainId = chainId ?? editableChains[0]?.id;

  const tags = useQuery({
    queryKey: qk.tags(activeChainId ?? ''),
    queryFn: () => client.listTags(activeChainId ?? ''),
    enabled: activeChainId != null,
  });

  const [type, setType] = useState<MomentType>('text');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<ReadyImage[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [happenedAt, setHappenedAt] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [isBackfill, setIsBackfill] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPickImages(): Promise<void> {
    const picked = await pickImages();
    if (picked.length === 0) return;
    const remain = 9 - images.length;
    if (remain <= 0) {
      Alert.alert('提示', '图片最多 9 张');
      return;
    }
    setProgressLabel('压缩中…');
    const ready: ReadyImage[] = [];
    let rejected = 0;
    for (const img of picked.slice(0, remain)) {
      const r = await compressImage(img);
      if (r.size > MAX_IMAGE_BYTES) {
        rejected += 1; // 压缩后仍超限的个别图片（极端长图）跳过；常量唯一来源 @moment/dto
        continue;
      }
      ready.push(r);
    }
    if (rejected > 0) Alert.alert('提示', `${rejected} 张图片压缩后仍超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已跳过`);
    setProgressLabel(null);
    setImages((prev) => [...prev, ...ready].slice(0, 9));
  }

  async function onPickVideo(): Promise<void> {
    const picked = await pickVideo();
    if (!picked) return;
    const problem = validateVideo(picked);
    if (problem) {
      Alert.alert('无法上传', problem);
      return;
    }
    setVideo(picked);
  }

  function toggleTag(id: string): void {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function onSubmit(): Promise<void> {
    if (!activeChainId) {
      Alert.alert('提示', '请选择要发布到的链（需要编辑权限）');
      return;
    }
    // 本地前置校验（与 dto createMomentInputSchema 的 superRefine 规则一致；最终约束在
    // client.createMoment 内部再经 dto schema.parse 兜底）：
    if (type === 'text' && content.trim().length === 0) {
      Alert.alert('提示', '文字类型需要内容');
      return;
    }
    if (content.length > 5000) {
      Alert.alert('提示', '正文最多 5000 字');
      return;
    }
    if (type === 'media' && images.length === 0) {
      Alert.alert('提示', '图文类型至少选 1 张图（最多 9 张）');
      return;
    }
    if (type === 'video' && !video) {
      Alert.alert('提示', '视频类型需要先选择视频');
      return;
    }

    setSubmitting(true);
    try {
      // 1) 上传媒体（分片串行 + 每片重试由 api-client uploadMedia 负责；此处聚合多文件总进度）
      //    图片走 file: Blob（压缩后百 KB 级，已在内存）；视频走 fileUri 形态——rnPut 按 part
      //    从文件 uri 读盘 PUT，500MB 视频整文件不进内存（否则真机 OOM，见 src/lib/rn-put.ts）。
      const mediaIds: string[] = [];
      type UploadFile =
        | { file: Blob; mime: string; size: number; kind: 'image'; sortOrder: number }
        | { fileUri: string; mime: string; size: number; kind: 'video'; durationSeconds: number; sortOrder: number };
      let files: UploadFile[] = [];
      if (type === 'media') {
        files = images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i }));
      } else if (type === 'video' && video) {
        files = [{ fileUri: video.uri, mime: video.mime, size: video.size, kind: 'video' as const, durationSeconds: video.durationSeconds, sortOrder: 0 }];
      }
      const totalBytes = files.reduce((s, f) => s + f.size, 0);
      let doneBytes = 0;
      for (const f of files) {
        const res = await uploadWithRetry({
          ...f,
          onProgress: (loaded) => {
            const overall = totalBytes > 0 ? Math.floor(((doneBytes + loaded) / totalBytes) * 100) : 100;
            setProgressLabel(`上传中 ${overall}%`);
          },
        });
        mediaIds.push(res.mediaId);
        doneBytes += f.size;
      }

      // 2) 发布 moment（client 内部经 dto schema 补默认值并做最终约束校验）
      setProgressLabel('发布中…');
      await client.createMoment(activeChainId, {
        type,
        content,
        happenedAt: happenedAt.toISOString(),
        // 与 dto 契约/Phase 6 currentTzOffset() 同语义：原值（同 JS getTimezoneOffset，东八区 = -480），不取反
        happenedTzOffset: happenedAt.getTimezoneOffset(),
        isBackfill,
        mediaIds,
        tagIds,
      });

      // 3) 失效相关查询（qk.feedAll() = ['feed'] 前缀，覆盖全部 feed 过滤组合）
      await queryClient.invalidateQueries({ queryKey: qk.feedAll() });
      await queryClient.invalidateQueries({ queryKey: qk.chainMoments(activeChainId) });
      await queryClient.invalidateQueries({ queryKey: qk.tags(activeChainId) });
      Alert.alert('已发布', '可在时刻流中查看');
      router.back();
    } catch (err) {
      Alert.alert(
        '发布失败',
        err instanceof ApiError
          ? `${err.message}（${err.code}）${err.code === 'NETWORK_ERROR' ? '，媒体已尝试断点重传，可重试' : ''}`
          : '网络错误，请重试'
      );
    } finally {
      setProgressLabel(null);
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <SegmentBar<MomentType>
        options={[
          { value: 'text', label: '文字' },
          { value: 'media', label: '图文' },
          { value: 'video', label: '视频' },
        ]}
        value={type}
        onChange={(t) => {
          setType(t);
          setImages([]);
          setVideo(null);
        }}
      />

      {editableChains.length > 1 ? (
        <View style={styles.chipRow}>
          {editableChains.map((c) => (
            <Pressable key={c.id} style={[styles.chip, activeChainId === c.id && styles.chipActive]} onPress={() => setChainId(c.id)}>
              <Text style={[styles.chipText, activeChainId === c.id && styles.chipTextActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.content}
        value={content}
        onChangeText={setContent}
        placeholder={type === 'text' ? '记录这一刻…' : '配文（可选）'}
        placeholderTextColor="#aaa"
        multiline
      />

      {type === 'media' ? (
        <View style={styles.mediaBar}>
          <Button title={`选图（${images.length}/9）`} onPress={() => void onPickImages()} />
          {images.length > 0 ? (
            <Button title="清空" color="#d33" onPress={() => setImages([])} />
          ) : null}
        </View>
      ) : null}
      {type === 'media' && images.length > 0 ? (
        <Text style={styles.mediaHint}>已压缩 {images.length} 张（最长边 ≤2048px），共 {Math.round(images.reduce((s, i) => s + i.size, 0) / 1024)}KB</Text>
      ) : null}

      {type === 'video' ? (
        <View style={styles.mediaBar}>
          <Button title={video ? '重选视频' : '选择视频'} onPress={() => void onPickVideo()} />
          {video ? (
            <Button title="移除" color="#d33" onPress={() => setVideo(null)} />
          ) : null}
        </View>
      ) : null}
      {type === 'video' && video ? (
        <Text style={styles.mediaHint}>
          {Math.round(video.size / 1024 / 1024)}MB · {Math.floor(video.durationSeconds / 60)}分{video.durationSeconds % 60}秒 · 分片上传可断点重试
        </Text>
      ) : null}

      <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)}>
        <Text style={styles.dateText}>
          发生时间：{happenedAt.toLocaleString()}（{isBackfill ? '补发' : '当下'}）
        </Text>
      </Pressable>
      {showPicker ? (
        <DateTimePicker
          value={happenedAt}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => {
            setShowPicker(Platform.OS === 'ios');
            if (d) {
              setHappenedAt(d);
              setIsBackfill(d.getTime() < Date.now() - 10 * 60_000);
            }
          }}
        />
      ) : null}

      {(tags.data?.tags.length ?? 0) > 0 ? (
        <View style={styles.chipRow}>
          {tags.data?.tags.map((t) => (
            <Pressable key={t.id} style={[styles.chip, tagIds.includes(t.id) && styles.chipActive]} onPress={() => toggleTag(t.id)}>
              <Text style={[styles.chipText, tagIds.includes(t.id) && styles.chipTextActive]}>#{t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {progressLabel ? <Text style={styles.progress}>{progressLabel}</Text> : null}
      <Button title={submitting ? '处理中…' : '发布'} onPress={() => void onSubmit()} disabled={submitting} />
    </Screen>
  );
}

export default function ComposeScreen() {
  return (
    <RequireAuth>
      <ComposeInner />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f2f2f2' },
  chipActive: { backgroundColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff' },
  content: { minHeight: 100, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  mediaBar: { flexDirection: 'row', gap: 12 },
  mediaHint: { color: '#888', fontSize: 12 },
  dateBtn: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2' },
  dateText: { fontSize: 14, color: '#333' },
  progress: { color: '#4a90d9', textAlign: 'center' },
});
