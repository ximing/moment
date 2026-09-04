import { useEffect, useMemo } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { SegmentBar } from '../../components/SegmentBar';
import { RequireAuth } from '../../components/RequireAuth';
import { Loading } from '../../components/Loading';
import { MediaGrid } from '../../components/MediaGrid';
import { AudioBar } from '../../components/AudioBar';
import { Button } from '../../components/Button';
import { toast } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ComposeService, editImageCap, editOccupied } from './compose.service';
import { TemplateFields } from './template-fields';
import { PersonPicker } from './person-picker';
import { VoiceRecorder } from './voice-recorder';

const ComposeContent = observer(function ComposeContent() {
  const params = useLocalSearchParams<{ chainId?: string; momentId?: string }>();
  const service = useService(ComposeService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(params.chainId, params.momentId);
  }, [service, params.chainId, params.momentId]);

  useEffect(() => {
    // activeChainId 经 observer 订阅 ChainListService：链列表就绪 / 用户切链时本 effect 重触发；
    // loadManifest 同链幂等（manifestChainId 占位），重复调用无副作用
    const active = service.activeChainId;
    if (active) void service.loadManifest(active).catch(() => undefined);
  }, [service, service.activeChainId]);

  useEffect(() => {
    // 镜像 P5 Task 4 (b)：activeChainId 经 observer 订阅 ChainListService，冷启动/深链时
    // 链列表未就绪 → hydrate 内 loadPersons 早退清空；本 effect 在链就绪后重触发补拉。
    // loadPersons 幂等（同链重复调用结果相同），与 hydrate/loadForEdit/setChain 内调用重复无害
    if (service.activeChainId) void service.loadPersons().catch(() => undefined);
  }, [service, service.activeChainId]);

  async function onPickImages(): Promise<void> {
    try {
      const rejected = await service.pickMoreImages();
      if (rejected > 0) {
        toast.show({ key: 'compose-hint', message: `${rejected} 张图片压缩后仍超限，已跳过` });
      }
    } catch (err) {
      // Service 前置校验（满 9 张等 Error 中文 message）直接展示
      toast.show({
        key: 'compose-hint',
        message: err instanceof Error ? err.message : '网络错误，请重试',
      });
    }
  }

  async function onPickVideo(): Promise<void> {
    const problem = await service.chooseVideo().catch(() => null);
    if (problem) toast.show({ key: 'compose-hint', message: problem });
  }

  async function onSubmit(): Promise<void> {
    const isEdit = service.isEdit;
    try {
      await service.submit();
      toast.show({
        key: 'compose',
        message: isEdit ? '已保存' : '已发布',
      });
      router.back();
    } catch (err) {
      toast.error(err, isEdit ? '保存失败' : '发布失败');
    }
  }

  // 编辑态加载/失败单通道（$model.loadForEdit）：404/410 给「已被删除」区别文案（spec §5）
  if (params.momentId && !service.edit) {
    if (service.$model.loadForEdit.loading) return <Loading />;
    const err = service.$model.loadForEdit.error;
    if (err) {
      const gone = err instanceof ApiError && (err.code === 'MOMENT_NOT_FOUND' || err.code === 'MOMENT_DELETED');
      return (
        <Screen>
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{gone ? '该时刻可能已被删除' : humanError(err)}</Text>
            <Button variant="secondary" onPress={() => router.back()}>返回</Button>
          </View>
        </Screen>
      );
    }
    return <Loading />;
  }

  return (
    <Screen scroll>
      {service.isEdit ? null : (
        <SegmentBar<string>
          options={[
            { value: 'text', label: '文字' },
            { value: 'media', label: '图文' },
            { value: 'video', label: '视频' },
            { value: 'voice', label: '语音' },
          ]}
          value={service.type}
          onChange={(t) => {
            service.type = t as typeof service.type;
            service.images = [];
            service.clearVideo();
            service.clearVoice();
          }}
        />
      )}

      {!service.isEdit && service.editableChains.length > 1 ? (
        <View style={styles.chipRow}>
          {service.editableChains.map((c) => (
            <Pressable key={c.id} style={[styles.chip, service.activeChainId === c.id && styles.chipActive]} onPress={() => service.setChain(c.id)}>
              <Text style={[styles.chipText, service.activeChainId === c.id && styles.chipTextActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.content}
        value={service.content}
        onChangeText={(v) => (service.content = v)}
        placeholder={service.type === 'text' ? '记录这一刻…' : '配文（可选）'}
        placeholderTextColor={t.muted}
        multiline
      />

      {service.isEdit && service.edit?.type === 'voice' && service.keptAudio ? (
        <AudioBar media={service.keptAudio} />
      ) : null}

      {service.isEdit && service.edit && service.edit.type !== 'video' ? (
        <MediaGrid media={service.keptMedia} onRemove={(id) => service.removeKeptMedia(id)} />
      ) : null}

      {service.isEdit && service.edit?.type === 'video' ? (
        <>
          <MediaGrid media={service.edit.media} />
          <Text style={styles.mediaHint}>视频发布后不能更换</Text>
        </>
      ) : null}

      {service.isEdit && service.edit && service.edit.type !== 'video' && service.images.length > 0 ? (
        <View style={styles.grid}>
          {service.images.map((img, i) => (
            <View key={`${img.uri}-${i}`} style={styles.cellWrap}>
              <Image source={{ uri: img.uri }} style={styles.localCell} resizeMode="cover" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="移除这张图片"
                hitSlop={t.space3}
                onPress={() => service.removeImage(i)}
                style={styles.removeBtn}
              >
                <Text style={styles.removeBtnText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {service.isEdit && service.edit && service.edit.type !== 'video' ? (
        <View style={styles.mediaBar}>
          <Button
            variant="secondary"
            disabled={editOccupied(service.keptMedia, service.images) >= editImageCap(service.edit)}
            onPress={() => void onPickImages()}
          >
            选图（{editOccupied(service.keptMedia, service.images)}/{editImageCap(service.edit)}）
          </Button>
          {service.images.length > 0 ? (
            <Button variant="quiet" onPress={() => service.clearImages()}>清空</Button>
          ) : null}
        </View>
      ) : null}

      {!service.isEdit && (service.type === 'media' || service.type === 'voice') ? (
        <View style={styles.mediaBar}>
          <Button variant="secondary" onPress={() => void onPickImages()}>
            选图（{service.images.length}/{service.type === 'voice' ? 8 : 9}）
          </Button>
          {service.images.length > 0 ? (
            <Button variant="quiet" onPress={() => service.clearImages()}>清空</Button>
          ) : null}
        </View>
      ) : null}
      {!service.isEdit && (service.type === 'media' || service.type === 'voice') && service.images.length > 0 ? (
        <Text style={styles.mediaHint}>已压缩 {service.images.length} 张（最长边 ≤2048px），共 {Math.round(service.images.reduce((s, i) => s + i.size, 0) / 1024)}KB</Text>
      ) : null}

      {!service.isEdit && service.type === 'video' ? (
        <View style={styles.mediaBar}>
          <Button variant="secondary" onPress={() => void onPickVideo()}>{service.video ? '重选视频' : '选择视频'}</Button>
          {service.video ? (
            <Button variant="quiet" onPress={() => service.clearVideo()}>移除</Button>
          ) : null}
        </View>
      ) : null}
      {!service.isEdit && service.type === 'video' && service.video ? (
        <Text style={styles.mediaHint}>
          {Math.round(service.video.size / 1024 / 1024)}MB · {Math.floor(service.video.durationSeconds / 60)}分{service.video.durationSeconds % 60}秒 · 分片上传可断点重试
        </Text>
      ) : null}

      {!service.isEdit && service.type === 'voice' ? (
        <VoiceRecorder voice={service.voice} onChange={(v) => service.setVoice(v)} />
      ) : null}

      <Pressable style={styles.dateBtn} onPress={() => (service.showPicker = true)}>
        <Text style={styles.dateText}>
          发生时间：{service.happenedAt.toLocaleString()}（{service.isBackfill ? '补发' : '当下'}）
        </Text>
      </Pressable>
      {service.showPicker ? (
        <DateTimePicker
          value={service.happenedAt}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => {
            service.showPicker = Platform.OS === 'ios';
            if (d) service.onHappenedAtChange(d);
          }}
        />
      ) : null}

      <TemplateFields service={service} edit={service.isEdit} />

      {service.tagNames.length > 0 ? (
        <View style={styles.chipRow}>
          {service.tagNames.map((t) => (
            <Pressable key={t.id} style={[styles.chip, service.tagIds.includes(t.id) && styles.chipActive]} onPress={() => service.toggleTag(t.id)}>
              <Text style={[styles.chipText, service.tagIds.includes(t.id) && styles.chipTextActive]}>#{t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <PersonPicker service={service} />

      {service.progressLabel ? <Text style={styles.progress}>{service.progressLabel}</Text> : null}
      <Button
        fullWidth
        loading={service.$model.submit.loading}
        loadingText="处理中…"
        onPress={() => void onSubmit()}
      >
        {service.isEdit ? '保存' : '发布'}
      </Button>
    </Screen>
  );
});

const ComposeBound = bindServices(ComposeContent, [ComposeService]);

export function ComposePage() {
  return (
    <RequireAuth>
      <ComposeBound />
    </RequireAuth>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    // 选中态对齐 SegmentBar：ink 色面 + bg 文字（primary 只留给发布/保存）
    chip: { paddingHorizontal: t.space3, paddingVertical: 6, borderRadius: 16, backgroundColor: t.hoverSoft },
    chipActive: { backgroundColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.muted },
    chipTextActive: { color: t.bg },
    content: { minHeight: 100, borderWidth: 1, borderColor: t.line, borderRadius: t.fieldRadius, padding: t.space3, fontSize: t.fontBody, color: t.ink, textAlignVertical: 'top', backgroundColor: t.fieldBg },
    mediaBar: { flexDirection: 'row', gap: t.space3 },
    mediaHint: { color: t.muted, fontSize: t.fontCaption },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space1, marginTop: t.space2 },
    cellWrap: { width: '32%', aspectRatio: 1 },
    localCell: { width: '100%', height: '100%', borderRadius: t.radiusMd, backgroundColor: t.feedbackSkeleton },
    removeBtn: {
      position: 'absolute',
      top: t.space1,
      right: t.space1,
      minWidth: t.space6,
      minHeight: t.space6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.ink,
      borderRadius: t.radiusMd,
    },
    removeBtnText: { color: t.bg, fontSize: t.fontCaption },
    dateBtn: { padding: t.space3, borderRadius: t.fieldRadius, backgroundColor: t.fieldBg },
    dateText: { fontSize: t.fontLabel, color: t.ink },
    progress: { color: t.action, textAlign: 'center' },
    centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space3, paddingVertical: t.space8 + t.space4 },
    errorText: { fontSize: t.fontLabel, color: t.muted },
  });
