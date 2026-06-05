import { REACTION_EMOJIS, type MomentResponse } from '@moment/dto';
import { Menu } from '@/ui/Menu';

/**
 * 表情条（spec §6）：未点过的表情不再一排平铺，收成一枚「＋」贴纸浮层再选；
 * 已有计数的表情照常显示；我点过的 --select 黄底热态。点选/取消的 API 行为不变。
 */
export function ReactionBar({
  moment,
  onReact,
}: {
  moment: MomentResponse;
  onReact: (emoji: string) => void;
}) {
  const counted = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: moment.reactions.find((r) => r.emoji === emoji)?.count ?? 0,
  })).filter((r) => r.count > 0 || moment.myReaction === r.emoji);

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {counted.map(({ emoji, count }) => {
        const mine = moment.myReaction === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            className={`rounded-sticker border-2 px-2 py-0.5 text-sm shadow-sticker ${
              mine ? 'border-line bg-select text-ink' : 'border-line bg-surface text-ink'
            }`}
          >
            {emoji}
            {count > 0 ? ` ${count}` : ''}
          </button>
        );
      })}
      <Menu
        trigger={
          <button
            type="button"
            aria-label="加个表情"
            className="rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-sm text-muted shadow-sticker hover:text-ink"
          >
            ＋
          </button>
        }
      >
        {(close) => (
          <span className="flex gap-1 p-1">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-sticker px-1.5 py-0.5 text-lg hover:bg-select"
                onClick={() => {
                  onReact(emoji);
                  close();
                }}
              >
                {emoji}
              </button>
            ))}
          </span>
        )}
      </Menu>
    </span>
  );
}
