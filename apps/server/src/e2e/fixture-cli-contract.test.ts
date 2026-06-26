import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertE2eFixtureGuard,
  assertE2eStorageGuard,
  executeFixtureCli,
  parseFixtureAction,
  readE2eFixtureCredentials,
  runFixtureAction,
  type E2eFixtureEnv,
  type FixtureSeederModule,
} from './fixture-cli-contract.js';

/**
 * 纯契约测试（plan Task 14）：只 import fixture-cli-contract.ts。
 * 不 import config / fixture-seeder / db / storage / dotenv / 网络模块，
 * 因此 `env -i PATH="$PATH" node --loader ts-node/esm --test` 干净 shell 下可跑。
 */

const OWNER_PASSWORD = 'owner-pass-123';
const VIEWER_PASSWORD = 'viewer-pass-123';

function guardEnv(overrides: Partial<E2eFixtureEnv> = {}): E2eFixtureEnv {
  return {
    MOMENT_E2E: '1',
    NODE_ENV: 'test',
    MYSQL_DATABASE: 'moment_e2e',
    ATTACHMENT_S3_BUCKET: 'moment-e2e',
    ATTACHMENT_S3_ENDPOINT: 'http://127.0.0.1:9000',
    ATTACHMENT_S3_IS_PUBLIC: false,
    ...overrides,
  };
}

function credentialEnv(): E2eFixtureEnv {
  return {
    MOMENT_E2E_OWNER_EMAIL: 'owner.e2e@moment.invalid',
    MOMENT_E2E_OWNER_PASSWORD: OWNER_PASSWORD,
    MOMENT_E2E_VIEWER_EMAIL: 'viewer.e2e@moment.invalid',
    MOMENT_E2E_VIEWER_PASSWORD: VIEWER_PASSWORD,
  };
}

interface TraceSeeder extends FixtureSeederModule {
  trace: string[];
  failAction?: Error;
  failClose?: Error;
  seedResult?: Record<string, unknown>;
  receivedCredentials?: unknown;
}

function makeSeeder(overrides: Partial<TraceSeeder> = {}): TraceSeeder {
  const seeder: TraceSeeder = {
    trace: [],
    async resetFixture() {
      seeder.trace.push('action');
      if (seeder.failAction) throw seeder.failAction;
      return { ok: true };
    },
    async seedFixture(credentials) {
      seeder.trace.push('action');
      seeder.receivedCredentials = credentials;
      if (seeder.failAction) throw seeder.failAction;
      return seeder.seedResult ?? { ok: true };
    },
    async teardownFixture() {
      seeder.trace.push('action');
      if (seeder.failAction) throw seeder.failAction;
      return { ok: true };
    },
    async closeFixtureDb() {
      seeder.trace.push('close');
      if (seeder.failClose) throw seeder.failClose;
    },
    ...overrides,
  };
  return seeder;
}

interface HarnessResult {
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
  loadSeederCalls: number;
  seeder: TraceSeeder;
}

function makeHarness(options: { seeder?: TraceSeeder; failSerialize?: Error } = {}) {
  const seeder = options.seeder ?? makeSeeder();
  const result: HarnessResult = {
    stdout: [],
    stderr: [],
    exitCodes: [],
    loadSeederCalls: 0,
    seeder,
  };
  const harness = {
    result,
    seeder,
    loadSeeder: async (): Promise<FixtureSeederModule> => {
      result.loadSeederCalls += 1;
      return seeder;
    },
    serialize: (value: never): string => {
      seeder.trace.push('serialize');
      if (options.failSerialize) throw options.failSerialize;
      return JSON.stringify(value);
    },
    writeStdout: (text: string) => result.stdout.push(text),
    writeStderr: (text: string) => result.stderr.push(text),
    setExitCode: (code: number) => result.exitCodes.push(code),
  };
  return harness;
}

describe('parseFixtureAction', () => {
  test('accepts exactly one known action', () => {
    assert.equal(parseFixtureAction(['preflight']), 'preflight');
    assert.equal(parseFixtureAction(['reset']), 'reset');
    assert.equal(parseFixtureAction(['seed']), 'seed');
    assert.equal(parseFixtureAction(['teardown']), 'teardown');
  });

  test('rejects a missing action', () => {
    assert.throws(() => parseFixtureAction([]), /action/i);
  });

  test('rejects extra arguments', () => {
    assert.throws(() => parseFixtureAction(['seed', 'extra']), /action/i);
  });

  test('rejects an unknown action', () => {
    assert.throws(() => parseFixtureAction(['destroy']), /action/i);
    assert.throws(() => parseFixtureAction(['SEED']), /action/i);
  });
});

