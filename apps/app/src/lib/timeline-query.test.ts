import { describe, expect, it } from 'vitest';
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery, buildFeedQuery } from './timeline-query';

describe('TIMELINE_PAGE_SIZE', () => {
  it('锁 20（偏差 7：对齐现网 feed/链列表，不是 web 的 50）', () => {
    expect(TIMELINE_PAGE_SIZE).toBe(20);
  });
});

describe('buildFeedQuery（spec §7.1 RailFilter.personId/place → getFeed）', () => {
  it('带出 personId/place，不带 personName/happenedFrom/happenedTo/before', () => {
    const q = buildFeedQuery({
      cursor: 'cur',
      chainId: 'c-1',
      tagId: 't-1',
      order: 'happened_at',
      personId: 'p-1',
      place: '朝阳公园',
      limit: TIMELINE_PAGE_SIZE,
    });
    expect(q).toEqual({
      cursor: 'cur',
      chainIds: ['c-1'],
      tagId: 't-1',
      order: 'happened_at',
      personId: 'p-1',
      place: '朝阳公园',
      limit: 20,
    });
    expect(q).not.toHaveProperty('personName');
    expect(q).not.toHaveProperty('happenedFrom');
    expect(q).not.toHaveProperty('happenedTo');
    expect(q).not.toHaveProperty('before');
  });

  it('无 chainId 时 chainIds 为 undefined（全部链）', () => {
    const q = buildFeedQuery({ order: 'created_at', limit: 20 });
    expect(q.chainIds).toBeUndefined();
    expect(q.order).toBe('created_at');
    expect(q.personId).toBeUndefined();
    expect(q.place).toBeUndefined();
  });
});

describe('buildChainMomentsQuery（spec §6.1 app 链页 listChainMoments）', () => {
  it('带出 personId/place，不带 personName/happenedFrom/happenedTo/before/order/source', () => {
    const q = buildChainMomentsQuery({
      cursor: 'c2',
      personId: 'p-1',
      place: '朝阳公园',
      limit: TIMELINE_PAGE_SIZE,
    });
    expect(q).toEqual({
      cursor: 'c2',
      personId: 'p-1',
      place: '朝阳公园',
      limit: 20,
    });
    expect(q).not.toHaveProperty('personName');
    expect(q).not.toHaveProperty('happenedFrom');
    expect(q).not.toHaveProperty('happenedTo');
    expect(q).not.toHaveProperty('before');
    expect(q).not.toHaveProperty('order');
    expect(q).not.toHaveProperty('source');
  });
});
