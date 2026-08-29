import { describe, expect, it } from 'vitest';
import { feedQuery } from './feed';
import type { RailFilter } from '@/timeline/timeline-rail';

describe('feedQuery（spec fused-retrieval §7.1）', () => {
  it('带出 personId/place，不带 personName', () => {
    const filter: RailFilter = {
      order: 'happened_at',
      personId: 'p-1',
      personName: '外婆',
      place: '朝阳公园',
      tagId: 't-1',
      before: '2026-09-01T00:00:00.000Z',
      chainIds: ['c-1'],
    };
    const q = feedQuery(filter, 'cur', 50);
    expect(q).toEqual({
      chainIds: ['c-1'],
      tagId: 't-1',
      order: 'happened_at',
      before: '2026-09-01T00:00:00.000Z',
      personId: 'p-1',
      place: '朝阳公园',
      cursor: 'cur',
      limit: 50,
    });
    expect(q).not.toHaveProperty('personName');
    expect(q).not.toHaveProperty('happenedFrom');
    expect(q).not.toHaveProperty('happenedTo');
  });
});
