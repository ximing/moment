import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthTokens } from '@moment/dto';
import { ApiError, Http, type TokenStore } from './http.js';

function memoryStore(tokens?: AuthTokens): TokenStore & { tokens: AuthTokens | null; cleared: boolean } {
  const store = {
    tokens: tokens ?? null,
    cleared: false,
    getAccessToken() {
      return store.tokens?.accessToken ?? null;
    },
    getRefreshToken() {
      return store.tokens?.refreshToken ?? null;
    },
    setTokens(t: AuthTokens) {
      store.tokens = t;
    },
    clear() {
      store.tokens = null;
      store.cleared = true;
    },
  };
  return store;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('自动附带 Bearer token；成功解析 JSON', async () => {
  const store = memoryStore({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
  const calls: { url: string; init: RequestInit }[] = [];
  const http = new Http({
    baseUrl: 'http://x',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, { ok: 1 });
    },
  });
  const data = await http.request<{ ok: number }>('/api/ping');
  assert.equal(data.ok, 1);
  assert.equal(calls[0]!.url, 'http://x/api/ping');
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer a1');
});

test('query 参数拼接（跳过 undefined）；无 token 时不带 Authorization', async () => {
  const store = memoryStore();
  let url = '';
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (u) => {
      url = String(u);
      return jsonResponse(200, {});
    },
  });
  await http.request('/api/feed', { query: { cursor: undefined, limit: 7, order: 'created_at' } });
  assert.equal(url, '/api/feed?limit=7&order=created_at');
});

test('401 → refresh 一次 → 用新 token 重放原请求成功', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  const apiCalls: string[] = [];
  const refreshCalls: string[] = [];
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      const u = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (u === '/api/auth/refresh') {
        refreshCalls.push(auth);
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      apiCalls.push(`${u} ${auth}`);
      if (auth === 'Bearer expired') return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      return jsonResponse(200, { value: 42 });
    },
  });
  const data = await http.request<{ value: number }>('/api/feed');
  assert.equal(data.value, 42);
  assert.deepEqual(refreshCalls, ['']); // refresh 本身不带 Authorization
  assert.deepEqual(apiCalls, ['/api/feed Bearer expired', '/api/feed Bearer new']);
  assert.equal(store.tokens?.refreshToken, 'r2'); // setTokens 已写入
});

test('并发两个 401 请求只触发一次 refresh（单飞）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  let refreshCount = 0;
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      const u = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (u === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      if (auth !== 'Bearer new') return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      return jsonResponse(200, { ok: true });
    },
  });
  await Promise.all([http.request('/api/chains'), http.request('/api/feed')]);
  assert.equal(refreshCount, 1);
});

test('refresh 失败 → clear() 并抛 ApiError（含服务端 code/status）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'dead', expiresIn: 900 });
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url) => {
      if (String(url) === '/api/auth/refresh') {
        return jsonResponse(401, { error: { code: 'REFRESH_TOKEN_REUSED', message: '复用' } });
      }
      return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/feed'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'REFRESH_TOKEN_REUSED');
      assert.equal(err.status, 401);
      assert.equal(err.message, '复用');
      return true;
    }
  );
  assert.equal(store.cleared, true);
  assert.equal(store.tokens, null);
});

test('无 refreshToken 时 401 直接抛（clear 不误删未登录态以外的状态）', async () => {
  const store = memoryStore(); // 无 token
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () => jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }),
  });
  await assert.rejects(() => http.request('/api/feed'), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_TOKEN');
});

test('skipAuthRefresh 的请求 401 不走 refresh，直接抛 ApiError', async () => {
  const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
  let refreshCount = 0;
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url) => {
      if (String(url) === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(200, {});
      }
      return jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: '凭据错误' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/auth/login', { method: 'POST', skipAuthRefresh: true }),
    (e: unknown) => e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
  );
  assert.equal(refreshCount, 0);
});

test('业务错误透传 code/message/status/details；204 返回 undefined', async () => {
  const store = memoryStore();
  let status = 403;
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () => {
      if (status === 403) {
        status = 204;
        return jsonResponse(403, {
          error: { code: 'CHAIN_ROLE_INSUFFICIENT', message: '角色不足', details: { role: 'viewer' } },
        });
      }
      return new Response(null, { status: 204 });
    },
  });
  await assert.rejects(
    () => http.request('/api/chains/c1', { method: 'PATCH' }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, 'CHAIN_ROLE_INSUFFICIENT');
      assert.equal(e.status, 403);
      assert.deepEqual(e.details, { role: 'viewer' });
      return true;
    }
  );
  const none = await http.request<void>('/api/chains/c1', { method: 'DELETE' });
  assert.equal(none, undefined);
});

test('网络失败/非 JSON 错误体 → NETWORK_ERROR / 降级 message', async () => {
  const store = memoryStore();
  const failing = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(
    () => failing.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'NETWORK_ERROR' && e.status === 0
  );

  const html = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () =>
      new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  });
  await assert.rejects(
    () => html.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'HTTP_502' && e.status === 502
  );
});

test('重放后仍 401 → clear + 抛 ApiError（只重放一次）', async () => {
  const store = memoryStore({ accessToken: 'bad', refreshToken: 'r', expiresIn: 900 });
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url) => {
      if (String(url) === '/api/auth/refresh') {
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'still-bad', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'INVALID_TOKEN'
  );
  assert.equal(store.cleared, true);
});

test('refresh 成功后重放收到 403 → 不 clear，直接抛 ApiError（非 401 ≠ 登录态失效）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      const u = String(url);
      if (u === '/api/auth/refresh') {
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (auth === 'Bearer expired') return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      return jsonResponse(403, { error: { code: 'CHAIN_ROLE_INSUFFICIENT', message: '角色不足' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'CHAIN_ROLE_INSUFFICIENT'
  );
  assert.equal(store.cleared, false); // 业务 403 不误清登录态
  assert.equal(store.tokens?.accessToken, 'new'); // refresh 写入的新 token 仍在
});
