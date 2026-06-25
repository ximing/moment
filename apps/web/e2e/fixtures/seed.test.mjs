import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runSeedAction } from './seed.mjs';

/**
 * seed.mjs 纯测试（plan Task 14）：注入 execFile fake，不创建子进程、
 * 不连 DB / S3 / 网络。验证守卫、凭据作用域、preflight → action 子进程序列、
 * 以及 stdout / 错误消息永不携带口令。
 */

const OWNER_PASSWORD = 'owner-pass-123';
const VIEWER_PASSWORD = 'viewer-pass-123';

const EXPECTED_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EXPECTED_CLI_PATH = fileURLToPath(new URL('../../../server/src/e2e/fixture-cli.ts', import.meta.url));

const SEED_RESULT = {
  owner: { id: '00000000-0000-4000-8000-000000000011', email: 'owner.e2e@moment.invalid', nickname: '林晓满' },
  viewer: { id: '00000000-0000-4000-8000-000000000012', email: 'viewer.e2e@moment.invalid', nickname: '周小禾' },
  chainId: '00000000-0000-4000-8000-000000000014',
};

function guardEnv(overrides = {}) {
  return {
    MOMENT_E2E: '1',
    NODE_ENV: 'test',
    MYSQL_DATABASE: 'moment_e2e',
    ATTACHMENT_S3_BUCKET: 'moment-e2e',
    ATTACHMENT_S3_ENDPOINT: 'http://127.0.0.1:9000',
    ATTACHMENT_S3_IS_PUBLIC: 'false',
    ...overrides,
  };
}

function credentialEnv() {
  return {
    MOMENT_E2E_OWNER_EMAIL: 'owner.e2e@moment.invalid',
    MOMENT_E2E_OWNER_PASSWORD: OWNER_PASSWORD,
    MOMENT_E2E_VIEWER_EMAIL: 'viewer.e2e@moment.invalid',
    MOMENT_E2E_VIEWER_PASSWORD: VIEWER_PASSWORD,
  };
}

/** execFile fake：记录调用并按 action 回放缓冲。 */
function fakeExecFile({ responses = {}, onCall } = {}) {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    const action = args[args.length - 1];
    calls.push({ file, args, options });
    onCall?.(action);
    const response = responses[action] ?? { stdout: JSON.stringify({ ok: true }) };
    queueMicrotask(() =>
      callback(response.error ?? null, response.stdout ?? '', response.stderr ?? ''),
    );
  };
  return { calls, execFileImpl };
}

function okPreflightResponses(extra = {}) {
  return {
    preflight: { stdout: JSON.stringify({ mode: 'e2e', database: 'moment_e2e' }) },
    ...extra,
  };
}

function run(action, env, execFileImpl) {
  return runSeedAction({ action, env, execFileImpl });
}

