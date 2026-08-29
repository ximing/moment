/** app 时间线页大小（现网 feed / 链列表均为 20；搜索同页大小，偏差 7）。 */
export const TIMELINE_PAGE_SIZE = 20;

export function buildFeedQuery(args: {
  cursor?: string;
  chainId?: string;
  tagId?: string;
  order: 'happened_at' | 'created_at';
  personId?: string;
  place?: string;
  limit: number;
}): {
  cursor?: string;
  chainIds?: string[];
  tagId?: string;
  order: 'happened_at' | 'created_at';
  personId?: string;
  place?: string;
  limit: number;
} {
  return {
    cursor: args.cursor,
    chainIds: args.chainId ? [args.chainId] : undefined,
    tagId: args.tagId,
    order: args.order,
    personId: args.personId,
    place: args.place,
    limit: args.limit,
  };
}

export function buildChainMomentsQuery(args: {
  cursor?: string;
  personId?: string;
  place?: string;
  limit: number;
}): {
  cursor?: string;
  personId?: string;
  place?: string;
  limit: number;
} {
  return {
    cursor: args.cursor,
    personId: args.personId,
    place: args.place,
    limit: args.limit,
  };
}
