import { Plus } from 'lucide-react';
import { REACTION_EMOJIS, type PublicShareMoment } from '@moment/dto';
import { Icon } from '@/ui/Icon';
import { ReactionPopover } from '@/ui/popover/index';

/**
 * 情绪入口（C 端总规范 §6.4）：已有计数的表情显示为轻 chips（我点过的用 --select
 * 轻强调，无阴影）；加表情的唯一入口是内容左下的小圆形淡紫（--date）轻色面，
 * 打开 ReactionPopover 选表情。点选/取消的 API 行为不变。
 */
export function ReactionBar({
  moment,
  onReact,
}: {
  moment: PublicShareMoment;
  onReact: (emoji: string) => void;
}) {
  const counted = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: moment.reactions.find((r) => r.emoji === emoji)?.count ?? 0,
  })).filter((r) => r.count > 0 || moment.myReaction === r.emoji);

  return (
    <span className="flex flex-wrap items-center gap-1">
      {counted.map(({ emoji, count }) => {
        const mine = moment.myReaction === emoji;
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={mine}
            onClick={() => onReact(emoji)}
            className={`rounded-full px-2 py-1 text-meta transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
              mine ? 'bg-select text-select-fg' : 'text-muted hover:bg-floating-hover hover:text-ink'
            }`}
          >
            {emoji}
            {count > 0 ? ` ${count}` : ''}
          </button>
        );
      })}
      <ReactionPopover
        value={moment.myReaction}
        onChange={onReact}
        trigger={
          <button
            type="button"
            aria-label="加个表情"
            className="flex min-h-touch-control min-w-[var(--touch-control-min)] items-center justify-center rounded-full text-muted outline-none transition-colors duration-[var(--ease)] hover:text-ink focus-visible:ring-focus"
          >
            {/* 视觉 32px、点击区满足 40/44px（spec §6.4 / §8） */}
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[color-mix(in_srgb,var(--date)_34%,transparent)] text-ink">
              <Icon icon={Plus} size={16} />
            </span>
          </button>
        }
      />
    </span>
  );
}
