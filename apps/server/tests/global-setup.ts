import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Jest globalSetup does not apply moduleNameMapper, so we cannot import `../src/db/index.js`. */
export default function globalSetup(): void {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync('pnpm', ['migrate'], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });
}
