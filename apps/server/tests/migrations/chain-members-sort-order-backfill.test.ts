/**
 * 迁移 0014（chain_members.sort_order + 数据回填）验证（spec chain-ordering §2/§7）。
 *
 * 远程共享测试库已应用全部既有迁移，migrate 是 no-op，观察不到回填效果。本测试在本地
 * docker compose 的 MySQL 8.4（docker-compose.yml：root/moment_root_dev @ 127.0.0.1:3306）
 * 起临时 schema：顺序执行 0000–0013 → 按旧行为造多用户多链数据（含 created_at 同秒并列）→
 * 执行 0014 → 断言 sort_order 恰好是每用户按「created_at DESC, id ASC」的 1..n
 * （老用户升级后列表顺序完全不变）。
 *
 * 不 import src/db / tests/helpers/db.ts（其 pool 指向 .env 远程测试库）；自带连接，
 * 收尾 DROP 临时 schema，全程不碰远程共享库。jest --runInBand 串行，无并行冲突。
 *
 * 运行方式（SKIP_GLOBAL_MIGRATE=1 必须带：jest globalSetup 默认每次都对远程共享测试库跑
 * migrate，本测试的语义是「先于任何远程 migrate 验证回填」，守卫保证闸门时序不被架空）：
 *   docker compose up -d mysql
 *   SKIP_GLOBAL_MIGRATE=1 RUN_MIGRATION_IT=1 pnpm --filter @moment/server test -- chain-members-sort-order-backfill
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import mysql, { type Connection } from 'mysql2/promise';

const d = process.env.RUN_MIGRATION_IT === '1' ? describe : describe.skip;

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'drizzle');

/** 本地 docker compose MySQL；可用环境变量覆盖（不读 .env，杜绝误连远程库）。 */
const CONN = {
  host: process.env.MIGRATION_IT_HOST ?? '127.0.0.1',
  port: Number(process.env.MIGRATION_IT_PORT ?? 3306),
  user: process.env.MIGRATION_IT_USER ?? 'root',
  password: process.env.MIGRATION_IT_PASSWORD ?? 'moment_root_dev',
};

/** 按 drizzle 的 statement-breakpoint 切分迁移文件并逐句执行。 */
async function applyMigration(conn: Connection, tag: string): Promise<void> {
  const raw = await readFile(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await conn.query(stmt);
}

d('迁移 0014 chain_members.sort_order 回填（RUN_MIGRATION_IT=1，本地 docker MySQL）', () => {
  let conn: Connection;
  const schema = `moment_migration_it_${Date.now().toString(36)}`;

  beforeAll(async () => {
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const tags = [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
    // 基线守卫：本测试按「0000–0013 旧行为 + 0014 回填」编写；未来新迁移落地后必须重定基线
    if (tags.length !== 15 || !tags[14]!.startsWith('0014_')) {
      throw new Error(
        `chain-ordering 回填验证基线失效：期望 journal 恰好 15 条且末条为 0014_*，实际 ${tags.length} 条末条 ${tags[tags.length - 1]}。请按新基线调整本测试。`,
      );
    }

    conn = await mysql.createConnection(CONN);
    await conn.query(`CREATE DATABASE \`${schema}\``);
    await conn.query(`USE \`${schema}\``);

    // 旧行为：迁移到 0013（此时 chain_members 还没有 sort_order 列，INSERT 不带它）
    for (const tag of tags.slice(0, 14)) await applyMigration(conn, tag);

    // 多用户多链：chain-2 与 chain-3 同一秒 created_at（回填的并列按 id 稳定，spec §2 回填 SQL）
    await conn.query(
      `INSERT INTO users (id, email, password_hash, nickname) VALUES
       ('user-1', 'u1@migration.it', 'x', 'u1'),
       ('user-2', 'u2@migration.it', 'x', 'u2')`,
    );
    await conn.query(
      `INSERT INTO chains (id, name, owner_id, template, created_at) VALUES
       ('chain-1', '旧链', 'user-1', 'daily', '2026-01-01 00:00:00'),
       ('chain-2', '并列A', 'user-2', 'daily', '2026-01-03 00:00:00'),
       ('chain-3', '并列B', 'user-2', 'daily', '2026-01-03 00:00:00')`,
    );
    await conn.query(
      `INSERT INTO chain_members (chain_id, user_id, role) VALUES
       ('chain-1', 'user-1', 'owner'),
       ('chain-2', 'user-1', 'viewer'),
       ('chain-3', 'user-1', 'viewer'),
       ('chain-2', 'user-2', 'owner'),
       ('chain-3', 'user-2', 'viewer')`,
    );

    // 应用被测迁移（ALTER ADD sort_order DEFAULT 0 + 回填 UPDATE 在同一文件）
    await applyMigration(conn, tags[14]!);
  }, 120_000);

  afterAll(async () => {
    if (conn) {
      await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await conn.end();
    }
  });

  it('回填后 sort_order = 每用户按 created_at DESC, id ASC 的 1..n（ROW_NUMBER 按 user 分区）', async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT user_id AS userId, chain_id AS chainId, sort_order AS sortOrder
       FROM chain_members ORDER BY user_id, sort_order`,
    );
    expect(rows).toEqual([
      // user-1：chain-2/chain-3 同秒并列按 id 升序 → chain-2 在前；chain-1 最旧垫底
      { userId: 'user-1', chainId: 'chain-2', sortOrder: 1 },
      { userId: 'user-1', chainId: 'chain-3', sortOrder: 2 },
      { userId: 'user-1', chainId: 'chain-1', sortOrder: 3 },
      // user-2：ROW_NUMBER 按 user_id 分区，互不影响
      { userId: 'user-2', chainId: 'chain-2', sortOrder: 1 },
      { userId: 'user-2', chainId: 'chain-3', sortOrder: 2 },
    ]);
  });

  it('ORDER BY sort_order ASC 与迁移前 created_at DESC 展示顺序一致（老用户升级后列表不变）', async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT cm.user_id AS userId, cm.chain_id AS chainId
       FROM chain_members cm JOIN chains c ON c.id = cm.chain_id
       ORDER BY cm.user_id, cm.sort_order ASC, c.created_at DESC`,
    );
    expect(rows).toEqual([
      { userId: 'user-1', chainId: 'chain-2' },
      { userId: 'user-1', chainId: 'chain-3' },
      { userId: 'user-1', chainId: 'chain-1' },
      { userId: 'user-2', chainId: 'chain-2' },
      { userId: 'user-2', chainId: 'chain-3' },
    ]);
  });
});
