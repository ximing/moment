/**
 * CSI bridge（plan Task 14）：固定 daemon http://127.0.0.1:10088，
 * 每个操作先 GET /status 预检 extension_connected，再 POST /command，
 * envelope 精确为 { action, args, session: 'e2e-web-design-system-refactor' }。
 * fetch 可注入（契约测试用 stub，绝不触达真实 daemon/Chrome）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const CSI_DAEMON_URL = 'http://127.0.0.1:10088';
export const CSI_SESSION = 'e2e-web-design-system-refactor';

export const PIXELMATCH_THRESHOLD = 0.1;
export const MAX_DIFF_PIXELS = 120;

/**
 * 固定的网络静默探针（随 bridge 导出，fetch-stub 契约测试按字面量断言）：
 * 观察 suite 安装的在途 fetch/XHR 计数器，pending 归零并保持 500 ms 后才返回 true。
 */
export const WAIT_FOR_NETWORK_IDLE_SCRIPT = `(() => {
  const state = window.__e2eNetworkIdle;
  if (!state) return false;
  if (state.pending > 0) return false;
  return Date.now() - state.lastChangeAt >= 500;
})()`;

const defaultArtifactsDir = fileURLToPath(new URL('../artifacts/', import.meta.url));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBridge({
  fetchImpl = globalThis.fetch,
  daemonUrl = CSI_DAEMON_URL,
  session = CSI_SESSION,
  artifactsDir = defaultArtifactsDir,
  networkIdle = { intervalMs: 120, timeoutMs: 20000 },
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('E2E_BRIDGE: a fetch implementation is required');
  }

  async function ensureExtensionConnected() {
    let response;
    try {
      response = await fetchImpl(`${daemonUrl}/status`);
    } catch (error) {
      throw new Error(
        `E2E_BRIDGE: CSI daemon unreachable at ${daemonUrl} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const body = await response.json();
    if (body?.extension_connected !== true) {
      throw new Error('E2E_BRIDGE: CSI extension is not connected (GET /status extension_connected !== true)');
    }
  }

  async function request(action, args = {}) {
    await ensureExtensionConnected();
    const response = await fetchImpl(`${daemonUrl}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, args, session }),
    });
    const body = await response.json();
    if (body?.success !== true) {
      throw new Error(`E2E_BRIDGE: CSI action '${action}' failed: ${body?.error ?? 'unknown error'}`);
    }
    return body.data;
  }

  function unwrapEvaluate(data) {
    if (data !== null && typeof data === 'object' && 'value' in data) return data.value;
    return data;
  }

  return {
    request,

    async open(url) {
      // 隐藏标签页里 requestAnimationFrame 被 Chrome 节流（E2E 探针实证：
      // visibilityState=hidden 时 rAF 永不回调），导航后必须恢复到前台。
      const result = await request('navigate', { url });
      await request('cdp', { method: 'Page.bringToFront', params: {} });
      return result;
    },

    click(selector) {
      return request('click', { selector });
    },

    press(keys, repeat) {
      return request('send_keys', { keys, ...(repeat === undefined ? {} : { repeat }) });
    },

    fill(selector, value) {
      return request('fill', { selector, value });
    },

    async evaluate(code) {
      return unwrapEvaluate(await request('evaluate', { code }));
    },

    screenshot(path) {
      return request('screenshot', { format: 'png', path });
    },

    setViewport(width, height) {
      return request('cdp', {
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width, height, deviceScaleFactor: 1, mobile: false },
      });
    },

    setPageScaleFactor(scale) {
      return request('cdp', {
        method: 'Emulation.setPageScaleFactor',
        params: { pageScaleFactor: scale },
      });
    },

    async waitForNetworkIdle() {
      const deadline = Date.now() + networkIdle.timeoutMs;
      for (;;) {
        const idle = unwrapEvaluate(await request('evaluate', { code: WAIT_FOR_NETWORK_IDLE_SCRIPT }));
        if (idle === true) return;
        if (Date.now() > deadline) {
          throw new Error('E2E_BRIDGE: network idle timeout (no 500 ms quiet window)');
        }
        await sleep(networkIdle.intervalMs);
      }
    },

    /**
     * 本地像素比较（不经 CSI）：pixelmatch 阈值 0.1，diff 证据写入 artifacts。
     * 返回 { diffPixels, diffPath, withinTolerance }；尺寸不一致直接拒绝。
     */
    async comparePng({ baselinePath, actualPath, threshold = PIXELMATCH_THRESHOLD, maxDiffPixels = MAX_DIFF_PIXELS, diffPath }) {
      const [baselineRaw, actualRaw] = await Promise.all([readFile(baselinePath), readFile(actualPath)]);
      const baseline = PNG.sync.read(baselineRaw);
      const actual = PNG.sync.read(actualRaw);
      if (baseline.width !== actual.width || baseline.height !== actual.height) {
        throw new Error(
          `E2E_BRIDGE: PNG dimension mismatch (baseline ${baseline.width}x${baseline.height}, actual ${actual.width}x${actual.height})`,
        );
      }
      const diff = new PNG({ width: baseline.width, height: baseline.height });
      const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, baseline.width, baseline.height, {
        threshold,
      });
      const resolvedDiffPath =
        diffPath ??
        path.join(
          artifactsDir,
          `${path.basename(actualPath, '.png')}.diff.png`,
        );
      await mkdir(path.dirname(resolvedDiffPath), { recursive: true });
      await writeFile(resolvedDiffPath, PNG.sync.write(diff));
      return { diffPixels, diffPath: resolvedDiffPath, withinTolerance: diffPixels <= maxDiffPixels };
    },
  };
}
