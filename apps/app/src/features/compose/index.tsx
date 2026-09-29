import { useEffect, useMemo, useState } from 'react';
import { Image, InteractionManager, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { formatLocalDateTime } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { MediaGrid } from '../../components/MediaGrid';
import { AudioBar } from '../../components/AudioBar';
import { Button } from '../../components/Button';
import { Icon, type AppLineIconName } from '../../components/Icon';
import { CapsuleTextButton, OverlayNav } from '../../components/OverlayNav';
import { ActionSheet, ActionSheetItem } from '../../components/ActionSheet';
import { toast } from '../../components/feedback';
import { RequireAuth } from '../../components/RequireAuth';
import { UploadAngleMask } from '../../components/UploadAngleMask';
import type { MediaSource } from '../../lib/media';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ComposeService, editImageCap, editOccupied } from './compose.service';
import { TemplateFields } from './template-fields';
import { PersonPicker } from './person-picker';
import { VoiceRecorder } from './voice-recorder';

const TYPES: { value: 'text' | 'media' | 'video' | 'voice'; label: string; icon: AppLineIconName }[] = [
  { value: 'text', label: '文字', icon: 'type' },
  { value: 'media', label: '照片', icon: 'image' },
  { value: 'video', label: '视频', icon: 'video' },
  { value: 'voice', label: '语音', icon: 'mic' },
];

type Sheet = 'chain' | 'people' | 'tags' | null;
type MediaSheet = 'photo' | 'video' | null;

function ComposeNav({
  title,
  actionLabel,
  loading,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  loading?: boolean;
  onAction?: () => void;
}) {
  return (
    <OverlayNav
      title={title}
      right={
        onAction ? (
          <CapsuleTextButton label={actionLabel ?? ''} loading={loading} onPress={onAction} />
        ) : undefined
      }
    />
  );
}

