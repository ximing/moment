import type { ChainDto } from '@moment/dto';
import { Globe, Link } from 'lucide-react';
import { roleLabel } from '@/lib/roles';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { MemberPopover } from '@/ui/popover/index';

/**
 * 链页眉成员头像簇 + 可见性标识（2026-08-18-chain-audience-header-design.md §3）：
 * 头像贴链名右侧同一行，重叠 8px（--space-2）+ 1px --bg 描边；浮层是
 * MemberPopover（hover / 点按出昵称 + 角色人话），头像与 +N 都不进设置；
 * 头像、可见性、··· 均不加阴影（C 端总规范 §4.2）。
 */
export function ChainAudience({ chain }: { chain: ChainDto }) {
  const extra = chain.memberCount - chain.membersPreview.length;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center -space-x-2">
        {chain.membersPreview.map((m) => (
          <MemberPopover key={m.userId} member={{ nickname: m.nickname, role: roleLabel(m.role) }}>
            <button
              type="button"
              aria-label={m.nickname}
              className="relative inline-flex cursor-default rounded-full ring-1 ring-bg focus-visible:outline-none focus-visible:ring-focus"
            >
              <Avatar name={m.nickname} src={m.avatarUrl} size={24} />
            </button>
          </MemberPopover>
        ))}
        {extra > 0 && (
          <MemberPopover member={{ nickname: `还有 ${extra} 人` }}>
            <button
              type="button"
              aria-label={`还有 ${extra} 人`}
              className="inline-flex h-6 w-6 cursor-default items-center justify-center rounded-full bg-surface text-caption text-muted ring-1 ring-bg focus-visible:outline-none focus-visible:ring-focus"
            >
              +{extra}
            </button>
          </MemberPopover>
        )}
      </div>
      {chain.visibility === 'link' && (
        <span className="inline-flex items-center gap-1 text-caption text-muted">
          <Icon icon={Link} size={14} />
          链接可看
        </span>
      )}
      {chain.visibility === 'public' && (
        <span className="inline-flex items-center gap-1 text-caption text-muted">
          <Icon icon={Globe} size={14} />
          公开
        </span>
      )}
    </div>
  );
}
