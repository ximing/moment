import type { ChainDto } from '@moment/dto';
import { Globe, Link } from 'lucide-react';
import { roleLabel } from '@/lib/roles';
import { Avatar } from '@/ui/Avatar';
import { HoverTip } from '@/ui/HoverTip';
import { Icon } from '@/ui/Icon';

export function ChainAudience({ chain }: { chain: ChainDto }) {
  const extra = chain.memberCount - chain.membersPreview.length;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center -space-x-2">
        {chain.membersPreview.map((m) => (
          <HoverTip
            key={m.userId}
            label={
              <>
                <span className="block text-sm text-ink">{m.nickname}</span>
                <span className="block text-xs text-muted">{roleLabel(m.role)}</span>
              </>
            }
          >
            <span className="relative inline-flex rounded-full ring-1 ring-bg">
              <Avatar name={m.nickname} src={m.avatarUrl} size={24} />
            </span>
          </HoverTip>
        ))}
        {extra > 0 && (
          <HoverTip label={`还有 ${extra} 人`}>
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-xs text-muted ring-1 ring-bg">
              +{extra}
            </span>
          </HoverTip>
        )}
      </div>
      {chain.visibility === 'link' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Icon icon={Link} size={14} />
          链接可看
        </span>
      )}
      {chain.visibility === 'public' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Icon icon={Globe} size={14} />
          公开
        </span>
      )}
    </div>
  );
}
