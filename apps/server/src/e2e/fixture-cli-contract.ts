/**
 * E2E fixture CLI 纯契约（plan Task 14）：
 * 本模块不 import config / db / storage / fixture-seeder，不做任何 IO；
 * 所有环境、seeder、序列化器、stdout/stderr/exitCode 全部依赖注入。
 * 因此干净 shell（env -i）下的契约测试不会解析仓库配置，也不会打开 MySQL/S3。
 */

/** 契约只声明自己读取的字段；config 等更宽对象可结构式赋入。 */
export interface E2eFixtureEnv {
  MOMENT_E2E?: string | undefined;
  NODE_ENV?: string | undefined;
  MYSQL_DATABASE?: string | undefined;
  ATTACHMENT_S3_BUCKET?: string | undefined;
  ATTACHMENT_S3_ENDPOINT?: string | undefined;
  ATTACHMENT_S3_IS_PUBLIC?: boolean | undefined;
  MOMENT_E2E_OWNER_EMAIL?: string | undefined;
  MOMENT_E2E_OWNER_PASSWORD?: string | undefined;
  MOMENT_E2E_VIEWER_EMAIL?: string | undefined;
  MOMENT_E2E_VIEWER_PASSWORD?: string | undefined;
}

export interface E2eFixtureCredentials {
  owner: { email: string; password: string };
  viewer: { email: string; password: string };
}

export type FixtureAction = 'preflight' | 'reset' | 'seed' | 'teardown';

export interface E2ePreflightResult {
  mode: 'e2e';
  database: 'moment_e2e';
}

export type E2eCliResult = E2ePreflightResult | { readonly ok: true } | Record<string, unknown>;

/** fixture-seeder.ts 的结构化面：契约只依赖这个形状，不 import 实现。 */
export interface FixtureSeederModule {
  resetFixture(): Promise<{ ok: true }>;
  seedFixture(credentials: E2eFixtureCredentials): Promise<Record<string, unknown>>;
  teardownFixture(): Promise<{ ok: true }>;
  closeFixtureDb(): Promise<void>;
}

const FIXTURE_ACTIONS: readonly FixtureAction[] = ['preflight', 'reset', 'seed', 'teardown'];

/** 注册同款最小长度（dto auth registerSchema: min 8 / max 72）。 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function parseFixtureAction(argv: readonly string[]): FixtureAction {
  if (argv.length !== 1) {
    throw new Error(
      `E2E_FIXTURE_ACTION: expected exactly one action (${FIXTURE_ACTIONS.join('|')}), got ${argv.length} arguments`,
    );
  }
  const [candidate] = argv;
  if (!FIXTURE_ACTIONS.includes(candidate as FixtureAction)) {
    throw new Error(
      `E2E_FIXTURE_ACTION: unknown action '${candidate}' (expected ${FIXTURE_ACTIONS.join('|')})`,
    );
  }
  return candidate as FixtureAction;
}

/**
 * 数据库守卫：整串精确等于 moment_e2e。
 * 别处的 `_e2e` 标记（other_e2e）或加后缀（moment_e2e_extra）一律拒绝。
 */
export function assertE2eFixtureGuard(env: E2eFixtureEnv): void {
  if (env.MOMENT_E2E !== '1') {
    throw new Error("E2E_FIXTURE_GUARD: MOMENT_E2E must be exactly '1'");
  }
  if (env.NODE_ENV !== 'test') {
    throw new Error("E2E_FIXTURE_GUARD: NODE_ENV must be exactly 'test'");
  }
  if (env.MYSQL_DATABASE !== 'moment_e2e') {
    throw new Error("E2E_FIXTURE_GUARD: MYSQL_DATABASE must be exactly 'moment_e2e'");
  }
}

/**
 * 存储守卫：只做字符串/URL 解析，绝不发请求。
 * 要求私有桶 moment-e2e + http loopback endpoint。
 */
export function assertE2eStorageGuard(env: E2eFixtureEnv): void {
  if (env.ATTACHMENT_S3_BUCKET !== 'moment-e2e') {
    throw new Error("E2E_STORAGE_GUARD: ATTACHMENT_S3_BUCKET must be exactly 'moment-e2e'");
  }
  const endpoint = env.ATTACHMENT_S3_ENDPOINT;
  if (endpoint === undefined || endpoint === '') {
    throw new Error('E2E_STORAGE_GUARD: ATTACHMENT_S3_ENDPOINT is required');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('E2E_STORAGE_GUARD: ATTACHMENT_S3_ENDPOINT must be a valid URL');
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      'E2E_STORAGE_GUARD: ATTACHMENT_S3_ENDPOINT must be an http loopback URL (127.0.0.1|localhost|[::1])',
    );
  }
  if (env.ATTACHMENT_S3_IS_PUBLIC !== false) {
    throw new Error('E2E_STORAGE_GUARD: ATTACHMENT_S3_IS_PUBLIC must be false (private bucket)');
  }
}

