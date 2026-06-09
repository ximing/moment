import { useEffect, useRef } from 'react';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChainMark } from '@/chain/ChainMark';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { HappenedAtField } from '@/ui/HappenedAtField';
import { Icon } from '@/ui/Icon';
import { toWallClockInput, wallClockToIso } from '@/lib/time';
import { X } from 'lucide-react';
import { ComposePanelService } from './compose-panel.service';

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

  useEffect(() => {
    service.hydrate(composeSession.request!);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时一次性水合
  }, []);
  useEffect(() => {
    void service.loadTagList();
  }, [service, service.chainId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !e.defaultPrevented) service.resetAndClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, service]);

  const edit = service.edit;
  const writable = service.writableChains;
  const chainId = service.chainId;

  const title = edit ? '改这条时刻' : '记下此刻';

  // 遮罩 30% 墨：var() 色值的 /30 修饰静默不生成 CSS，用 color-mix（硬约束）
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] p-6 pt-16">
      <div className="w-full max-w-content rounded-[24px] bg-surface p-6 shadow-card">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">{title}</h2>
          <button type="button" className="text-sm text-muted" disabled={busy} onClick={() => service.resetAndClose()}>
            关闭
          </button>
        </div>

        {!edit && writable.length > 1 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {writable.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => (service.pickedChainId = c.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-left text-sm ${
                  chainId === c.id ? 'bg-surface font-semibold shadow-sticker' : 'bg-bg'
                }`}
              >
                <ChainMark chainId={c.id} color={c.color} icon={c.icon} size={16} />
                {c.name}
              </button>
            ))}
          </div>
        )}
        {!edit && writable.length === 1 && <p className="mt-3 text-sm text-muted">记到「{writable[0]!.name}」</p>}

        {service.needChainPick && <p className="mt-3 text-sm text-muted">先选一条链</p>}

        <textarea
          value={service.content}
          onChange={(e) => (service.content = e.target.value)}
          placeholder="这一刻…"
          className="mt-4 min-h-[8rem] w-full resize-y rounded-card border border-line bg-bg px-3 py-3 text-[17px] leading-relaxed"
        />

        {!edit && (
          <div className="mt-3">
            {service.images.length > 0 && (
              <div className="mb-2 grid grid-cols-4 gap-1">
                {service.images.map((img, i) => (
                  <div key={img.previewUrl} className="relative">
                    <img src={img.previewUrl} alt="" className="aspect-square w-full rounded-[12px] border-2 border-stroke object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-action text-action-fg"
                      onClick={() => service.removeImage(i)}
                    >
                      <Icon icon={X} size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {service.video && (
              <video src={service.video.previewUrl} className="mb-2 max-h-40 w-full rounded" controls />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => imgRef.current?.click()}>
                加图片
              </Button>
              <Button variant="ghost" onClick={() => vidRef.current?.click()}>
                加视频
              </Button>
              <input
                ref={imgRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  service.onPickImages(files);
                }}
              />
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
            </div>
          </div>
        )}

        <div className="mt-4">
          <HappenedAtField
            value={service.happenedAt}
            onChange={(v) => (service.happenedAt = v)}
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
        </div>

        {chainId && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {service.tagList.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => service.toggleTag(t.id)}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  service.selectedTags.includes(t.id) ? 'bg-select text-select-fg' : 'border-2 border-stroke bg-surface text-ink'
                }`}
              >
                #{t.name}
              </button>
            ))}
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void service.createTag();
              }}
            >
              <input
                value={service.newTag}
                onChange={(e) => (service.newTag = e.target.value)}
                placeholder="新标签"
                className="w-24 rounded-card border border-line bg-bg px-2 py-0.5 text-xs"
              />
            </form>
          </div>
        )}

        {service.error && (
          <div className="mt-3">
            <Banner>{service.error}</Banner>
          </div>
        )}
        {service.progress && <p className="mt-2 text-sm text-muted">{service.progress}</p>}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="quiet" disabled={busy} onClick={() => service.resetAndClose()}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void service.submit()}>
            {busy ? service.progress ?? '记下…' : edit ? '保存' : '记下'}
          </Button>
        </div>
      </div>

      {service.replaceConfirm && (
        <Confirm
          title={service.replaceConfirm === 'image' ? '换成图片？' : '换成视频？'}
          body="图片和视频不能混在一条里，继续会去掉现在选的。"
          confirmLabel="换掉"
          onCancel={() => service.cancelReplace()}
          onConfirm={() => service.confirmReplace()}
        />
      )}
    </div>
  );
});

function isPastHappenedAt(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) > 5 * 60_000;
}

const ComposeBody = bindServices(ComposeBodyContent, [ComposePanelService]);
