/**
 * E2E fixture CLI 唯一组装根（plan Task 14）：
 * 只有本文件 import config，把它交给纯契约 executeFixtureCli；
 * seeder 经动态 import 供给（守卫/凭据失败时不加载 DB/存储模块）。
 * 失败只映射到 process.exitCode，绝不 process.exit()。
 *
 * 用法（README 三终端约定）：
 *   MOMENT_E2E=1 node --loader ts-node/esm apps/server/src/e2e/fixture-cli.ts preflight|reset|seed|teardown
 */
import { config } from '../config.js';
import { executeFixtureCli } from './fixture-cli-contract.js';

await executeFixtureCli({
  argv: process.argv.slice(2),
  env: config,
  loadSeeder: () => import('./fixture-seeder.js'),
  writeStdout: (text) => {
    process.stdout.write(`${text}\n`);
  },
  writeStderr: (text) => {
    process.stderr.write(`${text}\n`);
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
