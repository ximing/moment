/**
 * Web E2E 环境守卫与等待原语（plan Task 14）。
 * owner/viewer 口令只来自 runner 的本地环境变量，绝不来自 CLI stdout。
 */

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000/api';
export const DEFAULT_WEB_BASE_URL = 'http://127.0.0.1:5173';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

function fail(message) {
  throw new Error(`E2E_ENV: ${message}`);
}

function assertLoopbackHttpUrl(raw, name, expectedPort) {
  const value = raw ?? '';
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid URL`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    fail(`${name} must be an http loopback URL (127.0.0.1|localhost|[::1])`);
  }
  if (url.port !== expectedPort) {
    fail(`${name} must use port ${expectedPort}`);
  }
  return value.replace(/\/$/, '');
}

/**
 * 共享守卫：MOMENT_E2E=1、NODE_ENV=test、MYSQL_DATABASE 整串精确 moment_e2e、
 * 私有 loopback 桶、loopback 且端口精确 3000/5173 的 base URL。
 * requireCredentials 时额外校验四个 fixture 凭据（仅 seed / runner 需要）。
 */
export function assertGuardedE2eEnv(env, { requireCredentials = false } = {}) {
  if (env.MOMENT_E2E !== '1') fail("MOMENT_E2E must be exactly '1'");
  if (env.NODE_ENV !== 'test') fail("NODE_ENV must be exactly 'test'");
  if (env.MYSQL_DATABASE !== 'moment_e2e') fail("MYSQL_DATABASE must be exactly 'moment_e2e'");
  if (env.ATTACHMENT_S3_BUCKET !== 'moment-e2e') fail("ATTACHMENT_S3_BUCKET must be exactly 'moment-e2e'");
  const endpoint = env.ATTACHMENT_S3_ENDPOINT;
  if (endpoint === undefined || endpoint === '') fail('ATTACHMENT_S3_ENDPOINT is required');
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    fail('ATTACHMENT_S3_ENDPOINT must be a valid URL');
  }
  if (endpointUrl.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(endpointUrl.hostname)) {
    fail('ATTACHMENT_S3_ENDPOINT must be an http loopback URL (127.0.0.1|localhost|[::1])');
  }
  if (env.ATTACHMENT_S3_IS_PUBLIC !== 'false') fail("ATTACHMENT_S3_IS_PUBLIC must be exactly 'false'");

  const apiBaseUrl = assertLoopbackHttpUrl(env.E2E_API_BASE_URL ?? DEFAULT_API_BASE_URL, 'E2E_API_BASE_URL', '3000');
  const webBaseUrl = assertLoopbackHttpUrl(env.E2E_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL, 'E2E_WEB_BASE_URL', '5173');

  const result = { apiBaseUrl, webBaseUrl };
  if (requireCredentials) {
    for (const [emailKey, passwordKey, target] of [
      ['MOMENT_E2E_OWNER_EMAIL', 'MOMENT_E2E_OWNER_PASSWORD', 'owner'],
      ['MOMENT_E2E_VIEWER_EMAIL', 'MOMENT_E2E_VIEWER_PASSWORD', 'viewer'],
    ]) {
      const email = env[emailKey];
      if (email === undefined || email === '' || !EMAIL_PATTERN.test(email)) {
        fail(`${emailKey} must be a valid email`);
      }
      const password = env[passwordKey];
      if (password === undefined || password.length < PASSWORD_MIN_LENGTH) {
        fail(`${passwordKey} must be at least ${PASSWORD_MIN_LENGTH} characters`);
      }
      result[target] = { email, password };
    }
  }
  return result;
}

/**
 * runner 入口守卫：返回 WebE2eEnvironment。
 * 口令直接读 runner 本地环境，永不经任何子进程 stdout。
 */
export function assertE2eEnvironment(env = process.env) {
  const guarded = assertGuardedE2eEnv(env, { requireCredentials: true });
  return {
    apiBaseUrl: guarded.apiBaseUrl,
    webBaseUrl: guarded.webBaseUrl,
    ownerEmail: guarded.owner.email,
    ownerPassword: guarded.owner.password,
    viewerEmail: guarded.viewer.email,
    viewerPassword: guarded.viewer.password,
  };
}

/** 等待 server /api/health 与 web dev server 就绪（只在 runner 真实运行时调用）。 */
export async function waitForReadiness({
  apiBaseUrl,
  webBaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
  intervalMs = 250,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const probe = async (url, accept) => {
    try {
      const response = await fetchImpl(url);
      return accept(response);
    } catch {
      return false;
    }
  };
  for (;;) {
    const apiReady = await probe(`${apiBaseUrl}/health`, async (response) => {
      if (!response.ok) return false;
      const text = await response.text();
      return text.includes('"status":"ok"');
    });
    const webReady = await probe(webBaseUrl, (response) => response.ok);
    if (apiReady && webReady) return;
    if (Date.now() > deadline) {
      fail(`readiness timeout (apiReady=${apiReady}, webReady=${webReady})`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 视觉静默：document.fonts.ready、已渲染图片/视频海报 decode 完成、
 * 布局后两个 requestAnimationFrame 帧，然后交给 bridge 的 500 ms 无在途请求轮询。
 */
export const VISUAL_IDLE_SCRIPT = `(async () => {
  await document.fonts.ready;
  const images = Array.from(document.images ?? []);
  await Promise.all(
    images.map((img) => {
      // blob: 图片的 decode() 在本 CSI/Chrome 组合下可能永不 settle（E2E 探针实证），
      // complete + naturalWidth > 0 已证明解码完成，直接采信。
      if (img.complete && img.naturalWidth > 0) return undefined;
      return new Promise((resolve) => {
        img.addEventListener('load', () => resolve(undefined), { once: true });
        img.addEventListener('error', () => resolve(undefined), { once: true });
      });
    }),
  );
  const videos = Array.from(document.querySelectorAll('video'));
  await Promise.all(
    videos.map((video) => (video.readyState >= 2 ? undefined : new Promise((resolve) => {
      video.addEventListener('loadeddata', () => resolve(undefined), { once: true });
      video.addEventListener('error', () => resolve(undefined), { once: true });
    }))),
  );
  // 后台/被抢占标签页 rAF 永不回调；bringToFront 在隐藏标签上也不保证生效。
  // 用 rAF 与 800ms 竞速：可见时两帧即 resolve，隐藏时按超时放行（截图语义由
  // fonts/decode/network-idle 保证，rAF 仅作布局缓冲）。
  await Promise.race([
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))),
    new Promise((resolve) => setTimeout(resolve, 800)),
  ]);
  return true;
})()`;

export async function waitForVisualIdle(bridge) {
  // 多 session 共享同一物理标签页时，本标签随时可能被抢回后台
  //（hidden 下 requestAnimationFrame 永不回调），每次视觉等待前重确认前台。
  await bridge.bringToFront();
  await bridge.evaluate(VISUAL_IDLE_SCRIPT);
  await bridge.waitForNetworkIdle();
}
