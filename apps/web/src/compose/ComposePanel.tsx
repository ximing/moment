import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { compressImage } from '@/lib/compress';
import { humanError } from '@/lib/errors';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';
import { canCompose } from '@/lib/roles';
import { currentTzOffset } from '@/lib/time';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { useCompose } from './ComposeContext';

interface PickedImage {
  file: File;
  previewUrl: string;
}

export function ComposePanel() {
  const { request, closeCompose } = useCompose();
  if (!request) return null;
  return <ComposeBody request={request} onClose={closeCompose} />;
}

function ComposeBody({
  request,
  onClose,
}: {
  request: { chainId?: string; edit?: import('@moment/dto').MomentResponse };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const edit = request.edit;
  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const writable = (chains ?? []).filter((c) => canCompose(c));

  const [pickedChainId, setPickedChainId] = useState(request.chainId ?? edit?.chainId ?? '');
  const chainId = pickedChainId || writable[0]?.id || '';
  const [content, setContent] = useState(edit?.content ?? '');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [video, setVideo] = useState<{ file: File; previewUrl: string; durationSeconds: number } | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState<'image' | 'video' | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [backfill, setBackfill] = useState(edit?.isBackfill ?? false);
  const [happenedAt, setHappenedAt] = useState(edit ? toLocalInput(edit.happenedAt) : nowLocalInput());
  const [selectedTags, setSelectedTags] = useState<string[]>(edit?.tags.map((t) => t.id) ?? []);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    return () => {
      images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      if (video) URL.revokeObjectURL(video.previewUrl);
    };
    // unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: tagList } = useQuery({
    queryKey: qk.tags(chainId),
    queryFn: () => client.listTags(chainId),
    enabled: chainId.length > 0,
  });

  const createTag = useMutation({
    mutationFn: (name: string) => client.createTag(chainId, name),
    onSuccess: (tag) => {
      void queryClient.invalidateQueries({ queryKey: qk.tags(chainId) });
      setSelectedTags((prev) => [...prev, tag.id]);
      setNewTag('');
    },
    onError: (e) => setError(humanError(e)),
  });

  const needChainPick = !edit && !request.chainId && writable.length > 1 && !chainId;

  function addImages(files: File[]) {
    setError(null);
    setImages((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}）`);
          continue;
        }
        if (next.length >= 9) {
          setError('最多 9 张图片');
          break;
        }
        next.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
  }

  async function addVideo(file: File) {
    setError(null);
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`视频超过上限（${formatBytes(MAX_VIDEO_BYTES)}）`);
      return;
    }
    try {
      const meta = await probeVideo(file);
      if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        setError(`视频最长 ${MAX_VIDEO_DURATION_SECONDS / 60} 分钟`);
        return;
      }
      setVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file, durationSeconds: meta.durationSeconds, previewUrl: URL.createObjectURL(file) };
      });
    } catch {
      setError('无法读取视频');
    }
  }

  function onPickImages(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (video) {
      setPendingFiles(files);
      setReplaceConfirm('image');
      return;
    }
    addImages(files);
  }

  function onPickVideo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (images.length > 0) {
      setPendingFiles([file]);
      setReplaceConfirm('video');
      return;
    }
    void addVideo(file);
  }

  function confirmReplace() {
    if (replaceConfirm === 'image') {
      if (video) URL.revokeObjectURL(video.previewUrl);
      setVideo(null);
      addImages(pendingFiles);
    }
    if (replaceConfirm === 'video' && pendingFiles[0]) {
      images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      setImages([]);
      void addVideo(pendingFiles[0]);
    }
    setReplaceConfirm(null);
    setPendingFiles([]);
  }

  async function submit() {
    setError(null);
    if (!chainId) {
      setError('先选一条链');
      return;
    }
    const hasImages = images.length > 0;
    const hasVideo = Boolean(video);
    if (!hasImages && !hasVideo && content.trim().length === 0) {
      setError('先写一句此刻吧');
      return;
    }
    const happenedAtMs = Date.parse(happenedAt);
    if (Number.isNaN(happenedAtMs)) {
      setError('发生时间不合法');
      return;
    }
    setBusy(true);
    try {
      if (edit) {
        await client.updateMoment(edit.id, {
          content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill: backfill,
          tagIds: selectedTags,
        });
      } else {
        const type = hasVideo ? 'video' : hasImages ? 'media' : 'text';
        const mediaIds: string[] = [];
        if (hasImages) {
          for (let i = 0; i < images.length; i++) {
            setProgress(`上传图片 ${i + 1}/${images.length}`);
            const file = await compressImage(images[i]!.file);
            const res = await client.uploadMedia({
              file,
              mime: file.type,
              size: file.size,
              kind: 'image',
              sortOrder: i,
              onProgress: (l, t) => setProgress(`上传图片 ${i + 1}/${images.length} ${Math.round((l / t) * 100)}%`),
            });
            mediaIds.push(res.mediaId);
          }
        }
        if (video) {
          setProgress('上传视频…');
          const res = await client.uploadMedia({
            file: video.file,
            mime: video.file.type,
            size: video.file.size,
            kind: 'video',
            durationSeconds: video.durationSeconds,
            onProgress: (l, t) => setProgress(`上传视频 ${Math.round((l / t) * 100)}%`),
          });
          mediaIds.push(res.mediaId);
        }
        setProgress('记下…');
        await client.createMoment(chainId, {
          type,
          content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill: backfill,
          mediaIds,
          tagIds: selectedTags,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: qk.chainMoments(chainId) });
      void queryClient.invalidateQueries({ queryKey: qk.tags(chainId) });
      void queryClient.invalidateQueries({ queryKey: qk.chain(chainId) });
      onClose();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const title = edit ? '改这条时刻' : '记下此刻';

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/30 p-6 pt-16">
      <div className="w-full max-w-content rounded-paper bg-paper p-6 shadow-paper">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">{title}</h2>
          <button type="button" className="text-sm text-muted" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>

        {!edit && writable.length > 1 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {writable.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPickedChainId(c.id)}
                className={`rounded-paper border px-3 py-2 text-left text-sm ${
                  chainId === c.id ? 'border-accent bg-accent/10' : 'border-line'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        {!edit && writable.length === 1 && <p className="mt-3 text-sm text-muted">记到「{writable[0]!.name}」</p>}

        {needChainPick && <p className="mt-3 text-sm text-muted">先选一条链</p>}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="这一刻…"
          className="mt-4 min-h-[8rem] w-full resize-y rounded-paper border border-line bg-white/70 px-3 py-3 text-[17px] leading-relaxed"
        />

        {!edit && (
          <div className="mt-3">
            {images.length > 0 && (
              <div className="mb-2 grid grid-cols-4 gap-1">
                {images.map((img, i) => (
                  <div key={img.previewUrl} className="relative">
                    <img src={img.previewUrl} alt="" className="aspect-square w-full rounded object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded-full bg-ink/60 px-1 text-xs text-paper"
                      onClick={() =>
                        setImages((prev) => {
                          URL.revokeObjectURL(prev[i]!.previewUrl);
                          return prev.filter((_, idx) => idx !== i);
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {video && (
              <video src={video.previewUrl} className="mb-2 max-h-40 w-full rounded" controls />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => imgRef.current?.click()}>
                加图片
              </Button>
              <Button variant="ghost" onClick={() => vidRef.current?.click()}>
                加视频
              </Button>
              <input ref={imgRef} type="file" accept="image/*" multiple hidden onChange={onPickImages} />
              <input ref={vidRef} type="file" accept="video/*" hidden onChange={onPickVideo} />
            </div>
          </div>
        )}

        <div className="mt-4 text-sm">
          <button type="button" className="text-muted" onClick={() => setBackfill((v) => !v)}>
            {backfill ? '这是补记' : '就是现在 · 点此补记'}
          </button>
          {backfill && (
            <input
              type="datetime-local"
              value={happenedAt}
              onChange={(e) => setHappenedAt(e.target.value)}
              className="mt-2 block rounded-paper border border-line bg-white/70 px-3 py-2"
            />
          )}
        </div>

        {chainId && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(tagList?.tags ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  setSelectedTags((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))
                }
                className={`rounded-full px-2 py-0.5 text-xs ${
                  selectedTags.includes(t.id) ? 'bg-accent text-accent-fg' : 'bg-line text-ink'
                }`}
              >
                #{t.name}
              </button>
            ))}
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newTag.trim()) createTag.mutate(newTag.trim());
              }}
            >
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="新标签"
                className="w-24 rounded-full border border-line px-2 py-0.5 text-xs"
              />
            </form>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <Banner>{error}</Banner>
          </div>
        )}
        {progress && <p className="mt-2 text-sm text-muted">{progress}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? progress ?? '记下…' : edit ? '保存' : '记下'}
          </Button>
        </div>
      </div>

      {replaceConfirm && (
        <Confirm
          title={replaceConfirm === 'image' ? '换成图片？' : '换成视频？'}
          body="图片和视频不能混在一条里，继续会去掉现在选的。"
          confirmLabel="换掉"
          onCancel={() => {
            setReplaceConfirm(null);
            setPendingFiles([]);
          }}
          onConfirm={confirmReplace}
        />
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
