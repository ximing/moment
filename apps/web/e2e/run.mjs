/**
 * E2E runner（plan Task 14）：
 *   node e2e/run.mjs design-system-regression [--update-baselines]
 *
 * 只接受套件名 + 可选 --update-baselines，其余参数一律拒绝。
 * 流程：环境守卫 → 就绪等待 → reset → seed → suite → try/finally teardown
 * （正常、失败、中断、--update-baselines 运行都会 teardown）。
 * 全程使用唯一的 CSI session e2e-web-design-system-refactor。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createBridge, CSI_SESSION } from './lib/bridge.mjs';
import { assertE2eEnvironment, waitForReadiness } from './lib/env.mjs';
import { loadBaselineManifest } from './lib/manifest.mjs';
import { seed as runSeedAction } from './fixtures/seed.mjs';

const SUITE_NAME = 'design-system-regression';

function usage() {
  return `usage: node e2e/run.mjs ${SUITE_NAME} [--update-baselines]`;
}

function parseArgs(argv) {
  const [suite, ...rest] = argv;
  if (suite !== SUITE_NAME) throw new Error(`unknown suite '${suite ?? ''}'\n${usage()}`);
  let updateBaselines = false;
  for (const flag of rest) {
    if (flag === '--update-baselines') {
      if (updateBaselines) throw new Error(`duplicate --update-baselines\n${usage()}`);
      updateBaselines = true;
    } else {
      throw new Error(`unknown argument '${flag}'\n${usage()}`);
    }
  }
  return { suite, updateBaselines };
}

async function main() {
  const { updateBaselines } = parseArgs(process.argv.slice(2));

  // 口令直接来自 runner 本地环境，绝不来自任何子进程 stdout。
  const env = assertE2eEnvironment();
  await waitForReadiness({ apiBaseUrl: env.apiBaseUrl, webBaseUrl: env.webBaseUrl });

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactsDir = fileURLToPath(new URL(`./artifacts/${runId}/`, import.meta.url));
  await mkdir(artifactsDir, { recursive: true });

  const bridge = createBridge({ artifactsDir });
  const manifest = await loadBaselineManifest();

  let interrupted = null;
  const onSignal = (signal) => {
    interrupted = interrupted ?? signal;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let suiteError = null;
  try {
    await runSeedAction({ action: 'reset' });
    const fixture = await runSeedAction({ action: 'seed' });
    const suite = await import('./suites/design-system-regression.mjs');
    const report = await suite.run({
      bridge,
      env,
      fixture,
      manifest,
      updateBaselines,
      artifactsDir,
      runId,
      session: CSI_SESSION,
      shouldStop: () => interrupted !== null,
    });
    await writeFile(
      path.join(artifactsDir, 'report.json'),
      `${JSON.stringify({ runId, updateBaselines, ...report }, null, 2)}\n`,
    );
    if (report.failed > 0) {
      suiteError = new Error(`${report.failed} of ${report.total} baseline case(s) failed; see ${artifactsDir}`);
    }
  } catch (error) {
    suiteError = error;
  } finally {
    // teardown 总是执行；teardown 失败同样致命。
    try {
      await runSeedAction({ action: 'teardown' });
    } catch (teardownError) {
      if (suiteError) {
        suiteError.message = `${suiteError.message} (teardown also failed: ${
          teardownError instanceof Error ? teardownError.message : String(teardownError)
        })`;
      } else {
        suiteError = teardownError;
      }
    }
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  if (interrupted !== null && suiteError === null) {
    suiteError = new Error(`interrupted by ${interrupted}`);
  }
  if (suiteError) throw suiteError;
  process.stdout.write(`design-system-regression OK (runId ${runId}${updateBaselines ? ', baselines updated' : ''})\n`);
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { parseArgs };