describe('assertE2eFixtureGuard', () => {
  test('accepts the exact e2e guard environment', () => {
    assert.doesNotThrow(() => assertE2eFixtureGuard(guardEnv()));
  });

  test('rejects when MOMENT_E2E is not exactly "1"', () => {
    const { MOMENT_E2E: _omit, ...missing } = guardEnv();
    assert.throws(() => assertE2eFixtureGuard(missing));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ MOMENT_E2E: '0' })));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ MOMENT_E2E: 'true' })));
  });

  test('rejects when NODE_ENV is not test', () => {
    const { NODE_ENV: _omit, ...missing } = guardEnv();
    assert.throws(() => assertE2eFixtureGuard(missing));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ NODE_ENV: 'development' })));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ NODE_ENV: 'production' })));
  });

  test('rejects when MYSQL_DATABASE is missing or not exactly moment_e2e', () => {
    const { MYSQL_DATABASE: _omit, ...missing } = guardEnv();
    assert.throws(() => assertE2eFixtureGuard(missing));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ MYSQL_DATABASE: 'moment_e2e_extra' })));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ MYSQL_DATABASE: 'other_e2e' })));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ MYSQL_DATABASE: 'moment_dev' })));
    assert.throws(() => assertE2eFixtureGuard(guardEnv({ MYSQL_DATABASE: 'MOMENT_E2E' })));
  });
});

describe('assertE2eStorageGuard', () => {
  test('accepts the exact private loopback bucket', () => {
    assert.doesNotThrow(() => assertE2eStorageGuard(guardEnv()));
    assert.doesNotThrow(() =>
      assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_ENDPOINT: 'http://localhost:9000' })),
    );
    assert.doesNotThrow(() =>
      assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_ENDPOINT: 'http://[::1]:9000' })),
    );
  });

  test('rejects a non-moment-e2e bucket', () => {
    const { ATTACHMENT_S3_BUCKET: _omit, ...missing } = guardEnv();
    assert.throws(() => assertE2eStorageGuard(missing));
    assert.throws(() => assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_BUCKET: 'moment-dev' })));
    assert.throws(() => assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_BUCKET: 'moment-e2e-extra' })));
  });

  test('rejects a missing, non-loopback or https endpoint', () => {
    const { ATTACHMENT_S3_ENDPOINT: _omit, ...missing } = guardEnv();
    assert.throws(() => assertE2eStorageGuard(missing));
    assert.throws(() =>
      assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_ENDPOINT: 'https://127.0.0.1:9000' })),
    );
    assert.throws(() =>
      assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_ENDPOINT: 'http://192.168.1.10:9000' })),
    );
    assert.throws(() =>
      assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_ENDPOINT: 'http://minio.internal:9000' })),
    );
    assert.throws(() => assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_ENDPOINT: 'not-a-url' })));
  });

  test('rejects a public bucket', () => {
    assert.throws(() => assertE2eStorageGuard(guardEnv({ ATTACHMENT_S3_IS_PUBLIC: true })));
    const { ATTACHMENT_S3_IS_PUBLIC: _omit, ...missing } = guardEnv();
    assert.throws(() => assertE2eStorageGuard(missing));
  });
});

