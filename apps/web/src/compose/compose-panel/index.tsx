import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { bindServices, observer, useService } from '@rabjs/react';
import { Image as ImageIcon, Upload, Video as VideoIcon, X } from 'lucide-react';
import { ChainMark } from '@/chain/ChainMark';
import { ComposeSessionService } from '@/services/compose-session.service';
import { toWallClockInput, wallClockToIso } from '@/lib/time';
import { Button, IconButton } from '@/ui/button/index';
import { Banner, InlineProgress } from '@/ui/feedback/index';
import { DateTimeField, Input, TextareaField } from '@/ui/field/index';
import { AlertDialog, Sheet } from '@/ui/modal/index';
import { ComposePanelService, editImageCap, editOccupied } from './compose-panel.service';
import { VoiceRecorder } from './voice-recorder';
import { VideoPosterPicker } from './video-poster';
import { PersonPicker } from './person-picker';
import { TemplateFields } from '@/compose/template-fields';
import { AudioBar } from '@/media/AudioBar';
import { MediaBlock } from '@/media/MediaBlock';
import { cardDisplayUrl } from '@/lib/media-src';

// 发布面板 = Sheet（Modal 规范 §2：记下／编辑时刻）；内部表单复用 Field 家族
// （TextareaField / DateTimeField / Input）与 Button。关闭语义（Modal 规范 §9）：
// 仅当当前 service 状态相对 hydrate 基线 dirty 时，关闭（X / Escape / 外部点击 /
// 取消）先弹 AlertDialog「继续记录 / 放弃记录」；无草稿直接走既有
// service.resetAndClose()。媒体替换确认、上传进度 / 失败、提交后刷新行为不变。

export const ComposePanel = observer(function ComposePanel() {
  const composeSession = useService(ComposeSessionService);
  if (!composeSession.request) return null;
  return <ComposeBody />;
});

