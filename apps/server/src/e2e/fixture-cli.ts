/**
 * E2E fixture CLI 唯一组装根（plan Task 14）：
 * 只有本文件 import config，把它交给纯契约 executeFixtureCli；
 * seeder 经动态 import 供给（守卫/凭据失败时不加载 DB/存储模块）。
 * 失败只映射到 process.exitCode，绝不 process.exit()。
 *
 * 用法（README 三终端约定）：
 *   MOMENT_E2E=1 node --loader ts-node/esm apps/server/src/e2e/fixture-cli.ts preflight|reset|seed|teardown
 *
 * stdout 契约：仅一行结果 JSON。logger 在模块加载时捕获 LOG_LEVEL 决定最小级别，
 * 非 error 级走 console.log（stdout）会污染该契约，故必须在任何 server 模块
 * （config/seeder→storage/db→logger）求值之前压低级别——因此 config 走动态 import，
 * 不能留在静态 import（ESM 提升会在本语句之前先求值静态依赖）。
 */
process.env.LOG_LEVEL ??= 'error';

const { config } = await import('../config.js');
const { executeFixtureCli } = await import('./fixture-cli-contract.js');

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
