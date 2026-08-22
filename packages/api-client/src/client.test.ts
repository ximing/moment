import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { createMomentClient } from './client.js';

/** 记录全部 fetch 调用并按需应答的 harness。 */
function harness() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const client = createMomentClient({
    baseUrl: 'http://x',
    tokenStore: {
      getAccessToken: () => null,
      getRefreshToken: () => null,
      setTokens: () => {},
      clear: () => {},
    },
    fetchImpl: async (url, init) => {
      const call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      // harness 只断言请求形状，应答统一 200 JSON（204 语义已在 http.test 覆盖）
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, calls };
}

test('auth：register/login 走 skipAuthRefresh；logout 传 refreshToken', async () => {
  const { client, calls } = harness();
  await client.register({ email: 'a@b.c', password: 'secret123', nickname: 'a' });
  await client.login({ email: 'a@b.c', password: 'secret123' });
  await client.logout('r1');
  await client.me();
  await client.updateMe({ avatarColor: 'mint' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST http://x/api/auth/register',
    'POST http://x/api/auth/login',
    'POST http://x/api/auth/logout',
    'GET http://x/api/auth/me',
    'PATCH http://x/api/auth/me',
  ]);
  assert.deepEqual(calls[0]!.body, { email: 'a@b.c', password: 'secret123', nickname: 'a' });
  assert.deepEqual(calls[2]!.body, { refreshToken: 'r1' });
});

test('chains/members/invites 路径与方法名对齐 Phase 2 路由', async () => {
  const { client, calls } = harness();
  await client.listChains();
  await client.getChain('c1');
  await client.createChain({ name: '链', visibility: 'private' });
  await client.updateChain('c1', { name: '新' });
  await client.deleteChain('c1');
  await client.listMembers('c1');
  await client.updateMemberRole('c1', 'u2', 'viewer');
  await client.removeMember('c1', 'u2');
  await client.transferChain('c1', 'u2');
  await client.createInvite('c1', { role: 'viewer' });
  await client.listInvites('c1');
  await client.revokeInvite('i1');
  await client.acceptInvite('tok');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/chains',
    'GET http://x/api/chains/c1',
    'POST http://x/api/chains',
    'PATCH http://x/api/chains/c1',
    'DELETE http://x/api/chains/c1',
    'GET http://x/api/chains/c1/members',
    'PATCH http://x/api/chains/c1/members/u2',
    'DELETE http://x/api/chains/c1/members/u2',
    'POST http://x/api/chains/c1/transfer',
    'POST http://x/api/chains/c1/invites',
    'GET http://x/api/chains/c1/invites',
    'DELETE http://x/api/invites/i1',
    'POST http://x/api/invites/tok/accept',
  ]);
  assert.deepEqual(calls[6]!.body, { role: 'viewer' });
  assert.deepEqual(calls[8]!.body, { userId: 'u2' });
});

test('moments/feed/tags 路径与查询参数', async () => {
  const { client, calls } = harness();
  await client.createMoment('c1', {
    type: 'text',
    content: 'hi',
    happenedAt: '2026-08-16T02:00:00.000Z',
    happenedTzOffset: -480,
  });
  await client.listChainMoments('c1', { cursor: 'cur', limit: 7 });
  await client.getMoment('m1');
  await client.updateMoment('m1', { content: 'new' });
  await client.deleteMoment('m1');
  await client.getFeed({ chainIds: ['c1', 'c2'], tagId: 't1', order: 'created_at', limit: 10, cursor: 'cur' });
  await client.listTags('c1');
  await client.createTag('c1', '周岁');
  await client.deleteTag('t1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST http://x/api/chains/c1/moments',
    'GET http://x/api/chains/c1/moments?cursor=cur&limit=7',
    'GET http://x/api/moments/m1',
    'PATCH http://x/api/moments/m1',
    'DELETE http://x/api/moments/m1',
    'GET http://x/api/feed?cursor=cur&chain_ids=c1%2Cc2&tag_id=t1&order=created_at&limit=10',
    'GET http://x/api/chains/c1/tags',
    'POST http://x/api/chains/c1/tags',
    'DELETE http://x/api/tags/t1',
  ]);
  assert.deepEqual(calls[0]!.body, {
    type: 'text',
    content: 'hi',
    happenedAt: '2026-08-16T02:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    mediaIds: [],
    kind: 'standard',
  });
  assert.deepEqual(calls[7]!.body, { name: '周岁' });
});

test('media/comments/reactions/notifications/devices 路径', async () => {
  const { client, calls } = harness();
  await client.presignMedia({ mime: 'image/jpeg', size: 1024, kind: 'image', sortOrder: 0 });
  await client.presignMediaParts('md1', [1, 2]);
  await client.completeMedia('md1', [{ partNumber: 1, etag: '"a"' }]);
  await client.abortMedia('md1');
  assert.equal(client.mediaUrl('md1'), 'http://x/api/media/md1');
  await client.listComments('m1');
  await client.createComment('m1', '好看');
  await client.deleteComment('cm1');
  await client.setReaction('m1', '❤️');
  await client.removeReaction('m1');
  await client.listNotifications(true);
  await client.markNotificationsRead(['n1']);
  await client.registerPushToken({ expoToken: 'ExponentPushToken[x]', platform: 'ios' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST http://x/api/media/presign',
    'POST http://x/api/media/md1/parts',
    'POST http://x/api/media/md1/complete',
    'POST http://x/api/media/md1/abort',
    'GET http://x/api/moments/m1/comments',
    'POST http://x/api/moments/m1/comments',
    'DELETE http://x/api/comments/cm1',
    'PUT http://x/api/moments/m1/reaction',
    'DELETE http://x/api/moments/m1/reaction',
    'GET http://x/api/notifications?unread=true',
    'POST http://x/api/notifications/read',
    'POST http://x/api/devices/push-token',
  ]);
  assert.deepEqual(calls[1]!.body, { partNumbers: [1, 2] });
  assert.deepEqual(calls[2]!.body, { parts: [{ partNumber: 1, etag: '"a"' }] });
  assert.deepEqual(calls[5]!.body, { content: '好看' });
  assert.deepEqual(calls[7]!.body, { emoji: '❤️' });
  assert.deepEqual(calls[10]!.body, { ids: ['n1'] });
  assert.deepEqual(calls[11]!.body, { expoToken: 'ExponentPushToken[x]', platform: 'ios' });
});

