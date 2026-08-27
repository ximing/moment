/**
 * 迁移 0015（链外观字段 + media.orphaned_at）隔离回填验证。
 *
 * 本测试不 import src/db 或 tests/helpers/db.ts，也不读取 .env；它仅使用下方显式的
 * 本地 Docker MySQL 连接，创建随机临时 schema，执行 0000–0014 后造历史数据，再执行
 * 0015 并断言 ALTER 与两条回填。afterAll 始终删除临时 schema。
 *
 * 运行：
 *   docker compose up -d mysql
 *   SKIP_GLOBAL_MIGRATE=1 RUN_MIGRATION_IT=1 pnpm --filter @moment/server test -- chain-appearance-backfill
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import mysql, { type Connection } from 'mysql2/promise';

const d = process.env.RUN_MIGRATION_IT === '1' ? describe : describe.skip;

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'drizzle');

/** 本地 docker compose MySQL；可用专用迁移测试环境变量覆盖，不读 .env。 */
const CONN = {
  host: process.env.MIGRATION_IT_HOST ?? '127.0.0.1',
  port: Number(process.env.MIGRATION_IT_PORT ?? 3306),
  user: process.env.MIGRATION_IT_USER ?? 'root',
  password: process.env.MIGRATION_IT_PASSWORD ?? 'moment_root_dev',
};

async function applyMigration(conn: Connection, tag: string): Promise<void> {
  const raw = await readFile(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await conn.query(statement);
}

d('迁移 0015 chain appearance 回填（RUN_MIGRATION_IT=1，本地 docker MySQL）', () => {
  let conn: Connection;
  const schema = `moment_chain_appearance_it_${Date.now().toString(36)}`;

  beforeAll(async () => {
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
    if (entries.length !== 16 || entries[15]?.idx !== 15 || !entries[15].tag.startsWith('0015_')) {
      throw new Error(
        `chain appearance 回填验证基线失效：期望 journal 恰好 16 条且末条为 idx=15/0015_*，实际 ${entries.length} 条末条 ${JSON.stringify(entries.at(-1))}。`,
      );
    }

    conn = await mysql.createConnection(CONN);
    await conn.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`USE \`${schema}\``);

    for (const { tag } of entries.slice(0, 15)) await applyMigration(conn, tag);

    await conn.query(
      `INSERT INTO users (id, email, password_hash, nickname)
       VALUES ('appearance-user', 'appearance@migration.it', 'x', 'appearance')`,
    );
    await conn.query(
      `INSERT INTO chains (id, name, color, icon, owner_id, template)
       VALUES ('appearance-chain', '历史链', 'mint', '👶', 'appearance-user', 'daily')`,
    );
    await conn.query(
      `INSERT INTO media (id, uploader_id, s3_key, mime, size, status, storage_meta, created_at)
       VALUES (
         'orphaned-media',
         'appearance-user',
         'tmp/orphaned-media.jpg',
         'image/jpeg',
         1,
         'orphaned',
         JSON_OBJECT('bucket', 'local-migration-it', 'prefix', 'test/attachments', 'region', 'us-east-1', 'isPublicBucket', 'false'),
         '2026-08-01 12:34:56'
       )`,
    );

    await applyMigration(conn, entries[15].tag);
  }, 120_000);

  afterAll(async () => {
    if (conn) {
      await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await conn.end();
    }
  });

  it('保留历史 icon、清空 color，设置焦点默认值并按 created_at 回填 orphaned_at', async () => {
    const [chainRows] = await conn.query<RowDataPacket[]>(
      `SELECT color, icon,
              avatar_focus_x AS avatarFocusX,
              avatar_focus_y AS avatarFocusY,
              cover_focus_x AS coverFocusX,
              cover_focus_y AS coverFocusY
       FROM chains WHERE id = 'appearance-chain'`,
    );
    expect(chainRows[0]).toEqual({
      color: null,
      icon: '👶',
      avatarFocusX: 5000,
      avatarFocusY: 5000,
      coverFocusX: 5000,
      coverFocusY: 5000,
    });

    const [mediaRows] = await conn.query<RowDataPacket[]>(
      `SELECT orphaned_at AS orphanedAt, created_at AS createdAt
       FROM media WHERE id = 'orphaned-media'`,
    );
    expect(mediaRows[0]?.orphanedAt).toEqual(mediaRows[0]?.createdAt);
  });

  it('varchar(64) icon 列可保存 ZWJ Emoji', async () => {
    const zwjEmoji = '👨‍👩‍👧‍👦';
    await conn.query(`UPDATE chains SET icon = ? WHERE id = 'appearance-chain'`, [zwjEmoji]);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT icon FROM chains WHERE id = 'appearance-chain'`,
    );
    expect(rows[0]?.icon).toBe(zwjEmoji);
  });
});
