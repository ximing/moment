import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { PNG } from 'pngjs';

import {
  createBridge,
  CSI_DAEMON_URL,
  CSI_SESSION,
  WAIT_FOR_NETWORK_IDLE_SCRIPT,
} from './bridge.mjs';

/**
 * bridge.mjs 纯测试（plan Task 14）：注入 fetch stub，断言状态预检、
 * CSI envelope、action 映射表与 comparePng 行为。永不触达 127.0.0.1:10088
 * 或真实 Chrome。
 */

const tmpRoot = await mkdtemp(path.join(tmpdir(), 'moment-e2e-bridge-'));
after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** fetch stub：记录请求，按队列/默认响应回放。 */
function fakeFetch({ statusBody = { extension_connected: true }, commandResponses = [] } = {}) {
  const requests = [];
  const queue = [...commandResponses];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (method === 'GET') return jsonResponse(statusBody);
    const next = queue.length > 0 ? queue.shift() : { success: true, data: null };
    if (next instanceof Error) throw next;
    return jsonResponse(next);
  };
  return { requests, fetchImpl };
}

function commandCalls(requests) {
  return requests.filter((request) => request.method === 'POST');
}

describe('bridge status preflight and envelope', () => {
  test('every operation preflights GET /status then POSTs /command', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.open('http://127.0.0.1:5173/login');
    // open = navigate + Page.bringToFront（后台标签 rAF 节流修复），各一次 preflight+command
    assert.equal(requests.length, 4);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, `${CSI_DAEMON_URL}/status`);
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].url, `${CSI_DAEMON_URL}/command`);
    assert.equal(requests[2].method, 'GET');
    assert.equal(requests[3].method, 'POST');
    assert.deepEqual(commandCalls(requests)[1].body, {
      action: 'cdp',
      args: { method: 'Page.bringToFront', params: {} },
      session: CSI_SESSION,
    });
    assert.equal(CSI_DAEMON_URL, 'http://127.0.0.1:10088');
  });

  test('rejects before the command when the extension is not connected', async () => {
    const { requests, fetchImpl } = fakeFetch({ statusBody: { extension_connected: false } });
    const bridge = createBridge({ fetchImpl });
    await assert.rejects(bridge.open('http://127.0.0.1:5173/'), /extension/i);
    assert.equal(commandCalls(requests).length, 0);
  });

  test('command body is exactly { action, args, session } with the fixed session', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.click('button');
    const [call] = commandCalls(requests);
    assert.deepEqual(Object.keys(call.body).sort(), ['action', 'args', 'session']);
    assert.equal(call.body.session, 'e2e-web-design-system-refactor');
    assert.equal(CSI_SESSION, 'e2e-web-design-system-refactor');
  });

  test('{ success: true, data } resolves to data; { success: false, error } rejects', async () => {
    const { fetchImpl } = fakeFetch({
      commandResponses: [
        { success: true, data: { url: 'http://127.0.0.1:5173/' } },
        { success: true, data: {} },
        { success: false, error: 'no tab' },
      ],
    });
    const bridge = createBridge({ fetchImpl });
    const data = await bridge.open('http://127.0.0.1:5173/');
    assert.deepEqual(data, { url: 'http://127.0.0.1:5173/' });
    await assert.rejects(bridge.open('http://127.0.0.1:5173/'), /no tab/);
  });
});

