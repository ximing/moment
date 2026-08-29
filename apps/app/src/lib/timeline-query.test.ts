import { describe, expect, it } from 'vitest';
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery, buildFeedQuery, buildSearchInput } from './timeline-query';

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

describe('buildSearchInput（spec §7.2：不带 before/order/source）', () => {
  it('POST body 含 q/tzOffset/chainIds/personId/tagId/place/limit/cursor，不含 before/order/source/parsed', () => {
    const body = buildSearchInput({
      q: '去年今天和外婆',
      tzOffset: -480,
      chainIds: ['c-1'],
      cursor: 's-cur',
      limit: TIMELINE_PAGE_SIZE,
      personId: 'p-1',
      tagId: 't-1',
      place: '朝阳公园',
    });
    expect(body).toEqual({
      q: '去年今天和外婆',
      tzOffset: -480,
      chainIds: ['c-1'],
      cursor: 's-cur',
      limit: 20,
      personId: 'p-1',
      tagId: 't-1',
      place: '朝阳公园',
    });
    expect(body).not.toHaveProperty('before');
    expect(body).not.toHaveProperty('order');
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('parsed');
  });

  it('可选键缺省时不出现在对象上', () => {
    const body = buildSearchInput({ q: '外婆', tzOffset: -480, limit: 20 });
    expect(body).toEqual({ q: '外婆', tzOffset: -480, limit: 20 });
    expect(body).not.toHaveProperty('chainIds');
    expect(body).not.toHaveProperty('personId');
    expect(body).not.toHaveProperty('tagId');
    expect(body).not.toHaveProperty('place');
    expect(body).not.toHaveProperty('cursor');
    expect(body).not.toHaveProperty('before');
  });
});