describe('runSeedAction guards', () => {
  test('reset and teardown run without any fixture credentials', async () => {
    for (const action of ['reset', 'teardown']) {
      const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
      const result = await run(action, guardEnv(), execFileImpl);
      assert.deepEqual(result, { ok: true });
      // 每个写动作前先跑一次凭据无关的 preflight 子进程。
      assert.deepEqual(
        calls.map((call) => call.args[call.args.length - 1]),
        ['preflight', action],
      );
      assert.equal(calls[0].file, process.execPath);
      assert.deepEqual(calls[0].args.slice(0, 2), ['--loader', 'ts-node/esm']);
      assert.equal(calls[0].args[2], EXPECTED_CLI_PATH);
      assert.equal(calls[0].options.cwd, EXPECTED_REPO_ROOT);
      assert.equal(calls[0].options.env.MYSQL_DATABASE, 'moment_e2e');
    }
  });

  test('seed without credentials rejects before any child call', async () => {
    const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
    await assert.rejects(run('seed', guardEnv(), execFileImpl), /MOMENT_E2E_OWNER_EMAIL/);
    assert.equal(calls.length, 0);
  });

  test('seed with complete credentials succeeds and exposes no password', async () => {
    const { calls, execFileImpl } = fakeExecFile({
      responses: okPreflightResponses({ seed: { stdout: JSON.stringify(SEED_RESULT) } }),
    });
    const result = await run('seed', guardEnv(credentialEnv()), execFileImpl);
    assert.deepEqual(result, SEED_RESULT);
    assert.deepEqual(
      calls.map((call) => call.args[call.args.length - 1]),
      ['preflight', 'seed'],
    );
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(OWNER_PASSWORD));
    assert.ok(!serialized.includes(VIEWER_PASSWORD));
  });

  test('each missing guard member rejects before any child call', async () => {
    const badEnvs = [
      guardEnv({ MOMENT_E2E: '0' }),
      guardEnv({ MOMENT_E2E: undefined }),
      guardEnv({ NODE_ENV: 'development' }),
      guardEnv({ MYSQL_DATABASE: 'moment_dev' }),
      guardEnv({ MYSQL_DATABASE: 'other_e2e' }),
      guardEnv({ MYSQL_DATABASE: 'moment_e2e_extra' }),
    ];
    for (const env of badEnvs) {
      for (const action of ['reset', 'seed', 'teardown']) {
        const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
        await assert.rejects(run(action, { ...env, ...credentialEnv() }, execFileImpl));
        assert.equal(calls.length, 0, `no child for ${action} with ${JSON.stringify(env)}`);
      }
    }
  });

  test('unsafe storage values reject before any child call', async () => {
    const badEnvs = [
      guardEnv({ ATTACHMENT_S3_BUCKET: 'moment-dev' }),
      guardEnv({ ATTACHMENT_S3_BUCKET: undefined }),
      guardEnv({ ATTACHMENT_S3_ENDPOINT: 'https://127.0.0.1:9000' }),
      guardEnv({ ATTACHMENT_S3_ENDPOINT: 'http://10.0.0.8:9000' }),
      guardEnv({ ATTACHMENT_S3_ENDPOINT: 'not-a-url' }),
      guardEnv({ ATTACHMENT_S3_IS_PUBLIC: 'true' }),
      guardEnv({ ATTACHMENT_S3_IS_PUBLIC: undefined }),
    ];
    for (const env of badEnvs) {
      for (const action of ['reset', 'seed', 'teardown']) {
        const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
        await assert.rejects(run(action, { ...env, ...credentialEnv() }, execFileImpl));
        assert.equal(calls.length, 0, `no child for ${action} with ${JSON.stringify(env)}`);
      }
    }
  });

  test('non-loopback or wrong-port base URLs reject before any child call', async () => {
    const badEnvs = [
      guardEnv({ E2E_API_BASE_URL: 'http://192.168.1.5:3000/api' }),
      guardEnv({ E2E_API_BASE_URL: 'http://127.0.0.1:3001/api' }),
      guardEnv({ E2E_API_BASE_URL: 'https://127.0.0.1:3000/api' }),
      guardEnv({ E2E_WEB_BASE_URL: 'http://127.0.0.1:5174' }),
      guardEnv({ E2E_WEB_BASE_URL: 'http://example.com:5173' }),
      guardEnv({ E2E_WEB_BASE_URL: 'not-a-url' }),
    ];
    for (const env of badEnvs) {
      for (const action of ['reset', 'seed', 'teardown']) {
        const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
        await assert.rejects(run(action, { ...env, ...credentialEnv() }, execFileImpl));
        assert.equal(calls.length, 0, `no child for ${action} with ${JSON.stringify(env)}`);
      }
    }
  });

  test('loopback aliases on the exact ports pass the base-URL guard', async () => {
    const env = guardEnv({
      ...credentialEnv(),
      E2E_API_BASE_URL: 'http://localhost:3000/api',
      E2E_WEB_BASE_URL: 'http://[::1]:5173',
    });
    const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
    const result = await run('reset', env, execFileImpl);
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
  });
});

describe('runSeedAction child protocol', () => {
  test('a preflight mismatch rejects before the requested action runs', async () => {
    const { calls, execFileImpl } = fakeExecFile({
      responses: { preflight: { stdout: JSON.stringify({ mode: 'e2e', database: 'moment_dev' }) } },
    });
    await assert.rejects(run('reset', guardEnv(), execFileImpl), /preflight/);
    assert.deepEqual(
      calls.map((call) => call.args[call.args.length - 1]),
      ['preflight'],
    );
  });

  test('non-JSON stdout rejects without running further children', async () => {
    const { calls, execFileImpl } = fakeExecFile({
      responses: { preflight: { stdout: 'not json at all' } },
    });
    await assert.rejects(run('reset', guardEnv(), execFileImpl));
    assert.equal(calls.length, 1);
  });

  test('a nonzero child status exposes only action and status, never stderr or secrets', async () => {
    const failure = new Error('Command failed');
    failure.code = 7;
    const { execFileImpl } = fakeExecFile({
      responses: {
        preflight: { stdout: JSON.stringify({ mode: 'e2e', database: 'moment_e2e' }) },
        seed: { error: failure, stderr: `db refused ${OWNER_PASSWORD}` },
      },
    });
    const error = await run('seed', guardEnv(credentialEnv()), execFileImpl).catch((caught) => caught);
    assert.ok(error instanceof Error);
    assert.match(error.message, /seed/);
    assert.match(error.message, /7/);
    assert.ok(!error.message.includes(OWNER_PASSWORD), 'error must not leak stderr/secrets');
    assert.ok(!error.message.includes('db refused'), 'error must not leak child stderr');
  });

  test('unknown or extra actions reject before any child call', async () => {
    for (const action of ['destroy', 'preflight', 'seed now', '']) {
      const { calls, execFileImpl } = fakeExecFile({ responses: okPreflightResponses() });
      await assert.rejects(run(action, guardEnv(credentialEnv()), execFileImpl), /action/);
      assert.equal(calls.length, 0, `no child for action ${JSON.stringify(action)}`);
    }
  });
});