test('getFeed 空查询不带 query string', async () => {
  const { client, calls } = harness();
  await client.getFeed();
  assert.equal(calls[0]!.url, 'http://x/api/feed');
});

test('fetchMediaBlob 走稳定入口；listNotifications 带 cursor/limit 分页参数', async () => {
  const { client, calls } = harness();
  await client.fetchMediaBlob('md1');
  await client.listNotifications(true, { cursor: 'cur', limit: 50 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/media/md1',
    'GET http://x/api/notifications?unread=true&cursor=cur&limit=50',
  ]);
});

test('listChainMoments 将 dto items 映射为 moments', async () => {
  const client = createMomentClient({
    baseUrl: 'http://x',
    tokenStore: {
      getAccessToken: () => null,
      getRefreshToken: () => null,
      setTokens: () => {},
      clear: () => {},
    },
    fetchImpl: async (url) => {
      assert.match(String(url), /\/api\/chains\/c1\/moments$/);
      return new Response(JSON.stringify({ items: [{ id: 'm1' }], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const res = await client.listChainMoments('c1');
  assert.equal(res.moments[0]!.id, 'm1');
  assert.equal(res.nextCursor, null);
  assert.equal('items' in res, false);
});

test('feed before 与 month-index 路径/查询参数', async () => {
  const { client, calls } = harness();
  await client.getFeed({ before: '2026-09-01T00:00:00.000Z', order: 'happened_at', limit: 50 });
  await client.listChainMoments('c1', { before: '2026-09-01T00:00:00.000Z' });
  await client.getMonthIndex({ chainIds: ['c1', 'c2'], tagId: 't1', tzOffset: -480 });
  await client.getMonthIndex({ tzOffset: 0 });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET http://x/api/feed?order=happened_at&limit=50&before=2026-09-01T00%3A00%3A00.000Z',
      'GET http://x/api/chains/c1/moments?before=2026-09-01T00%3A00%3A00.000Z',
      'GET http://x/api/feed/month-index?chain_ids=c1%2Cc2&tag_id=t1&tz_offset=-480',
      'GET http://x/api/feed/month-index?tz_offset=0',
    ],
  );
});

test('getMemoriesToday 路径与 date 查询参数', async () => {
  const { client, calls } = harness();
  await client.getMemoriesToday('2026-08-18');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/memories/today?date=2026-08-18',
  ]);
});

describe('share 方法', () => {
  const anonTokenStore = {
    getAccessToken: () => null,
    getRefreshToken: () => null,
    setTokens: () => undefined,
    clear: () => undefined,
  };

  function capture(status: number, body: unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('createShareLink：POST /api/chains/:chainId/share-links', async () => {
    const dto = {
      id: 'sl-1',
      chainId: 'c-1',
      token: 'a'.repeat(64),
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-08-16T00:00:00.000Z',
    };
    const { calls, fetchImpl } = capture(201, dto);
    const client = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl });
    const res = await client.createShareLink('c-1', {});
    assert.equal(res.token, dto.token);
    assert.equal(calls[0]!.url, 'http://test.local/api/chains/c-1/share-links');
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {});
  });

  it('listShareLinks / revokeShareLink：GET 与 DELETE（204 → undefined）', async () => {
    const { calls, fetchImpl } = capture(200, { items: [] });
    const client = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl });
    const res = await client.listShareLinks('c-1');
    assert.deepEqual(res.items, []);
    assert.equal(calls[0]!.url, 'http://test.local/api/chains/c-1/share-links');
    assert.equal(calls[0]!.init?.method ?? 'GET', 'GET');

    const del = capture(204, undefined);
    const client2 = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl: del.fetchImpl });
    await assert.doesNotReject(() => client2.revokeShareLink('sl-1'));
    assert.equal(del.calls[0]!.url, 'http://test.local/api/share-links/sl-1');
    assert.equal(del.calls[0]!.init?.method, 'DELETE');
  });

  it('getPublicShare：skipAuth（无 Authorization），cursor 进 query', async () => {
    const body = { chain: { name: 'c', description: null }, moments: [], nextCursor: null };
    const { calls, fetchImpl } = capture(200, body);
    const client = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl });
    await client.getPublicShare('tok-1');
    assert.equal(calls[0]!.url, 'http://test.local/api/public/share/tok-1');
    assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, undefined);

    await client.getPublicShare('tok-1', 'cur/sor+1');
    assert.equal(calls[1]!.url, `http://test.local/api/public/share/tok-1?cursor=${encodeURIComponent('cur/sor+1')}`);
  });
});
