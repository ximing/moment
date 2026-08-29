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
  await client.createChain({ name: '链', visibility: 'private', template: 'daily' });
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
  await client.reorderChains({ chainIds: ['c2', 'c1'] });
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
    'PUT http://x/api/chains/order',
  ]);
  assert.deepEqual(calls[6]!.body, { role: 'viewer' });
  assert.deepEqual(calls[8]!.body, { userId: 'u2' });
  assert.deepEqual(calls[13]!.body, { chainIds: ['c2', 'c1'] });
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

test('discardMedia：DELETE /api/media/:id', async () => {
  const { client, calls } = harness();
  await client.discardMedia('md1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['DELETE http://x/api/media/md1']);
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

test('persons 资源路由与 body（people-place P2 契约；幂等 create 201/200 body 同形，client 不区分）', async () => {
  const { client, calls } = harness();
  await client.listPersons('c1');
  await client.createPerson('c1', { name: '外婆' });
  await client.createPerson('c1', { name: '爸爸', userId: 'u1' });
  await client.renamePerson('c1', 'p1', { name: '姥姥' });
  await client.removePerson('c1', 'p1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/chains/c1/persons',
    'POST http://x/api/chains/c1/persons',
    'POST http://x/api/chains/c1/persons',
    'PATCH http://x/api/chains/c1/persons/p1',
    'DELETE http://x/api/chains/c1/persons/p1',
  ]);
  assert.deepEqual(calls[1]!.body, { name: '外婆' });
  assert.deepEqual(calls[2]!.body, { name: '爸爸', userId: 'u1' });
  assert.deepEqual(calls[3]!.body, { name: '姥姥' });
});

test('moments create/update 携带 personIds/place（P1 dto 增量经 ZodInput/PatchMomentInput 类型直达，api-client 不改写）', async () => {
  const { client, calls } = harness();
  await client.createMoment('c1', {
    type: 'text',
    content: 'hi',
    happenedAt: '2026-08-16T02:00:00.000Z',
    happenedTzOffset: -480,
    personIds: ['123e4567-e89b-12d3-a456-426614174000'],
    place: { lat: 39.9042, lng: 116.4074 },
  });
  await client.updateMoment('m1', { personIds: [], place: null });
  const createBody = calls[0]!.body as { personIds?: string[]; place?: unknown };
  assert.deepEqual(createBody.personIds, ['123e4567-e89b-12d3-a456-426614174000']);
  assert.deepEqual(createBody.place, { lat: 39.9042, lng: 116.4074 });
  assert.deepEqual(calls[1]!.body, { personIds: [], place: null });
});

test('getFeed / listChainMoments 序列化 personId/place/happenedFrom/happenedTo 为 snake_case', async () => {
  const { client, calls } = harness();
  await client.getFeed({
    personId: '123e4567-e89b-12d3-a456-426614174000',
    place: '朝阳公园',
    happenedFrom: '2026-08-01T00:00:00.000Z',
    happenedTo: '2026-08-31T23:59:59.999Z',
    limit: 50,
  });
  await client.listChainMoments('c1', {
    personId: '123e4567-e89b-12d3-a456-426614174000',
    place: '朝阳公园',
    happenedFrom: '2026-08-01T00:00:00.000Z',
    happenedTo: '2026-08-31T23:59:59.999Z',
  });
  assert.equal(
    calls[0]!.url,
    'http://x/api/feed?limit=50&person_id=123e4567-e89b-12d3-a456-426614174000&place=%E6%9C%9D%E9%98%B3%E5%85%AC%E5%9B%AD&happened_from=2026-08-01T00%3A00%3A00.000Z&happened_to=2026-08-31T23%3A59%3A59.999Z',
  );
  assert.equal(
    calls[1]!.url,
    'http://x/api/chains/c1/moments?person_id=123e4567-e89b-12d3-a456-426614174000&place=%E6%9C%9D%E9%98%B3%E5%85%AC%E5%9B%AD&happened_from=2026-08-01T00%3A00%3A00.000Z&happened_to=2026-08-31T23%3A59%3A59.999Z',
  );
});

test('searchMoments：POST /api/search JSON body（不走 query string；不带 before/order/source）', async () => {
  const { client, calls } = harness();
  await client.searchMoments({
    q: '去年今天和外婆',
    tzOffset: -480,
    chainIds: ['123e4567-e89b-12d3-a456-426614174000'],
    personId: '123e4567-e89b-12d3-a456-426614174001',
    tagId: '123e4567-e89b-12d3-a456-426614174002',
    place: '朝阳公园',
    limit: 50,
    cursor: 'cur',
  });
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.url, 'http://x/api/search');
  assert.deepEqual(calls[0]!.body, {
    q: '去年今天和外婆',
    tzOffset: -480,
    chainIds: ['123e4567-e89b-12d3-a456-426614174000'],
    personId: '123e4567-e89b-12d3-a456-426614174001',
    tagId: '123e4567-e89b-12d3-a456-426614174002',
    place: '朝阳公园',
    limit: 50,
    cursor: 'cur',
  });
  assert.equal('before' in (calls[0]!.body as object), false);
  assert.equal('order' in (calls[0]!.body as object), false);
  assert.equal('source' in (calls[0]!.body as object), false);
});

test('listChainJobs：GET /api/chains/:chainId/jobs；query 可选 status/limit', async () => {
  const { client, calls } = harness();
  await client.listChainJobs('c1');
  await client.listChainJobs('c1', { status: 'pending,failed', limit: 50 });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET http://x/api/chains/c1/jobs',
      'GET http://x/api/chains/c1/jobs?status=pending%2Cfailed&limit=50',
    ],
  );
});

test('mediaUrl / fetchMediaBlob：variant + st 拼接（已有 ? 则 &st=）', async () => {
  const { client, calls } = harness();
  assert.equal(client.mediaUrl('md1'), 'http://x/api/media/md1');
  assert.equal(client.mediaUrl('md1', { variant: 'original' }), 'http://x/api/media/md1');
  assert.equal(client.mediaUrl('md1', { variant: 'derived' }), 'http://x/api/media/md1?variant=derived');
  assert.equal(client.mediaUrl('md1', { st: 'tok en' }), 'http://x/api/media/md1?st=tok%20en');
  assert.equal(
    client.mediaUrl('md1', { variant: 'derived', st: 'tok en' }),
    'http://x/api/media/md1?variant=derived&st=tok%20en',
  );
  await client.fetchMediaBlob('md1');
  await client.fetchMediaBlob('md1', { variant: 'original' });
  await client.fetchMediaBlob('md1', { variant: 'derived' });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET http://x/api/media/md1',
      'GET http://x/api/media/md1',
      'GET http://x/api/media/md1?variant=derived',
    ],
  );
});
