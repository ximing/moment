import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Jest globalSetup does not apply moduleNameMapper, so we cannot import `../src/db/index.js`. */
export default function globalSetup(): void {
  // SKIP_GLOBAL_MIGRATE=1：迁移验证测试（tests/migrations/，自带本地 docker 临时 schema）
  // 必须先于任何远程 migrate 执行（spec chain-ordering §2「先验证再跑迁移」）——
  // 不设守卫的话本 globalSetup 会先把被测迁移应用到远程共享测试库（hash 落库），验证闸门形同虚设。
  if (process.env.SKIP_GLOBAL_MIGRATE === '1') return;
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync('pnpm', ['migrate'], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });
}