describe('readE2eFixtureCredentials', () => {
  test('returns both credential pairs from a complete environment', () => {
    assert.deepEqual(readE2eFixtureCredentials(credentialEnv()), {
      owner: { email: 'owner.e2e@moment.invalid', password: OWNER_PASSWORD },
      viewer: { email: 'viewer.e2e@moment.invalid', password: VIEWER_PASSWORD },
    });
  });

  test('rejects each missing, empty or invalid credential', () => {
    const complete = credentialEnv();
    const keys = [
      'MOMENT_E2E_OWNER_EMAIL',
      'MOMENT_E2E_OWNER_PASSWORD',
      'MOMENT_E2E_VIEWER_EMAIL',
      'MOMENT_E2E_VIEWER_PASSWORD',
    ] as const;
    for (const key of keys) {
      const missing = { ...complete };
      delete missing[key];
      assert.throws(() => readE2eFixtureCredentials(missing), new RegExp(key));
      assert.throws(() => readE2eFixtureCredentials({ ...complete, [key]: '' }), new RegExp(key));
    }
    assert.throws(
      () => readE2eFixtureCredentials({ ...complete, MOMENT_E2E_OWNER_EMAIL: 'not-an-email' }),
      /MOMENT_E2E_OWNER_EMAIL/,
    );
    assert.throws(
      () => readE2eFixtureCredentials({ ...complete, MOMENT_E2E_VIEWER_EMAIL: 'viewer@' }),
      /MOMENT_E2E_VIEWER_EMAIL/,
    );
    assert.throws(
      () => readE2eFixtureCredentials({ ...complete, MOMENT_E2E_OWNER_PASSWORD: 'short' }),
      /MOMENT_E2E_OWNER_PASSWORD/,
    );
  });
});

describe('runFixtureAction', () => {
  test('preflight returns fixed JSON without loading the seeder', async () => {
    const harness = makeHarness();
    const text = await runFixtureAction('preflight', undefined, {
      loadSeeder: harness.loadSeeder,
      serialize: harness.serialize,
    });
    assert.equal(text, JSON.stringify({ mode: 'e2e', database: 'moment_e2e' }));
    assert.equal(harness.result.loadSeederCalls, 0);
    // preflight 只序列化固定 JSON：无 action、无 close。
    assert.deepEqual(harness.seeder.trace, ['serialize']);
  });

  test('reset/teardown run action → serialize → close exactly once', async () => {
    for (const action of ['reset', 'teardown'] as const) {
      const harness = makeHarness();
      const text = await runFixtureAction(action, undefined, {
        loadSeeder: harness.loadSeeder,
        serialize: harness.serialize,
      });
      assert.equal(text, '{"ok":true}');
      assert.deepEqual(harness.seeder.trace, ['action', 'serialize', 'close']);
      assert.equal(harness.result.loadSeederCalls, 1);
    }
  });

  test('seed passes credentials to the seeder and serializes the password-free result', async () => {
    const seedResult = { owner: { id: 'owner-id', email: 'owner.e2e@moment.invalid' } };
    const harness = makeHarness({ seeder: makeSeeder({ seedResult }) });
    const credentials = readE2eFixtureCredentials(credentialEnv());
    const text = await runFixtureAction('seed', credentials, {
      loadSeeder: harness.loadSeeder,
      serialize: harness.serialize,
    });
    assert.deepEqual(harness.seeder.receivedCredentials, credentials);
    assert.equal(text, JSON.stringify(seedResult));
    assert.ok(!text.includes(OWNER_PASSWORD));
    assert.ok(!text.includes(VIEWER_PASSWORD));
    assert.deepEqual(harness.seeder.trace, ['action', 'serialize', 'close']);
  });

  test('action failure still closes exactly once and rethrows', async () => {
    const harness = makeHarness({ seeder: makeSeeder({ failAction: new Error('db down') }) });
    await assert.rejects(
      runFixtureAction('reset', undefined, {
        loadSeeder: harness.loadSeeder,
        serialize: harness.serialize,
      }),
      /db down/,
    );
    assert.deepEqual(harness.seeder.trace, ['action', 'close']);
  });

  test('serializer failure still closes exactly once and rethrows', async () => {
    const harness = makeHarness({ failSerialize: new Error('boom serialize') });
    await assert.rejects(
      runFixtureAction('reset', undefined, {
        loadSeeder: harness.loadSeeder,
        serialize: harness.serialize,
      }),
      /boom serialize/,
    );
    assert.deepEqual(harness.seeder.trace, ['action', 'serialize', 'close']);
  });

  test('closer failure is fatal even when the action succeeded', async () => {
    const harness = makeHarness({ seeder: makeSeeder({ failClose: new Error('pool leak') }) });
    await assert.rejects(
      runFixtureAction('reset', undefined, {
        loadSeeder: harness.loadSeeder,
        serialize: harness.serialize,
      }),
      /pool leak/,
    );
    assert.deepEqual(harness.seeder.trace, ['action', 'serialize', 'close']);
  });

  test('closer failure stays fatal when the action also failed', async () => {
    const harness = makeHarness({
      seeder: makeSeeder({ failAction: new Error('db down'), failClose: new Error('pool leak') }),
    });
    await assert.rejects(
      runFixtureAction('reset', undefined, {
        loadSeeder: harness.loadSeeder,
        serialize: harness.serialize,
      }),
      /pool leak/,
    );
    assert.deepEqual(harness.seeder.trace, ['action', 'close']);
  });
});

