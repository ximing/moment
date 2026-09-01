import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/button/index';
import type { RailFilter } from './timeline-rail';

const chip =
  'rounded-full border border-line px-3 py-1 text-caption text-ink transition-colors duration-[var(--ease)] hover:bg-floating-hover focus-visible:outline-none focus-visible:ring-focus';

export function FilterChips({
  filter,
  onClearPerson,
  onClearPlace,
  onClearBefore,
  pinBelowCover = false,
}: {
  filter: RailFilter;
  onClearPerson: () => void;
  onClearPlace: () => void;
  onClearBefore?: () => void;
  /** 链首页有封面时贴在 30vh 下沿，避免叠进图里点不到 */
  pinBelowCover?: boolean;
}) {
  const hasBefore = Boolean(filter.before);
  const hasPerson = Boolean(filter.personId);
  const hasPlace = Boolean(filter.place);
  if (!hasBefore && !hasPerson && !hasPlace) return null;
  return (
    <div
      className={
        pinBelowCover
          ? 'sticky top-[30vh] z-20 mb-4 flex flex-wrap items-center gap-2 pt-2'
          : 'sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2'
      }
    >
      {hasBefore && onClearBefore ? (
        <Button variant="secondary" leadingIcon={ArrowLeft} onClick={onClearBefore}>
          回到今天
        </Button>
      ) : null}
      {hasPerson ? (
        <button
          type="button"
          aria-label={`清除人物筛选 ${filter.personName ?? '人物'}`}
          onClick={onClearPerson}
          className={chip}
        >
          {filter.personName ?? '人物'} ×
        </button>
      ) : null}
      {hasPlace ? (
        <button
          type="button"
          aria-label={`清除地点筛选 ${filter.place}`}
          onClick={onClearPlace}
          className={chip}
        >
          📍 {filter.place} ×
        </button>
      ) : null}
    </div>
  );
}
