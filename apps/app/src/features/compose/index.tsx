import { useEffect, useMemo } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { Button } from '../../components/Button';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ComposeService } from './compose.service';

const ComposeContent = observer(function ComposeContent() {
  const params = useLocalSearchParams<{ chainId?: string; momentId?: string }>();
  const service = useService(ComposeService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(params.chainId, params.momentId);
  }, [service, params.chainId, params.momentId]);

  async function onPickImages(): Promise<void> {
    try {
      const rejected = await service.pickMoreImages();
      if (rejected > 0) {
        Alert.alert('提示', `${rejected} 张图片压缩后仍超限，已跳过`);
      }
    } catch (err) {
      // Service 前置校验（满 9 张等 Error 中文 message）直接展示
      Alert.alert('提示', err instanceof Error ? err.message : '网络错误，请重试');
    }
  }

  async function onPickVideo(): Promise<void> {
    const problem = await service.chooseVideo().catch(() => null);
    if (problem) Alert.alert('无法上传', problem);
  }

  async function onSubmit(): Promise<void> {
    const isEdit = service.isEdit;
    try {
      await service.submit();
      Alert.alert(isEdit ? '已保存' : '已发布', isEdit ? '' : '可在时刻流中查看');
      router.back();
    } catch (err) {
      // 前置校验（Error 中文 message）直接展示；API 错误走 humanError
      Alert.alert(isEdit ? '保存失败' : '发布失败', err instanceof Error && !(err instanceof ApiError) ? err.message : humanError(err));
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
          ]}
          value={service.type}
          onChange={(t) => {
            service.type = t as typeof service.type;
            service.images = [];
            service.video = null;
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

      {service.isEdit && service.edit && service.edit.media.length > 0 ? <MediaGrid media={service.edit.media} /> : null}

      {!service.isEdit && service.type === 'media' ? (
        <View style={styles.mediaBar}>
          <Button variant="secondary" onPress={() => void onPickImages()}>选图（{service.images.length}/9）</Button>
          {service.images.length > 0 ? (
            <Button variant="quiet" onPress={() => (service.images = [])}>清空</Button>
          ) : null}
        </View>
      ) : null}
      {!service.isEdit && service.type === 'media' && service.images.length > 0 ? (
        <Text style={styles.mediaHint}>已压缩 {service.images.length} 张（最长边 ≤2048px），共 {Math.round(service.images.reduce((s, i) => s + i.size, 0) / 1024)}KB</Text>
      ) : null}

      {!service.isEdit && service.type === 'video' ? (
        <View style={styles.mediaBar}>
          <Button variant="secondary" onPress={() => void onPickVideo()}>{service.video ? '重选视频' : '选择视频'}</Button>
          {service.video ? (
            <Button variant="quiet" onPress={() => (service.video = null)}>移除</Button>
          ) : null}
        </View>
      ) : null}
      {!service.isEdit && service.type === 'video' && service.video ? (
        <Text style={styles.mediaHint}>
          {Math.round(service.video.size / 1024 / 1024)}MB · {Math.floor(service.video.durationSeconds / 60)}分{service.video.durationSeconds % 60}秒 · 分片上传可断点重试
        </Text>
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

      {service.tagNames.length > 0 ? (
        <View style={styles.chipRow}>
          {service.tagNames.map((t) => (
            <Pressable key={t.id} style={[styles.chip, service.tagIds.includes(t.id) && styles.chipActive]} onPress={() => service.toggleTag(t.id)}>
              <Text style={[styles.chipText, service.tagIds.includes(t.id) && styles.chipTextActive]}>#{t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

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
    content: { minHeight: 100, borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: t.space3, fontSize: t.fontBody, color: t.ink, textAlignVertical: 'top' },
    mediaBar: { flexDirection: 'row', gap: t.space3 },
    mediaHint: { color: t.muted, fontSize: t.fontCaption },
    dateBtn: { padding: t.space3, borderRadius: 8, backgroundColor: t.fieldBg },
    dateText: { fontSize: t.fontLabel, color: t.ink },
    progress: { color: t.action, textAlign: 'center' },
    centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space3, paddingVertical: 48 },
    errorText: { fontSize: t.fontLabel, color: t.muted },
  });