const ComposeContent = observer(function ComposeContent() {
  const params = useLocalSearchParams<{ chainId?: string; momentId?: string }>();
  const service = useService(ComposeService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [mediaSheet, setMediaSheet] = useState<MediaSheet>(null);

  useEffect(() => {
    const chainId = Array.isArray(params.chainId) ? params.chainId[0] : params.chainId;
    const momentId = Array.isArray(params.momentId) ? params.momentId[0] : params.momentId;
    service.hydrate(chainId, momentId);
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

  async function onPickImages(source: MediaSource): Promise<void> {
    try {
      const rejected = await service.pickMoreImages(source);
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

  async function onPickVideo(source: MediaSource): Promise<void> {
    try {
      const problem = await service.chooseVideo(source);
      if (problem) toast.show({ key: 'compose-hint', message: problem });
    } catch (err) {
      toast.show({
        key: 'compose-hint',
        message: err instanceof Error ? err.message : '网络错误，请重试',
      });
    }
  }

  function pickFromSheet(source: MediaSource): void {
    const kind = mediaSheet;
    setMediaSheet(null);
    // 先收起动作表再唤起系统相册/相机，避免 Modal 叠在系统 UI 上（华为等机型尤其明显）
    InteractionManager.runAfterInteractions(() => {
      if (kind === 'video') void onPickVideo(source);
      else if (kind === 'photo') void onPickImages(source);
    });
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

  const title = service.isEdit ? '编辑' : '记下此刻';
  const actionLabel = service.progressLabel ?? (service.isEdit ? '保存' : '发布');
  const submitting = service.$model.submit.loading;

  // 编辑态加载/失败单通道（$model.loadForEdit）：404/410 给「已被删除」区别文案（spec §5）
  if (params.momentId && !service.edit) {
    if (service.$model.loadForEdit.loading) {
      return (
        <View style={styles.flex}>
          <Stack.Screen options={{ headerShown: false }} />
          <ComposeNav title={title} />
          <Loading />
        </View>
      );
    }
    const err = service.$model.loadForEdit.error;
    if (err) {
      const gone = err instanceof ApiError && (err.code === 'MOMENT_NOT_FOUND' || err.code === 'MOMENT_DELETED');
      return (
        <View style={styles.flex}>
          <Stack.Screen options={{ headerShown: false }} />
          <ComposeNav title={title} />
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{gone ? '该时刻可能已被删除' : humanError(err)}</Text>
            <Button variant="secondary" onPress={() => router.back()}>返回</Button>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <ComposeNav title={title} />
        <Loading />
      </View>
    );
  }

  const chainChoices = service.chainChoices;
  const activeChain = chainChoices.find((c) => c.id === service.activeChainId);
  const canPickChain = chainChoices.length > 1;
  const imageCap = service.isEdit && service.edit ? editImageCap(service.edit) : service.type === 'voice' ? 8 : 9;
  const occupied = service.isEdit ? editOccupied(service.keptMedia, service.images) : service.images.length;
  const canAddImage =
    (service.isEdit && service.edit && service.edit.type !== 'video') ||
    (!service.isEdit && (service.type === 'media' || service.type === 'voice'));
  const peopleSummary = service.selectedPersons.map((p) => p.name).join('、');
  const selectedTags = service.tagNames.filter((tag) => service.tagIds.includes(tag.id));
  const tagsSummary = selectedTags.map((tag) => `#${tag.name}`).join(' ');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <ComposeNav
        title={title}
        actionLabel={actionLabel}
        loading={submitting}
        onAction={() => void onSubmit()}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, t.space6) }]}
        keyboardShouldPersistTaps="handled"
      >
        {activeChain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${service.isEdit ? '换到' : '发布到'} ${activeChain.name}`}
            onPress={canPickChain && !service.mediaUploadActive ? () => setSheet('chain') : undefined}
            disabled={!canPickChain || service.mediaUploadActive}
            hitSlop={t.space2}
            style={styles.chainLine}
          >
            <Text style={styles.chainName} numberOfLines={1}>
              {activeChain.name}
            </Text>
            {canPickChain ? <Icon name="chevron-down" size={t.fontSupport} color={t.muted} /> : null}
          </Pressable>
        ) : null}

        {service.isEdit ? null : (
          <View style={styles.seg}>
            {TYPES.map((item) => {
              const active = service.type === item.value;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  disabled={service.mediaUploadActive}
                  onPress={() => {
                    if (service.mediaUploadActive) return;
                    service.type = item.value;
                    service.images = [];
                    service.clearVideo();
                    service.clearVoice();
                  }}
                  style={[styles.segItem, active && styles.segItemActive]}
                >
                  <Icon name={item.icon} size={t.fontSupport} color={active ? t.ink : t.muted} />
                  <Text style={[styles.segLabel, active && styles.segLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <TextInput
          style={styles.content}
          value={service.content}
          onChangeText={(v) => (service.content = v)}
          placeholder={service.type === 'text' ? '这一刻…' : '配一句（可选）'}
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
          <MediaGrid media={service.edit.media} />
        ) : null}

        {canAddImage && occupied > 0 ? (
          <View style={styles.grid}>
            {service.images.map((img, i) => {
              const ratio = service.imageProgress[i];
              return (
                <View key={`${img.uri}-${i}`} style={styles.cellWrap}>
                  <View style={styles.localFrame}>
                    <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    {ratio != null && ratio < 1 ? <UploadAngleMask progress={ratio} /> : null}
                  </View>
                  {service.mediaUploadActive ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="移除这张图片"
                      hitSlop={t.space3}
                      onPress={() => service.removeImage(i)}
                      style={styles.removeBtn}
                    >
                      <Text style={styles.removeBtnText}>×</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            {occupied < imageCap ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加照片"
                disabled={service.mediaUploadActive}
                onPress={() => {
                  if (!service.mediaUploadActive) setMediaSheet('photo');
                }}
                style={[styles.addCell, service.mediaUploadActive && styles.dimmed]}
              >
                <Icon name="plus" size={t.fontInput} color={t.muted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {canAddImage && occupied === 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加照片"
            disabled={service.mediaUploadActive}
            onPress={() => {
              if (!service.mediaUploadActive) setMediaSheet('photo');
            }}
            style={[styles.addCellWide, service.mediaUploadActive && styles.dimmed]}
          >
            <Icon name="image" size={t.fontLabel} color={t.muted} />
            <Text style={styles.addCellWideText}>添加照片</Text>
          </Pressable>
        ) : null}

        {!service.isEdit && service.type === 'video' ? (
          <View style={styles.videoItem}>
            {service.videoProgress != null && service.videoProgress > 0 ? (
              <View
                pointerEvents="none"
                style={[styles.videoFill, { width: `${Math.min(100, Math.round(service.videoProgress * 100))}%` }]}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={service.video ? '重选视频' : '选择视频'}
              disabled={service.mediaUploadActive}
              onPress={() => {
                if (!service.mediaUploadActive) setMediaSheet('video');
              }}
              style={styles.videoRow}
            >
              <Icon name="video" size={t.fontLabel} color={service.videoProgress != null ? t.ink : t.muted} />
              <Text style={[styles.addCellWideText, service.videoProgress != null && styles.videoTextActive]}>
                {service.video
                  ? `${Math.round(service.video.size / 1024 / 1024)}MB · ${Math.floor(service.video.durationSeconds / 60)}分${service.video.durationSeconds % 60}秒`
                  : '选择视频'}
              </Text>
              {service.videoProgress != null ? (
                <Text
                  style={styles.videoPct}
                  accessibilityRole="progressbar"
                  accessibilityLabel="视频上传进度"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(service.videoProgress * 100) }}
                >
                  {Math.round(service.videoProgress * 100)}%
                </Text>
              ) : null}
              {service.video && !service.mediaUploadActive ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="移除视频"
                  onPress={() => service.clearVideo()}
                  hitSlop={t.space2}
                >
                  <Text style={styles.removeLink}>移除</Text>
                </Pressable>
              ) : null}
            </Pressable>
          </View>
        ) : null}

        {!service.isEdit && service.type === 'voice' ? (
          <VoiceRecorder
            voice={service.voice}
            uploadProgress={service.audioProgress}
            onChange={(v) => service.setVoice(v)}
          />
        ) : null}

        <View style={styles.metaList}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发生时间"
            style={styles.metaRow}
            onPress={() => (service.showPicker = true)}
          >
            <Icon name="calendar" size={t.fontSupport} />
            <Text style={styles.metaLabel}>时间</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {formatLocalDateTime(service.happenedAt)}
              {service.isBackfill ? ' · 补发' : ''}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="和谁在一起"
            style={styles.metaRow}
            onPress={() => setSheet('people')}
          >
            <Icon name="user" size={t.fontSupport} />
            <Text style={styles.metaLabel}>和谁</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {peopleSummary || '添加'}
            </Text>
          </Pressable>
          <View style={styles.metaRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="使用当前位置"
              onPress={() => {
                void service.prefillDevicePlace({ force: true }).then((msg) => {
                  if (msg) toast.show({ key: 'compose-hint', message: msg });
                });
              }}
              hitSlop={t.space2}
            >
              <Icon name="map-pin" size={t.fontSupport} color={service.placeBusy ? t.action : t.ink} />
            </Pressable>
            <TextInput
              accessibilityLabel="在哪里"
              style={styles.metaInput}
              value={service.placeName}
              onChangeText={(v) => service.setPlaceName(v)}
              placeholder={service.placeBusy ? '定位中…' : '在哪里'}
              placeholderTextColor={t.muted}
            />
          </View>
          {service.placeCoords ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="移除位置"
              style={styles.metaRow}
              onPress={() => service.removePlaceCoords()}
            >
              <Text style={styles.metaHint}>
                {service.placeFromDevice ? '已定位当前位置' : '已从照片读取位置'}
              </Text>
              <Text style={styles.removeLink}>移除</Text>
            </Pressable>
          ) : null}
          {service.tagNames.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="标签"
              style={styles.metaRow}
              onPress={() => setSheet('tags')}
            >
              <Text style={styles.hash}>#</Text>
              <Text style={styles.metaLabel}>标签</Text>
              <Text style={styles.metaValue} numberOfLines={1}>
                {tagsSummary || '添加'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <TemplateFields service={service} edit={service.isEdit} />
      </ScrollView>

      {service.showPicker ? (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="slide" onRequestClose={() => (service.showPicker = false)}>
            <View style={styles.scrim}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => (service.showPicker = false)} accessibilityLabel="关闭" />
              <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, t.space4) }]}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>发生时间</Text>
                <DateTimePicker
                  value={service.happenedAt}
                  mode="datetime"
                  display="spinner"
                  onChange={(_e, d) => {
                    if (d) service.onHappenedAtChange(d);
                  }}
                />
                <Button variant="quiet" onPress={() => (service.showPicker = false)}>
                  完成
                </Button>
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={service.happenedAt}
            mode="datetime"
            display="default"
            onChange={(_e, d) => {
              service.showPicker = false;
              if (d) service.onHappenedAtChange(d);
            }}
          />
        )
      ) : null}

      <ActionSheet
        visible={mediaSheet !== null}
        title={mediaSheet === 'video' ? '添加视频' : '添加照片'}
        onClose={() => setMediaSheet(null)}
      >
        <ActionSheetItem label="从相册选择" onPress={() => pickFromSheet('library')} />
        <ActionSheetItem
          label={mediaSheet === 'video' ? '拍摄' : '拍照'}
          onPress={() => pickFromSheet('camera')}
        />
      </ActionSheet>

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(null)} accessibilityLabel="关闭" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, t.space4) }]}>
            <View style={styles.handle} />
            {sheet === 'chain' ? (
              <>
                <Text style={styles.sheetTitle}>{service.isEdit ? '换一条链' : '发布到'}</Text>
                {service.isEdit ? (
                  <Text style={styles.sheetHint}>
                    换链后标签和人物会清空。模板不同时，结构化内容也会清掉。评论还留在这条时刻上。
                  </Text>
                ) : null}
                {chainChoices.map((c) => {
                  const active = service.activeChainId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      onPress={() => {
                        service.setChain(c.id);
                        setSheet(null);
                      }}
                      style={[styles.sheetItem, active && styles.sheetItemActive]}
                    >
                      <Text style={[styles.sheetItemText, active && styles.sheetItemTextActive]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      {active ? <Icon name="check" size={t.fontInput} color={t.ink} /> : null}
                    </Pressable>
                  );
                })}
              </>
            ) : null}
            {sheet === 'people' ? (
              <>
                <Text style={styles.sheetTitle}>和谁在一起</Text>
                <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
                  <PersonPicker service={service} />
                </ScrollView>
              </>
            ) : null}
            {sheet === 'tags' ? (
              <>
                <Text style={styles.sheetTitle}>标签</Text>
                <View style={styles.chipRow}>
                  {service.tagNames.map((tag) => (
                    <Pressable
                      key={tag.id}
                      style={[styles.chip, service.tagIds.includes(tag.id) && styles.chipActive]}
                      onPress={() => service.toggleTag(tag.id)}
                    >
                      <Text style={[styles.chipText, service.tagIds.includes(tag.id) && styles.chipTextActive]}>
                        #{tag.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
    flex: { flex: 1, backgroundColor: t.bg },
    scroll: { paddingHorizontal: t.space4, paddingTop: t.space2, gap: t.space3 },
    chainLine: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: t.space1,
    },
    chainName: { fontSize: t.fontSupport, color: t.muted },
    seg: {
      flexDirection: 'row',
      backgroundColor: t.fieldBg,
      borderRadius: t.fieldRadius,
      padding: t.space1,
    },
    segItem: {
      flex: 1,
      minHeight: t.controlH,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space1,
      borderRadius: t.buttonRadius,
    },
    segItemActive: { backgroundColor: t.surface },
    segLabel: { fontSize: t.fontCaption, color: t.muted },
    segLabelActive: { color: t.ink, fontWeight: '600' },
    content: {
      minHeight: t.space8 * 2,
      fontSize: t.fontInput,
      lineHeight: 24,
      color: t.ink,
      textAlignVertical: 'top',
      padding: 0,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space1 },
    cellWrap: { width: '32%', aspectRatio: 1 },
    localFrame: {
      width: '100%',
      height: '100%',
      borderRadius: t.buttonRadius,
      overflow: 'hidden',
      backgroundColor: t.feedbackSkeleton,
    },
    addCell: {
      width: '32%',
      aspectRatio: 1,
      borderRadius: t.buttonRadius,
      backgroundColor: t.fieldBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addCellWide: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      minHeight: t.controlH,
      paddingHorizontal: t.space3,
      borderRadius: t.fieldRadius,
      backgroundColor: t.fieldBg,
    },
    addCellWideText: { flex: 1, minWidth: 0, fontSize: t.fontSupport, color: t.muted },
    dimmed: { opacity: t.disabledOpacity },
    videoItem: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: t.fieldRadius,
      backgroundColor: t.fieldBg,
    },
    videoFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: t.select,
    },
    videoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      minHeight: t.controlH,
      paddingHorizontal: t.space3,
    },
    videoTextActive: { color: t.ink },
    videoPct: { fontSize: t.fontCaption, fontWeight: '600', color: t.ink, fontVariant: ['tabular-nums'] },
    removeLink: { fontSize: t.fontSupport, color: t.muted },
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
    metaList: { gap: 0 },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      minHeight: t.touchMin,
    },
    metaLabel: { fontSize: t.fontSupport, color: t.muted, width: t.space8 + t.space2 },
    metaValue: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: t.fontSupport, color: t.ink },
    metaInput: { flex: 1, minWidth: 0, fontSize: t.fontSupport, color: t.ink, padding: 0 },
    metaHint: { flex: 1, minWidth: 0, fontSize: t.fontCaption, color: t.muted },
    hash: { width: t.fontSupport, textAlign: 'center', fontSize: t.fontSupport, color: t.muted, fontWeight: '600' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    chip: {
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
      minHeight: t.touchMin,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.muted },
    chipTextActive: { color: t.bg, fontWeight: '600' },
    centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space3, paddingVertical: t.space8 + t.space4 },
    errorText: { fontSize: t.fontLabel, color: t.muted },
    scrim: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radiusLg,
      borderTopRightRadius: t.radiusLg,
      paddingTop: t.space3,
      paddingHorizontal: t.space4,
      maxHeight: '80%',
    },
    handle: {
      alignSelf: 'center',
      width: t.space8,
      height: t.space1,
      borderRadius: t.space1,
      backgroundColor: t.line,
      marginBottom: t.space3,
    },
    sheetTitle: { fontSize: t.fontLabel, color: t.muted, marginBottom: t.space3 },
    sheetHint: { fontSize: t.fontSupport, color: t.muted, marginBottom: t.space3 },
    sheetScroll: { maxHeight: 420 },
    sheetItem: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: t.touchMin,
      marginBottom: t.space2,
      paddingHorizontal: t.space3,
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
      gap: t.space2,
    },
    sheetItemActive: { backgroundColor: t.secondaryBg },
    sheetItemText: { flex: 1, minWidth: 0, fontSize: t.fontBody, color: t.ink },
    sheetItemTextActive: { fontWeight: '600' },
  });
