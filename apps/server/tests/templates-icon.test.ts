import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { templates } from '../src/db/schema/templates.js';
import { seedOfficialTemplates } from '../src/templates/official-templates.seed.js';
import { auth, createUser, type TestUser } from './helpers/auth.js';
import { closeDb, resetDb } from './helpers/db.js';
import { listenLocal } from './helpers/http-server.js';

const app = listenLocal(createApp());

let alice: TestUser;

beforeEach(async () => {
  await resetDb();
  alice = await createUser(app, 'alice');
});
afterAll(closeDb);

describe('templates.icon 列宽与 seed 图标化', () => {
  it('information_schema 中 templates.icon 为 varchar(50)', async () => {
    const [rows] = await pool.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'templates' AND COLUMN_NAME = 'icon'`,
    );
    expect(Number((rows as Array<{ len: number }>)[0].len)).toBe(50);
  });

  it('seed 幂等且把三官方模板 icon 改写为 tpl-* key', async () => {
    // 模拟旧数据：把 baby icon 改回 emoji，跑 seed 应被 upsert 回 key
    await db.update(templates).set({ icon: '👶' }).where(eq(templates.key, 'baby'));
    await seedOfficialTemplates();
    const rows = await db
      .select({ key: templates.key, icon: templates.icon })
      .from(templates)
      .where(inArray(templates.key, ['baby', 'travel', 'daily']));
    const byKey = new Map(rows.map((r) => [r.key, r.icon]));
    expect(byKey.get('baby')).toBe('tpl-baby');
    expect(byKey.get('travel')).toBe('tpl-travel');
    expect(byKey.get('daily')).toBe('tpl-daily');

    // 幂等：再跑一次，官方行数不变
    const countBefore = rows.length;
    await seedOfficialTemplates();
    const rowsAfter = await db
      .select({ key: templates.key })
      .from(templates)
      .where(inArray(templates.key, ['baby', 'travel', 'daily']));
    expect(rowsAfter.length).toBe(countBefore);
  });

  it('带 icon key（>8 字符）的 user 模板可建 201，51 字符 400', async () => {
    const ok = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: '读书', icon: 'tpl-reading', manifest: { version: 1 } });
    expect(ok.status).toBe(201);
    expect(ok.body.icon).toBe('tpl-reading');

    const tooLong = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: 'x', icon: 'a'.repeat(51), manifest: { version: 1 } });
    expect(tooLong.status).toBe(400);
  });
});
