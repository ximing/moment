/**
 * Web 侧唯一 seed/reset 生产者（plan Task 14）：
 * execFile 调 server fixture CLI；每个写动作前先跑凭据无关的 preflight 子进程，
 * 要求精确 { mode: 'e2e', database: 'moment_e2e' }；只解析 JSON stdout；
 * 失败只暴露 action/status，绝不暴露 stderr 或任何秘密。
 * 只有 action === 'seed' 读取四个 fixture 凭据。
 *
 * CLI：MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs reset|seed|teardown
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertGuardedE2eEnv } from '../lib/env.mjs';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export const fixtureCliPath = fileURLToPath(new URL('../../../server/src/e2e/fixture-cli.ts', import.meta.url));

const SEED_ACTIONS = Object.freeze(['reset', 'seed', 'teardown']);
const EXPECTED_PREFLIGHT = Object.freeze({ mode: 'e2e', database: 'moment_e2e' });

function fail(message) {
  throw new Error(`E2E_SEED: ${message}`);
}

function execFileAsync(execFileImpl, execPath, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(execPath, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

async function runChild({ execFileImpl, execPath, root, cliPath, env, action }) {
  try {
    const { stdout } = await execFileAsync(
      execFileImpl,
      execPath,
      ['--loader', 'ts-node/esm', cliPath, action],
      { cwd: root, env },
    );
    return stdout;
  } catch (error) {
    // 只暴露 action/status：stderr 可能带环境细节，绝不外泄。
    const status = error && typeof error.code !== 'undefined' ? String(error.code) : 'unknown';
    fail(`fixture CLI action '${action}' failed with status ${status}`);
  }
}

function parseJsonStdout(stdout, action) {
  try {
    return JSON.parse(String(stdout).trim());
  } catch {
    fail(`fixture CLI action '${action}' did not emit JSON on stdout (status 0 but unparsable)`);
  }
}

/**
 * @param {{ action: string, env?: object, execFileImpl?: Function, execPath?: string,
 *           repoRoot?: string, cliPath?: string }} options
 * @returns {Promise<object>} seed 时为 DesignSystemFixture；reset/teardown 为 { ok: true }
 */
export async function runSeedAction({
  action,
  env = process.env,
  execFileImpl = nodeExecFile,
  execPath = process.execPath,
  repoRoot: root = repoRoot,
  cliPath = fixtureCliPath,
}) {
  if (!SEED_ACTIONS.includes(action)) {
    fail(`unknown action '${action}' (expected ${SEED_ACTIONS.join('|')})`);
  }
  // 守卫先行（含 base URL loopback+端口校验）；仅 seed 读取凭据。
  assertGuardedE2eEnv(env, { requireCredentials: action === 'seed' });

  const child = { execFileImpl, execPath, root, cliPath, env };
  // 每个写动作前先跑一次凭据无关的 preflight。
  const preflight = parseJsonStdout(await runChild({ ...child, action: 'preflight' }), 'preflight');
  if (
    preflight === null ||
    typeof preflight !== 'object' ||
    preflight.mode !== EXPECTED_PREFLIGHT.mode ||
    preflight.database !== EXPECTED_PREFLIGHT.database ||
    Object.keys(preflight).length !== 2
  ) {
    fail(`preflight mismatch: expected exactly ${JSON.stringify(EXPECTED_PREFLIGHT)}`);
  }
  return parseJsonStdout(await runChild({ ...child, action }), action);
}

/** runner 调用面：只接受 reset | seed | teardown。 */
export async function seed({ action }) {
  return runSeedAction({ action });
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const [action] = process.argv.slice(2);
  try {
    const result = await runSeedAction({ action });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