describe('executeFixtureCli', () => {
  test('preflight succeeds without credentials, prints exact JSON, never loads the seeder', async () => {
    const harness = makeHarness();
    await executeFixtureCli({
      argv: ['preflight'],
      env: guardEnv(),
      loadSeeder: harness.loadSeeder,
      writeStdout: harness.writeStdout,
      writeStderr: harness.writeStderr,
      setExitCode: harness.setExitCode,
    });
    assert.deepEqual(harness.result.stdout, [JSON.stringify({ mode: 'e2e', database: 'moment_e2e' })]);
    assert.deepEqual(harness.result.stderr, []);
    assert.deepEqual(harness.result.exitCodes, []);
    assert.equal(harness.result.loadSeederCalls, 0);
  });

  test('reset and teardown succeed without any credential variables', async () => {
    for (const action of ['reset', 'teardown'] as const) {
      const harness = makeHarness();
      await executeFixtureCli({
        argv: [action],
        env: guardEnv(),
        loadSeeder: harness.loadSeeder,
        writeStdout: harness.writeStdout,
        writeStderr: harness.writeStderr,
        setExitCode: harness.setExitCode,
      });
      assert.deepEqual(harness.result.stdout, ['{"ok":true}']);
      assert.deepEqual(harness.result.exitCodes, []);
      // executeFixtureCli 自带 JSON.stringify：trace 只含 action/close，close 仍恰好一次且在序列化后。
      assert.deepEqual(harness.seeder.trace, ['action', 'close']);
    }
  });

  test('seed succeeds with complete credentials and emits no password on stdout', async () => {
    const seedResult = {
      owner: { id: '00000000-0000-4000-8000-000000000011', email: 'owner.e2e@moment.invalid', nickname: '林晓满' },
    };
    const harness = makeHarness({ seeder: makeSeeder({ seedResult }) });
    await executeFixtureCli({
      argv: ['seed'],
      env: guardEnv(credentialEnv()),
      loadSeeder: harness.loadSeeder,
      writeStdout: harness.writeStdout,
      writeStderr: harness.writeStderr,
      setExitCode: harness.setExitCode,
    });
    assert.deepEqual(harness.result.exitCodes, []);
    assert.equal(harness.result.stdout.length, 1);
    const out = harness.result.stdout[0]!;
    assert.deepEqual(JSON.parse(out), seedResult);
    assert.ok(!out.includes(OWNER_PASSWORD));
    assert.ok(!out.includes(VIEWER_PASSWORD));
  });

  test('only seed rejects missing/empty/invalid credentials, before loadSeeder', async () => {
    const complete = credentialEnv();
    const { MOMENT_E2E_VIEWER_EMAIL: _viewerEmail, ...withoutViewerEmail } = complete;
    const scenarios: E2eFixtureEnv[] = [
      {},
      { ...complete, MOMENT_E2E_OWNER_PASSWORD: '' },
      { ...complete, MOMENT_E2E_OWNER_EMAIL: 'not-an-email' },
      { ...complete, MOMENT_E2E_OWNER_PASSWORD: 'short' },
      withoutViewerEmail,
      { ...complete, MOMENT_E2E_VIEWER_PASSWORD: '' },
    ];
    for (const scenario of scenarios) {
      const harness = makeHarness();
      await executeFixtureCli({
        argv: ['seed'],
        env: guardEnv(scenario),
        loadSeeder: harness.loadSeeder,
        writeStdout: harness.writeStdout,
        writeStderr: harness.writeStderr,
        setExitCode: harness.setExitCode,
      });
      assert.equal(harness.result.loadSeederCalls, 0, `loadSeeder must not run for ${JSON.stringify(scenario)}`);
      assert.deepEqual(harness.result.exitCodes, [1]);
      assert.equal(harness.result.stdout.length, 0);
      assert.equal(harness.result.stderr.length, 1);
    }
  });

  test('each absent or invalid database guard member rejects before the seeder runs', async () => {
    const { MOMENT_E2E: _a, NODE_ENV: _b, MYSQL_DATABASE: _c, ...rest } = guardEnv();
    const badEnvs: E2eFixtureEnv[] = [
      guardEnv({ MOMENT_E2E: '0' }),
      guardEnv({ NODE_ENV: 'development' }),
      guardEnv({ MYSQL_DATABASE: 'other_e2e' }),
      guardEnv({ MYSQL_DATABASE: 'moment_e2e_extra' }),
      { ...rest },
    ];
    for (const env of badEnvs) {
      const harness = makeHarness();
      await executeFixtureCli({
        argv: ['reset'],
        env,
        loadSeeder: harness.loadSeeder,
        writeStdout: harness.writeStdout,
        writeStderr: harness.writeStderr,
        setExitCode: harness.setExitCode,
      });
      assert.equal(harness.result.loadSeederCalls, 0);
      assert.deepEqual(harness.result.exitCodes, [1]);
      assert.equal(harness.result.stdout.length, 0);
    }
  });

  test('each unsafe storage value rejects before the seeder runs', async () => {
    const badEnvs: E2eFixtureEnv[] = [
      guardEnv({ ATTACHMENT_S3_BUCKET: 'moment-dev' }),
      guardEnv({ ATTACHMENT_S3_ENDPOINT: 'https://127.0.0.1:9000' }),
      guardEnv({ ATTACHMENT_S3_ENDPOINT: 'http://10.0.0.8:9000' }),
      guardEnv({ ATTACHMENT_S3_IS_PUBLIC: true }),
    ];
    for (const env of badEnvs) {
      const harness = makeHarness();
      await executeFixtureCli({
        argv: ['reset'],
        env,
        loadSeeder: harness.loadSeeder,
        writeStdout: harness.writeStdout,
        writeStderr: harness.writeStderr,
        setExitCode: harness.setExitCode,
      });
      assert.equal(harness.result.loadSeederCalls, 0);
      assert.deepEqual(harness.result.exitCodes, [1]);
      assert.equal(harness.result.stdout.length, 0);
    }
  });

  test('argument errors set exit code 1 without touching the seeder', async () => {
    for (const argv of [[], ['seed', 'extra'], ['unknown']] as const) {
      const harness = makeHarness();
      await executeFixtureCli({
        argv,
        env: guardEnv(credentialEnv()),
        loadSeeder: harness.loadSeeder,
        writeStdout: harness.writeStdout,
        writeStderr: harness.writeStderr,
        setExitCode: harness.setExitCode,
      });
      assert.equal(harness.result.loadSeederCalls, 0);
      assert.deepEqual(harness.result.exitCodes, [1]);
    }
  });

  test('seeder failure maps to exit code 1 with a sanitized stderr', async () => {
    const harness = makeHarness({
      seeder: makeSeeder({ failAction: new Error(`insert failed for ${OWNER_PASSWORD}`) }),
    });
    await executeFixtureCli({
      argv: ['seed'],
      env: guardEnv(credentialEnv()),
      loadSeeder: harness.loadSeeder,
      writeStdout: harness.writeStdout,
      writeStderr: harness.writeStderr,
      setExitCode: harness.setExitCode,
    });
    assert.deepEqual(harness.result.exitCodes, [1]);
    assert.equal(harness.result.stdout.length, 0);
    assert.equal(harness.result.stderr.length, 1);
    const err = harness.result.stderr[0]!;
    assert.ok(!err.includes(OWNER_PASSWORD), 'stderr must redact credential values');
    assert.ok(!err.includes(VIEWER_PASSWORD), 'stderr must redact credential values');
  });

  test('closer failure is fatal and surfaces through stderr + exit code 1', async () => {
    const harness = makeHarness({ seeder: makeSeeder({ failClose: new Error('pool leak') }) });
    await executeFixtureCli({
      argv: ['teardown'],
      env: guardEnv(),
      loadSeeder: harness.loadSeeder,
      writeStdout: harness.writeStdout,
      writeStderr: harness.writeStderr,
      setExitCode: harness.setExitCode,
    });
    assert.deepEqual(harness.result.exitCodes, [1]);
    assert.ok(harness.result.stderr[0]!.includes('pool leak'));
    assert.deepEqual(harness.seeder.trace, ['action', 'close']);
  });
});
