import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ApiError } from '@moment/api-client';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
} from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { currentTzOffset } from '@/lib/time';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';

const TYPES = [
  { value: 'text', label: '文字' },
  { value: 'media', label: '图片' },
  { value: 'video', label: '视频' },
] as const;
type MomentType = (typeof TYPES)[number]['value'];

interface PickedImage {
  file: File;
  previewUrl: string;
}
interface PickedVideo {
  file: File;
  size: number;
  durationSeconds: number;
  previewUrl: string;
}
interface UploadItem {
  name: string;
  loaded: number;
  total: number;
  status: 'uploading' | 'done';
}

export function ComposePage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: chain } = useQuery({
    queryKey: qk.chain(chainId ?? ''),
    queryFn: () => client.getChain(chainId!),
    enabled: chainId !== undefined,
  });
  const { data: tagList } = useQuery({
    queryKey: qk.tags(chainId ?? ''),
    queryFn: () => client.listTags(chainId!),
    enabled: chainId !== undefined,
  });

  const [type, setType] = useState<MomentType>('text');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [happenedAt, setHappenedAt] = useState(nowLocalInput());
  const [isBackfill, setIsBackfill] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // 预览 objectURL 生命周期：删除单张图片/移除视频在各自 handler 内即时 revoke，
  // 组件卸载（发布成功跳走 / 取消返回）由本 effect 统一兜底 revoke——ref 取最新值，deps 固定 []。
  const previewsRef = useRef<{ images: PickedImage[]; video: PickedVideo | null }>({ images: [], video: null });
  useEffect(() => {
    previewsRef.current = { images, video };
  });
  useEffect(
    () => () => {
      previewsRef.current.images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      if (previewsRef.current.video) URL.revokeObjectURL(previewsRef.current.video.previewUrl);
    },
    []
  );

  const canCompose = chain?.myRole === 'owner' || chain?.myRole === 'editor';

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.createMoment>[1]) =>
      client.createMoment(chainId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.chainMoments(chainId!) });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: qk.tags(chainId!) });
      void queryClient.invalidateQueries({ queryKey: qk.chain(chainId!) });
      navigate(`/chains/${chainId}`);
    },
  });

  function onPickImages(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setImages((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}），已跳过`);
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

  async function onPickVideo(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`视频超过上限（${formatBytes(MAX_VIDEO_BYTES)}）`);
      return;
    }
    try {
      const meta = await probeVideo(file);
      if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        setError(`视频最长 ${MAX_VIDEO_DURATION_SECONDS / 60} 分钟，当前 ${meta.durationSeconds} 秒`);
        return;
      }
      setVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl); // 换选视频：旧预览即时释放
        return { file, ...meta, previewUrl: URL.createObjectURL(file) };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取视频');
    }
  }

  function toggleTag(id: string) {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length >= 20 ? prev : [...prev, id]
    );
  }

  async function uploadAll(): Promise<string[]> {
    const mediaIds: string[] = [];
    const queue: { name: string; run: (onProgress: (l: number, t: number) => void) => Promise<void>; size: number }[] = [];
    // 严格按当前 type 取待传媒体：切类型后另一侧的遗留选择不参与上传
    // （否则 video 类型会带出先前选的图片，被 createMomentInputSchema 以 MEDIA_COUNT_INVALID 拒绝）
    const pickedImages = type === 'media' ? images : [];
    pickedImages.forEach((img, index) => {
      queue.push({
        name: img.file.name,
        size: img.file.size,
        run: async (onProgress) => {
          const res = await client.uploadMedia({
            file: img.file,
            mime: img.file.type,
            size: img.file.size,
            kind: 'image',
            sortOrder: index,
            onProgress,
          });
          mediaIds.push(res.mediaId);
        },
      });
    });
    if (video && type === 'video') {
      queue.push({
        name: video.file.name,
        size: video.size,
        run: async (onProgress) => {
          const res = await client.uploadMedia({
            file: video.file,
            mime: video.file.type,
            size: video.size,
            kind: 'video',
            durationSeconds: video.durationSeconds,
            onProgress,
          });
          mediaIds.push(res.mediaId);
        },
      });
    }
    setItems(queue.map((q) => ({ name: q.name, loaded: 0, total: q.size, status: 'uploading' })));
    // 串行上传：进度逐项反馈，失败即中止（已传对象交由 server sweeper 24h 清理，无需 abort）
    for (let i = 0; i < queue.length; i++) {
      await queue[i]!.run((loaded, total) =>
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, loaded, total } : it)))
      );
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'done', loaded: it.total } : it)));
    }
    return mediaIds;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (type === 'text' && content.trim().length === 0) {
      setError('文字时刻不能为空');
      return;
    }
    if (type === 'media' && images.length === 0) {
      setError('请选择 1–9 张图片');
      return;
    }
    if (type === 'video' && !video) {
      setError('请选择一个视频');
      return;
    }
    // 先 parse 再 toISOString：datetime-local 清空/非法时 new Date(...).toISOString() 会直接抛
    // RangeError（async 里变 unhandled rejection），校验必须放在前面。
    const happenedAtMs = Date.parse(happenedAt);
    if (Number.isNaN(happenedAtMs)) {
      setError('发生时间不合法');
      return;
    }
    const happenedAtIso = new Date(happenedAtMs).toISOString();
    setSubmitting(true);
    try {
      const mediaIds = type === 'text' ? [] : await uploadAll();
      await create.mutateAsync({
        type,
        content,
        happenedAt: happenedAtIso,
        happenedTzOffset: currentTzOffset(),
        isBackfill,
        mediaIds,
        tagIds: selectedTags,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发布失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const overall = useMemo(() => {
    if (items.length === 0) return null;
    const loaded = items.reduce((s, it) => s + it.loaded, 0);
    const total = items.reduce((s, it) => s + it.total, 0);
    return { loaded, total, pct: total === 0 ? 100 : Math.round((loaded / total) * 100) };
  }, [items]);

  if (chain && !canCompose) {
    return (
      <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        你的角色（{chain.myRole}）不能在此链发布。回 <Link to={`/chains/${chainId}`} className="underline">链详情</Link>。
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`flex-1 rounded px-3 py-1.5 text-sm ${
              type === t.value ? 'bg-gray-900 text-white' : 'text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={type === 'text' ? 5 : 3}
        placeholder={type === 'text' ? '记录这一刻…' : '配文（可选）'}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 focus:border-gray-900 focus:outline-none"
      />

      {type === 'media' && (
        <div>
          <div className="grid grid-cols-3 gap-1">
            {images.map((img, i) => (
              <div key={img.previewUrl} className="relative">
                <img src={img.previewUrl} alt="" className="aspect-square w-full rounded object-cover" />
                <button
                  type="button"
                  onClick={() =>
                    setImages((prev) => {
                      URL.revokeObjectURL(prev[i]!.previewUrl); // 删除单张：即时释放
                      return prev.filter((_, idx) => idx !== i);
                    })
                  }
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white"
                  aria-label={`移除第 ${i + 1} 张`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {images.length < 9 && (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="aspect-square rounded border-2 border-dashed border-gray-300 text-sm text-gray-400"
              >
                添加图片
              </button>
            )}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickImages}
            className="hidden"
          />
          <p className="mt-1 text-xs text-gray-400">每张 ≤10MB，最多 9 张（{images.length}/9）</p>
        </div>
      )}

      {type === 'video' && (
        <div>
          {video ? (
            <div className="space-y-2">
              <video src={video.previewUrl} controls className="w-full rounded bg-black" />
              <p className="text-xs text-gray-500">
                {video.file.name} · {formatBytes(video.size)} · {video.durationSeconds} 秒
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(video.previewUrl); // 移除视频：即时释放
                    setVideo(null);
                  }}
                  className="ml-2 text-red-600 underline"
                >
                  移除
                </button>
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="w-full rounded border-2 border-dashed border-gray-300 py-8 text-sm text-gray-400"
            >
              选择视频（≤500MB、≤5 分钟）
            </button>
          )}
          <input ref={videoInputRef} type="file" accept="video/*" onChange={onPickVideo} className="hidden" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label htmlFor="happenedAt">发生时间</label>
        <input
          id="happenedAt"
          type="datetime-local"
          value={happenedAt}
          onChange={(e) => setHappenedAt(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isBackfill}
            onChange={(e) => setIsBackfill(e.target.checked)}
          />
          补发（不推送通知）
        </label>
      </div>

      {(tagList?.tags.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-3">
          <span className="text-sm text-gray-500">标签</span>
          {tagList!.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTag(t.id)}
              className={`rounded px-2 py-0.5 text-xs ${
                selectedTags.includes(t.id) ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-600'
              }`}
            >
              #{t.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {items.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">
            上传进度 {overall!.pct}%（{formatBytes(overall!.loaded)} / {formatBytes(overall!.total)}）
          </p>
          {items.map((it, i) => (
            <div key={`${it.name}-${i}`}>
              <div className="flex justify-between text-xs text-gray-500">
                <span className="truncate">{it.name}</span>
                <span>{it.status === 'done' ? '完成' : `${Math.round((it.loaded / it.total) * 100)}%`}</span>
              </div>
              <div className="h-1.5 w-full rounded bg-gray-100">
                <div
                  className="h-1.5 rounded bg-gray-900 transition-all"
                  style={{ width: `${it.total === 0 ? 100 : Math.round((it.loaded / it.total) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? '发布中…' : '发布'}
        </button>
      </div>
    </form>
  );
}