const ComposeBodyContent = observer(function ComposeBodyContent() {
  const service = useService(ComposePanelService);
  const composeSession = useService(ComposeSessionService);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const busy = service.$model.submit.loading;
  // 草稿确认是面板本地呈现状态（React state）：jsdom 下 RAB 属性变更不重渲，
  // 且它不是业务状态，不进 Service
  const [discardOpen, setDiscardOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const req = composeSession.request;
  // 渲染期水合：首帧就要按编辑/新建画，避免先闪「加图片」；jsdom 下 effect 也不触发 observer 重渲。
  // dirty 基线写在 service.hydrate → service.baseline，不写 fiber ref（StrictMode 重挂载会丢掉 ref、跳过 hydrate）。
  if (req && service.request !== req) {
    service.hydrate(req);
  }
  useEffect(() => {
    void service.loadTagList();
  }, [service, service.chainId]);
  useEffect(() => {
    void service.loadPersons(); // 失败静默（service 注释），选择器保持空列表不阻塞发布
  }, [service, service.chainId]);

  const edit = service.edit;
  const writable = service.writableChains;
  const chainId = service.chainId;
  // 老 Safari 无 MediaRecorder → 录音入口不渲染并提示（spec §5：置灰提示，不影响其他类型）
  const voiceSupported = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (chainId) void service.loadManifest(chainId).catch(() => undefined); // 失败静默（service 注释）
  }, [service, chainId]);

  if (!req) return null;

  const title = edit ? '改这条时刻' : '记下此刻';

  const addMediaFiles = (files: File[]): boolean => {
    if (files.length === 0) return false;
    if (edit) {
      if (edit.type === 'video') return false;
      const images = files.filter((file) => file.type.startsWith('image/'));
      const videos = files.filter((file) => file.type.startsWith('video/'));
      if (videos.length > 0) {
        service.error = '编辑时不能换成视频';
        return true;
      }
      if (images.length !== files.length) {
        service.error = '这里只能添加图片或视频';
        return true;
      }
      service.addImages(images);
      return true;
    }
    const images = files.filter((file) => file.type.startsWith('image/'));
    const videos = files.filter((file) => file.type.startsWith('video/'));
    if (images.length + videos.length !== files.length) {
      service.error = '这里只能添加图片或视频';
      return true;
    }
    if (images.length > 0 && videos.length > 0) {
      service.error = '图片和视频不能一起添加';
      return true;
    }
    if (videos.length > 1) {
      service.error = '一次只能添加一个视频';
      return true;
    }
    if (images.length > 0) service.onPickImages(images);
    else if (videos[0]) service.onPickVideo(videos[0]);
    return true;
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (busy || edit?.type === 'video') return;
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return; // 普通文字粘贴保持浏览器原行为
    event.preventDefault();
    addMediaFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (busy || edit?.type === 'video') return;
    addMediaFiles(Array.from(event.dataTransfer.files));
  };

  const requestClose = () => {
    if (service.isDirty()) setDiscardOpen(true);
    else service.resetAndClose();
  };

  return (
    <>
      <Sheet
        open
        title={title}
        context={!edit && writable.length === 1 ? `记到「${writable[0]!.name}」` : undefined}
        busy={busy}
        onRequestClose={requestClose}
        footer={
          <div className="flex w-full min-w-0 flex-col gap-3">
            {service.progress ? (
              service.progressValue == null ? (
                <InlineProgress variant="indeterminate" label={service.progress} />
              ) : (
                <InlineProgress
                  variant="determinate"
                  label={service.progress}
                  value={service.progressValue}
                />
              )
            ) : null}
            <div className="flex justify-end gap-overlay-action">
              <Button variant="quiet" disabled={busy} onClick={requestClose}>
                取消
              </Button>
              <Button loading={busy} onClick={() => void service.submit()}>
                {edit ? '保存' : '记下'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4" onPaste={handlePaste}>
          {!edit && writable.length > 1 && (
            <div className="grid grid-cols-2 gap-2">
              {writable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => service.pickChain(c.id)}
                  className={`flex items-center gap-2 rounded-surface-md border px-3 py-2 text-left text-sm transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
                    chainId === c.id
                      ? 'border-action bg-bg font-semibold text-ink'
                      : 'border-transparent bg-bg text-muted hover:text-ink'
                  }`}
                >
                  <ChainMark
                    chainId={c.id}
                    color={c.color}
                    icon={c.icon}
                    avatarMediaId={c.avatarMediaId}
                    avatarFocus={c.avatarFocus}
                    size={16}
                  />
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {service.needChainPick && <p className="text-meta text-muted">先选一条链</p>}

          <TextareaField
            label="这一刻"
            name="content"
            value={service.content}
            onChange={(v) => (service.content = v)}
            placeholder="这一刻…"
          />

          {edit?.type === 'video' && (
            <div className="flex flex-col gap-3">
              <MediaBlock media={edit.media} />
              <p className="text-meta text-muted">视频发布后不能更换</p>
            </div>
          )}

          {edit?.type !== 'video' && (
            <div
              role="region"
              aria-label="添加图片或视频"
              className={`flex flex-col gap-3 rounded-surface-md border border-dashed px-3 py-3 transition-colors duration-[var(--ease)] ${
                dragActive ? 'border-action bg-floating-hover' : 'border-line'
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (busy || edit?.type === 'video') return;
                dragDepthRef.current += 1;
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => {
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDragActive(false);
              }}
              onDrop={handleDrop}
            >
              {edit?.type === 'voice' && service.keptAudio && (
                <AudioBar key={service.keptAudio.id} media={service.keptAudio} />
              )}
              {(service.keptMedia.length > 0 || service.images.length > 0) && (
                <div className="grid grid-cols-4 gap-2">
                  {service.keptMedia.map((m) =>
                    m.mime.startsWith('video/') ? (
                      <div key={m.id} className="relative">
                        <div className="flex aspect-square w-full items-center justify-center rounded-surface-md bg-ink">
                          <span className="text-caption text-bg">视频</span>
                        </div>
                        <IconButton
                          icon={X}
                          label="移除这段视频"
                          variant="secondary"
                          className="absolute -right-1 -top-1"
                          onClick={() => service.removeKeptMedia(m.id)}
                        />
                      </div>
                    ) : (
                      <div key={m.id} className="relative">
                        <img
                          src={cardDisplayUrl(m)!}
                          alt=""
                          className="aspect-square w-full rounded-surface-md border border-line object-cover"
                        />
                        <IconButton
                          icon={X}
                          label="移除这张图片"
                          variant="secondary"
                          className="absolute -right-1 -top-1"
                          onClick={() => service.removeKeptMedia(m.id)}
                        />
                      </div>
                    ),
                  )}
                  {service.images.map((img, i) => (
                    <div key={img.previewUrl} className="relative">
                      <img
                        src={img.previewUrl}
                        alt=""
                        className="aspect-square w-full rounded-surface-md border border-line object-cover"
                      />
                      <IconButton
                        icon={X}
                        label="移除这张图片"
                        variant="secondary"
                        className="absolute -right-1 -top-1"
                        onClick={() => service.removeImage(i)}
                      />
                    </div>
                  ))}
                </div>
              )}
              {service.video && (
                <video src={service.video.previewUrl} className="max-h-40 w-full rounded-surface-md" controls />
              )}
              {service.video && (
                // key 绑 previewUrl：换视频即整体重挂载，避免旧缩略图与滑杆位置残留
                // （滑杆是 uncontrolled defaultValue={0}，不重挂载不会复位）
                <VideoPosterPicker
                  key={service.video.previewUrl}
                  previewUrl={service.video.previewUrl}
                  durationSeconds={service.video.durationSeconds}
                  onChange={(blob) => service.setPoster(blob)}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  leadingIcon={ImageIcon}
                  disabled={
                    edit
                      ? editOccupied(service.keptMedia, service.images) >= editImageCap(edit)
                      : service.images.length >= (service.voice ? 8 : 9)
                  }
                  onClick={() => imgRef.current?.click()}
                >
                  加图片
                </Button>
                {!edit && !service.voice && (
                  <Button variant="secondary" leadingIcon={VideoIcon} onClick={() => vidRef.current?.click()}>
                    加视频
                  </Button>
                )}
                <input
                  ref={imgRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (edit) service.addImages(files);
                    else service.onPickImages(files);
                  }}
                />
                {!edit && (
                  <input
                    ref={vidRef}
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) service.onPickVideo(file);
                    }}
                  />
                )}
              </div>
              <p className="flex items-center gap-2 text-caption text-muted">
                <Upload aria-hidden="true" size={16} />
                粘贴图片，或把图片／视频拖到这里
              </p>
              {!edit &&
                !service.video &&
                (voiceSupported ? (
                  <VoiceRecorder onChange={(draft) => service.setVoice(draft)} />
                ) : (
                  <p className="text-meta text-muted">当前浏览器不支持录音，可继续发文字、图片或视频。</p>
                ))}
            </div>
          )}

          <DateTimeField
            value={service.happenedAt}
            onChange={(v) => service.setHappenedAt(v)}
            hint={
              (edit && service.happenedAt === toWallClockInput(edit.happenedAt, edit.happenedTzOffset)
                ? edit.isBackfill
                : isPastHappenedAt(
                    Date.parse(
                      edit ? wallClockToIso(service.happenedAt, edit.happenedTzOffset) : service.happenedAt,
                    ),
                  ))
                ? '补记，不会通知家人'
                : undefined
            }
          />

          <TemplateFields service={service} edit={Boolean(edit)} />

          {chainId && (
            <div className="flex flex-wrap items-center gap-2">
              {service.tagList.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={service.selectedTags.includes(t.id)}
                  onClick={() => service.toggleTag(t.id)}
                  className={`rounded-full border px-3 py-1 text-caption transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
                    service.selectedTags.includes(t.id)
                      ? 'border-transparent bg-select text-select-fg'
                      : 'border-line text-ink hover:bg-floating-hover'
                  }`}
                >
                  #{t.name}
                </button>
              ))}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void service.createTag();
                }}
              >
                <Input
                  aria-label="新标签"
                  value={service.newTag}
                  onChange={(e) => (service.newTag = e.target.value)}
                  placeholder="新标签"
                  className="w-24"
                />
              </form>
            </div>
          )}

          {chainId && <PersonPicker service={service} />}

          {service.error && <Banner tone="error">{service.error}</Banner>}
        </div>
      </Sheet>

      {/* 草稿丢弃确认：只在 dirty 时出现；Escape 等价于更安全的「继续记录」 */}
      <AlertDialog
        open={discardOpen}
        title="放弃这条记录？"
        body="写下的内容还没有记下，放弃后就找不回来了。"
        confirmLabel="放弃记录"
        cancelLabel="继续记录"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          service.resetAndClose();
        }}
      />

      <AlertDialog
        open={service.replaceConfirm !== null}
        title={service.replaceConfirm === 'image' ? '换成图片？' : '换成视频？'}
        body="图片和视频不能混在一条里，继续会去掉现在选的。"
        confirmLabel="换掉"
        cancelLabel="取消"
        onCancel={() => service.cancelReplace()}
        onConfirm={() => service.confirmReplace()}
      />
    </>
  );
});

function isPastHappenedAt(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) > 5 * 60_000;
}

const ComposeBody = bindServices(ComposeBodyContent, [ComposePanelService]);
