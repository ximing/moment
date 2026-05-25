import { useEffect, useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { client } from '@/api/client';

/** 经 client.fetchMediaBlob 拉媒体二进制并转 object URL；组件卸载时 revokeObjectURL（不泄漏）。
 *  GET /api/media/:id 是 @Authorized 端点，<img>/<video> src 无法携带 Bearer——故不直接用 client.mediaUrl。
 *  取舍（Global Constraints 媒体条目）：整段加载、无 302 头 Cache-Control 复用与视频流式 seek，Phase 8 再引入签名 query 参数方案。 */
function useMediaObjectUrl(mediaId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaId) return; // null = 暂不加载（视频点击前的占位态）
    let objectUrl: string | null = null;
    let alive = true;
    void client
      .fetchMediaBlob(mediaId)
      .then((blob) => {
        if (!alive) return; // 已卸载：不再创建 object URL（blob 交给 GC）
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined); // 单项媒体加载失败静默占位，不打断卡片其余内容
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [mediaId]);
  return url;
}

/** 媒体展示：视频用 <video>；图片 1 张大图、2–9 张三列宫格。二进制一律经 fetchMediaBlob 获取。 */
export function MediaGrid({ media }: { media: MomentMedia[] }) {
  if (media.length === 0) return null;
  if (media[0]!.mime.startsWith('video/')) {
    return <MediaVideo mediaId={media[0]!.id} />;
  }
  const cols = media.length === 1 ? 'grid-cols-1' : 'grid-cols-3';
  return (
    <div className={`mt-2 grid ${cols} gap-1`}>
      {media.map((m) => (
        <MediaImage key={m.id} mediaId={m.id} single={media.length === 1} />
      ))}
    </div>
  );
}

/** 视频点击加载：fetchMediaBlob 是整段加载（取舍见 Global Constraints 媒体条目），
 *  feed/链时间线里自动拉取每条视频会瞬间占满带宽——默认只渲染占位按钮，点击后才拉取并播放
 *  （详情页同款交互：卡片内点击即加载播放）。 */
function MediaVideo({ mediaId }: { mediaId: string }) {
  const [activated, setActivated] = useState(false);
  const url = useMediaObjectUrl(activated ? mediaId : null);
  if (!activated) {
    return (
      <button
        type="button"
        onClick={() => setActivated(true)}
        className="mt-2 flex aspect-video w-full items-center justify-center rounded bg-gray-900/90 text-sm text-white"
      >
        ▶ 点击查看视频
      </button>
    );
  }
  if (!url) return <div className="mt-2 aspect-video w-full animate-pulse rounded bg-gray-100" />;
  return <video controls autoPlay src={url} className="mt-2 w-full rounded bg-black" />;
}

function MediaImage({ mediaId, single }: { mediaId: string; single: boolean }) {
  const url = useMediaObjectUrl(mediaId);
  if (!url) return <div className={`aspect-square w-full rounded bg-gray-100 ${single ? 'max-h-96' : ''}`} />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={`aspect-square w-full rounded object-cover ${single ? 'max-h-96 object-contain' : ''}`}
    />
  );
}