function readCredential(env: E2eFixtureEnv, emailKey: 'MOMENT_E2E_OWNER_EMAIL' | 'MOMENT_E2E_VIEWER_EMAIL', passwordKey: 'MOMENT_E2E_OWNER_PASSWORD' | 'MOMENT_E2E_VIEWER_PASSWORD'): { email: string; password: string } {
  const email = env[emailKey];
  if (email === undefined || email === '' || !EMAIL_PATTERN.test(email)) {
    throw new Error(`E2E_FIXTURE_CREDENTIALS: ${emailKey} must be a valid email`);
  }
  const password = env[passwordKey];
  if (
    password === undefined ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `E2E_FIXTURE_CREDENTIALS: ${passwordKey} must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  return { email, password };
}

/** 只有 seed 动作读取四个凭据；preflight/reset/teardown 永远不调本函数。 */
export function readE2eFixtureCredentials(env: E2eFixtureEnv): E2eFixtureCredentials {
  return {
    owner: readCredential(env, 'MOMENT_E2E_OWNER_EMAIL', 'MOMENT_E2E_OWNER_PASSWORD'),
    viewer: readCredential(env, 'MOMENT_E2E_VIEWER_EMAIL', 'MOMENT_E2E_VIEWER_PASSWORD'),
  };
}

/**
 * 动作执行：preflight 纯守卫返回固定 JSON（不 loadSeeder）；
 * 写动作严格 action → serialize → finally close 恰好一次，closer 失败致命。
 */
export async function runFixtureAction(
  action: FixtureAction,
  credentials: E2eFixtureCredentials | undefined,
  dependencies: {
    loadSeeder(): Promise<FixtureSeederModule>;
    serialize(value: E2eCliResult): string;
  },
): Promise<string> {
  if (action === 'preflight') {
    const result: E2ePreflightResult = { mode: 'e2e', database: 'moment_e2e' };
    return dependencies.serialize(result);
  }
  const seeder = await dependencies.loadSeeder();
  try {
    let result: E2eCliResult;
    if (action === 'reset') {
      result = await seeder.resetFixture();
    } else if (action === 'seed') {
      // credentials 由 executeFixtureCli 在 seed 分支先行读取校验。
      result = await seeder.seedFixture(credentials as E2eFixtureCredentials);
    } else {
      result = await seeder.teardownFixture();
    }
    // DB 仍打开时序列化：序列化失败同样走 finally 关池。
    return dependencies.serialize(result);
  } finally {
    await seeder.closeFixtureDb();
  }
}

/** 用环境中的凭据值对错误消息脱敏：任何意外泄漏路径都被替换为 [redacted]。 */
function redactSecrets(message: string, env: E2eFixtureEnv): string {
  const secrets = [
    env.MOMENT_E2E_OWNER_PASSWORD,
    env.MOMENT_E2E_VIEWER_PASSWORD,
    env.MOMENT_E2E_OWNER_EMAIL,
    env.MOMENT_E2E_VIEWER_EMAIL,
  ];
  let redacted = message;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted;
}

/**
 * CLI 生命周期：parse → 双守卫 → （仅 seed）读凭据 → runFixtureAction。
 * 失败只经 writeStderr + setExitCode(1) 汇报，绝不 process.exit()。
 */
export async function executeFixtureCli(options: {
  argv: readonly string[];
  env: E2eFixtureEnv;
  loadSeeder(): Promise<FixtureSeederModule>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  setExitCode(code: number): void;
}): Promise<void> {
  try {
    const action = parseFixtureAction(options.argv);
    assertE2eFixtureGuard(options.env);
    assertE2eStorageGuard(options.env);
    const credentials = action === 'seed' ? readE2eFixtureCredentials(options.env) : undefined;
    const text = await runFixtureAction(action, credentials, {
      loadSeeder: options.loadSeeder,
      serialize: (value) => JSON.stringify(value),
    });
    options.writeStdout(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.writeStderr(redactSecrets(message, options.env));
    options.setExitCode(1);
  }
}
