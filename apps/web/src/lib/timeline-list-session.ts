import type { ChainDetailDto, MonthIndexEntry, MomentResponse, SearchParsed, TagResponse } from '@moment/dto';
import type { RailFilter } from '@/timeline/timeline-rail';

/** 离开相册进详情时把列表快照下来，返回后只补被看过的那一条，避免整表 loadFirst 丢掉翻页和滚动。 */

export type FeedListSession = {
  filter: RailFilter;
  moments: MomentResponse[];
  nextCursor: string | null;
  monthIndex: MonthIndexEntry[];
  tags: TagResponse[];
  searching: boolean;
  searchQ: string;
  searchParsed: SearchParsed | null;
  scrollY: number;
};

export type ChainListSession = FeedListSession & {
  chainId: string;
  chain: ChainDetailDto | null;
};

let feedSession: FeedListSession | null = null;
let chainSession: ChainListSession | null = null;
let viewedMomentId: string | null = null;

export function resetTimelineListSession(): void {
  feedSession = null;
  chainSession = null;
  viewedMomentId = null;
}

export function rememberViewedMoment(momentId: string): void {
  viewedMomentId = momentId || null;
}

export function peekViewedMomentId(): string | null {
  return viewedMomentId;
}

export function takeViewedMomentId(): string | null {
  const id = viewedMomentId;
  viewedMomentId = null;
  return id;
}

export function saveFeedListSession(session: FeedListSession): void {
  if (session.moments.length === 0 && feedSession?.moments.length) return;
  feedSession = session;
}

export function peekFeedListSession(): FeedListSession | null {
  return feedSession;
}

export function saveChainListSession(session: ChainListSession): void {
  if (session.moments.length === 0 && !session.chain && chainSession?.moments.length) return;
  chainSession = session;
}

export function peekChainListSession(): ChainListSession | null {
  return chainSession;
}
