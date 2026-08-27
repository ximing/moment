import { useState } from 'react';
import type { ChainAppearanceColor, ChainIcon, ChainImageFocus } from '@moment/dto';
import { CENTER_FOCUS, focusObjectPosition } from '@/chain/appearance-model';
import { chainColorCss, resolveChainAppearanceColor } from '@/lib/chain-color';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';

/** 链标识透传视图（chainLookById 的 value）：不含 cover——侧栏/时间线/那年今日只用头像。 */
export interface ChainLook {
  name: string;
  color: ChainAppearanceColor | null;
  icon: ChainIcon | null;
  avatarMediaId: string | null;
  avatarFocus: ChainImageFocus | null;
}

/** 链标记渲染优先级（spec §7.5）：image > emoji > color > id 哈希色。
 *  登录图经 useMediaObjectUrl 认证 blob；公开分享直接给 tokenized avatarSrc（此时
 *  hook 收 null id，绝不发 blob 请求）。emoji 背景固定 var(--surface)；图片加载失败
 *  当次回退（记住失败的 src），不无限重试。 */
export function ChainMark({
  chainId,
  color,
  icon,
  avatarMediaId = null,
  avatarSrc = null,
  avatarFocus = null,
  size = 16,
}: {
  chainId: string;
  color?: ChainAppearanceColor | null;
  icon?: ChainIcon | string | null;
  avatarMediaId?: string | null;
  avatarSrc?: string | null;
  avatarFocus?: ChainImageFocus | null;
  size?: number;
}) {
  // Rules of Hooks：始终调用 hook；avatarSrc 在场时挂 null id 空订阅，绝不进 blob 通道
  const blobUrl = useMediaObjectUrl(avatarSrc ? null : avatarMediaId);
  const src = avatarSrc ?? blobUrl;
  // 当次回退态 = 失败的 src；src 变化自然重置
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  if (src !== null && brokenSrc !== src) {
    return (
      <img
        alt=""
        aria-hidden
        src={src}
        onError={() => setBrokenSrc(src)}
        className="inline-block shrink-0 rounded-full object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: focusObjectPosition(avatarFocus ?? CENTER_FOCUS),
        }}
      />
    );
  }
  if (icon) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size, background: 'var(--surface)', fontSize: size * 0.58, lineHeight: 1 }}
      >
        {icon}
      </span>
    );
  }
  const bg = chainColorCss(resolveChainAppearanceColor(chainId, color));
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: bg }}
    />
  );
}
