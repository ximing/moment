import { useState } from 'react';
import type { ChainImageFocus } from '@moment/dto';
import { CENTER_FOCUS, focusObjectPosition } from '@/chain/appearance-model';
import { isHttpUrl } from '@/lib/media-src';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';

// 链封面（spec §7.5）：只出现在链首页与公开分享页，侧栏/时间线/那年今日不渲染。
// 登录版优先接口签发的 https coverUrl；无 http src 时才走认证 blob。
// 公开版：已签发 https 直出，相对路径才拼 ?st=。加载失败当次隐藏并回调页面回普通页眉。

/** 无状态封面图：登录/公开两版共用，object-fit:cover + 保存的焦点。 */
function CoverImage({
  src,
  focus,
  onError,
}: {
  src: string;
  focus: ChainImageFocus | null;
  onError: () => void;
}) {
  return (
    <img
      alt=""
      src={src}
      onError={onError}
      className="h-full w-full object-cover"
      style={{ objectPosition: focusObjectPosition(focus ?? CENTER_FOCUS) }}
    />
  );
}

function frameClassName(className?: string): string {
  const base = 'aspect-[3/1] w-full overflow-hidden rounded-surface-lg bg-surface';
  return className ? `${base} ${className}` : base;
}

/** 当次回退守卫（与 ChainMark brokenSrc 同语义）：记失败的 URL；URL 变化自然重置，
 *  裸 boolean 会把换链/换封面后的新图一并误伤。 */
function useFailedUrl(): [string | null, (url: string) => void] {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return [failedUrl, setFailedUrl];
}

/** 登录版封面：优先接口签发的 coverUrl；否则 mediaId 走认证 blob 通道。 */
export function ChainCover({
  mediaId,
  src,
  focus,
  onError,
  className,
}: {
  mediaId: string;
  src?: string | null;
  focus: ChainImageFocus | null;
  onError?: () => void;
  className?: string;
}) {
  const blobUrl = useMediaObjectUrl(isHttpUrl(src) ? null : mediaId);
  const url = isHttpUrl(src) ? src! : blobUrl;
  const [failedUrl, markFailed] = useFailedUrl();
  if (url !== null && failedUrl === url) return null;
  return (
    <div aria-hidden className={frameClassName(className)}>
      {url !== null && (
        <CoverImage
          src={url}
          focus={focus}
          onError={() => {
            markFailed(url);
            onError?.();
          }}
        />
      )}
    </div>
  );
}

/** 公开分享版封面：已签发 https 则直出；相对路径才拼 ?st=。 */
export function PublicChainCover({
  src,
  shareToken,
  focus,
  onError,
  className,
}: {
  src: string;
  shareToken: string;
  focus: ChainImageFocus | null;
  onError?: () => void;
  className?: string;
}) {
  const url = isHttpUrl(src) ? src : `${src}${src.includes('?') ? '&' : '?'}st=${encodeURIComponent(shareToken)}`;
  const [failedUrl, markFailed] = useFailedUrl();
  if (failedUrl === url) return null;
  return (
    <div aria-hidden className={frameClassName(className)}>
      <CoverImage
        src={url}
        focus={focus}
        onError={() => {
          markFailed(url);
          onError?.();
        }}
      />
    </div>
  );
}