describe('bridge action map', () => {
  test('open maps to navigate with the exact args', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.open('http://127.0.0.1:5173/login');
    assert.deepEqual(commandCalls(requests)[0].body, {
      action: 'navigate',
      args: { url: 'http://127.0.0.1:5173/login' },
      session: CSI_SESSION,
    });
  });

  test('click and fill map with exact args', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.click('input[name="email"]');
    await bridge.fill('input[name="email"]', 'viewer.e2e@moment.invalid');
    const [clickCall, fillCall] = commandCalls(requests);
    assert.deepEqual(clickCall.body, { action: 'click', args: { selector: 'input[name="email"]' }, session: CSI_SESSION });
    assert.deepEqual(fillCall.body, {
      action: 'fill',
      args: { selector: 'input[name="email"]', value: 'viewer.e2e@moment.invalid' },
      session: CSI_SESSION,
    });
  });

  test('press maps to send_keys and omits repeat unless given', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.press('Enter');
    await bridge.press('Tab', 3);
    const [single, repeated] = commandCalls(requests);
    assert.deepEqual(single.body, { action: 'send_keys', args: { keys: 'Enter' }, session: CSI_SESSION });
    assert.deepEqual(repeated.body, {
      action: 'send_keys',
      args: { keys: 'Tab', repeat: 3 },
      session: CSI_SESSION,
    });
  });

  test('evaluate and screenshot map with exact args', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.evaluate('document.title');
    await bridge.screenshot('/tmp/shot.png');
    const [evaluateCall, screenshotCall] = commandCalls(requests);
    assert.deepEqual(evaluateCall.body, {
      action: 'evaluate',
      args: { code: 'document.title' },
      session: CSI_SESSION,
    });
    assert.deepEqual(screenshotCall.body, {
      action: 'screenshot',
      args: { format: 'png', path: '/tmp/shot.png' },
      session: CSI_SESSION,
    });
  });

  test('both viewport operations map to cdp with exact method and params', async () => {
    const { requests, fetchImpl } = fakeFetch();
    const bridge = createBridge({ fetchImpl });
    await bridge.setViewport(390, 844);
    await bridge.setPageScaleFactor(2);
    const [viewportCall, scaleCall] = commandCalls(requests);
    assert.deepEqual(viewportCall.body, {
      action: 'cdp',
      args: {
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 390, height: 844, deviceScaleFactor: 1, mobile: false },
      },
      session: CSI_SESSION,
    });
    assert.deepEqual(scaleCall.body, {
      action: 'cdp',
      args: { method: 'Emulation.setPageScaleFactor', params: { pageScaleFactor: 2 } },
      session: CSI_SESSION,
    });
  });

  test('waitForNetworkIdle polls evaluate with the fixed script until stable', async () => {
    const { requests, fetchImpl } = fakeFetch({
      commandResponses: [
        { success: true, data: { type: 'boolean', value: false } },
        { success: true, data: { type: 'boolean', value: false } },
        { success: true, data: { type: 'boolean', value: true } },
      ],
    });
    const bridge = createBridge({ fetchImpl, networkIdle: { intervalMs: 1, timeoutMs: 5000 } });
    await bridge.waitForNetworkIdle();
    const polls = commandCalls(requests);
    assert.equal(polls.length, 3);
    for (const poll of polls) {
      assert.deepEqual(poll.body, {
        action: 'evaluate',
        args: { code: WAIT_FOR_NETWORK_IDLE_SCRIPT },
        session: CSI_SESSION,
      });
    }
    assert.equal(typeof WAIT_FOR_NETWORK_IDLE_SCRIPT, 'string');
    assert.match(WAIT_FOR_NETWORK_IDLE_SCRIPT, /500/);
  });

  test('waitForNetworkIdle times out when the page never idles', async () => {
    const { fetchImpl } = fakeFetch({
      commandResponses: Array.from({ length: 50 }, () => ({
        success: true,
        data: { type: 'boolean', value: false },
      })),
    });
    const bridge = createBridge({ fetchImpl, networkIdle: { intervalMs: 1, timeoutMs: 25 } });
    await assert.rejects(bridge.waitForNetworkIdle(), /idle|timeout/i);
  });
});

describe('bridge.comparePng', () => {
  function makePng(width, height, fill) {
    const png = new PNG({ width, height });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = fill[0];
      png.data[i + 1] = fill[1];
      png.data[i + 2] = fill[2];
      png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  }

  test('identical images diff to zero pixels and still write a diff artifact', async () => {
    const dir = await mkdtemp(path.join(tmpRoot, 'same-'));
    const baselinePath = path.join(dir, 'baseline.png');
    const actualPath = path.join(dir, 'actual.png');
    await writeFile(baselinePath, makePng(8, 8, [10, 20, 30]));
    await writeFile(actualPath, makePng(8, 8, [10, 20, 30]));
    const bridge = createBridge({ fetchImpl: fakeFetch().fetchImpl, artifactsDir: dir });
    const result = await bridge.comparePng({
      baselinePath,
      actualPath,
      threshold: 0.1,
      maxDiffPixels: 120,
    });
    assert.equal(result.diffPixels, 0);
    assert.equal(result.withinTolerance, true);
    const diff = await readFile(result.diffPath);
    assert.equal(diff.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(result.diffPath.startsWith(dir));
  });

  test('different images report the pixel count and tolerance verdict', async () => {
    const dir = await mkdtemp(path.join(tmpRoot, 'diff-'));
    const baselinePath = path.join(dir, 'baseline.png');
    const actualPath = path.join(dir, 'actual.png');
    await writeFile(baselinePath, makePng(8, 8, [0, 0, 0]));
    await writeFile(actualPath, makePng(8, 8, [255, 255, 255]));
    const bridge = createBridge({ fetchImpl: fakeFetch().fetchImpl, artifactsDir: dir });
    const result = await bridge.comparePng({
      baselinePath,
      actualPath,
      threshold: 0.1,
      maxDiffPixels: 10,
    });
    assert.equal(result.diffPixels, 64);
    assert.equal(result.withinTolerance, false);
    const tolerated = await bridge.comparePng({
      baselinePath,
      actualPath,
      threshold: 0.1,
      maxDiffPixels: 120,
    });
    assert.equal(tolerated.diffPixels, 64);
    assert.equal(tolerated.withinTolerance, true);
  });

  test('dimension mismatch rejects instead of comparing', async () => {
    const dir = await mkdtemp(path.join(tmpRoot, 'size-'));
    const baselinePath = path.join(dir, 'baseline.png');
    const actualPath = path.join(dir, 'actual.png');
    await writeFile(baselinePath, makePng(8, 8, [0, 0, 0]));
    await writeFile(actualPath, makePng(4, 4, [0, 0, 0]));
    const bridge = createBridge({ fetchImpl: fakeFetch().fetchImpl, artifactsDir: dir });
    await assert.rejects(
      bridge.comparePng({ baselinePath, actualPath, threshold: 0.1, maxDiffPixels: 120 }),
      /dimension|size/i,
    );
  });
});
