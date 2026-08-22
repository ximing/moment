import { useEffect, useRef, useState } from 'react';

// 视频封面截帧（spec 2026-08-22-video-poster §3）：复用 service 持有的 previewUrl
// （同一 file 的 object URL，service 统一 revoke），本地 <video> seek + canvas 导出
// JPEG；拖动选帧，默认首帧。截帧失败静默 onChange(null) → 降级为无封面发布，
// 不阻塞发布流程、不出错误弹窗——封面是增强不是门槛。
// 默认首帧在 loadeddata 时直接 capture（不用 loadedmetadata + seek(0)）：视频本就
// 停在 0 时 currentTime=0 是无位移 seek，Safari 系不派发 seeked，且 loadedmetadata
// 时首帧未必已解码可 drawImage——默认缩略图会静默不出现（目标设备是平板/Safari 系）。
// 视觉只消费 token：rounded-surface-md 预览圆角、text-meta/text-muted 文案档。

export function VideoPosterPicker({
  previewUrl,
  durationSeconds,
  onChange,
}: {
  previewUrl: string;
  durationSeconds: number;
  onChange: (blob: Blob | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const thumbUrlRef = useRef<string | null>(null);

  const replaceThumb = (url: string | null) => {
    if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    thumbUrlRef.current = url;
    setThumbUrl(url);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) throw new Error('capture unavailable');
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            onChange(null);
            replaceThumb(null);
            return;
          }
          onChange(blob);
          replaceThumb(URL.createObjectURL(blob));
        },
        'image/jpeg',
        0.85
      );
    } catch {
      onChange(null); // 解码/导出失败（如 HEVC 本地不可解）→ 静默降级
      replaceThumb(null);
    }
  };

  const seekAndCapture = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      capture();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  };

  // 卸载时回收缩略图 object URL
  useEffect(
    () => () => {
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    },
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        src={previewUrl}
        muted
        playsInline
        preload="auto"
        className="hidden"
        onLoadedData={() => capture()} // 默认首帧：loadeddata 时首帧已解码可直接 drawImage（原因见文件头注释）
      />
      {thumbUrl && (
        <img src={thumbUrl} alt="视频封面预览" className="max-h-40 w-full rounded-surface-md object-cover" />
      )}
      <label className="flex items-center gap-2 text-meta text-muted">
        封面
        <input
          type="range"
          min={0}
          max={Math.max(durationSeconds, 0.1)}
          step={0.1}
          defaultValue={0}
          aria-label="选择封面帧"
          onChange={(e) => seekAndCapture(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
      </label>
    </div>
  );
}
