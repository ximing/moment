import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { pushTokens } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

const TOKEN = 'ExponentPushToken[dddddddddddddddddddddd]';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /api/devices/push-token', () => {
  it('注册：upsert + last_seen_at 刷新；同 token 重复注册不增行', async () => {
    const alice = await registerUser();
    const first = await request(app)
      .post('/api/devices/push-token')
      .set(auth(alice.token))
      .send({ expoToken: TOKEN, platform: 'ios' });
    expect(first.status).toBe(204);
    expect(await db.select().from(pushTokens)).toHaveLength(1);

    const second = await request(app)
      .post('/api/devices/push-token')
      .set(auth(alice.token))
      .send({ expoToken: TOKEN, platform: 'ios' });
    expect(second.status).toBe(204);
    expect(await db.select().from(pushTokens)).toHaveLength(1);
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.expoToken, TOKEN));
    expect(row.userId).toBe(alice.id);
    expect(row.invalidatedAt).toBeNull();
    expect(row.lastSeenAt).toBeTruthy();
  });

  it('同 token 换账号 = 重新绑定（user_id 改写）', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await request(app).post('/api/devices/push-token').set(auth(alice.token)).send({ expoToken: TOKEN, platform: 'android' });
    await request(app).post('/api/devices/push-token').set(auth(bob.token)).send({ expoToken: TOKEN, platform: 'android' });
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.expoToken, TOKEN));
    expect(row.userId).toBe(bob.id);
    expect(await db.select().from(pushTokens)).toHaveLength(1);
  });

  it('失效后重新注册复活（invalidated_at 清空）', async () => {
    const alice = await registerUser();
    await request(app).post('/api/devices/push-token').set(auth(alice.token)).send({ expoToken: TOKEN, platform: 'ios' });
    await db.update(pushTokens).set({ invalidatedAt: new Date() }).where(eq(pushTokens.expoToken, TOKEN));
    await request(app).post('/api/devices/push-token').set(auth(alice.token)).send({ expoToken: TOKEN, platform: 'ios' });
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.expoToken, TOKEN));
    expect(row.invalidatedAt).toBeNull();
  });

  it('非法 platform / 短 token 400；未登录 401', async () => {
    const alice = await registerUser();
    const bad = await request(app)
      .post('/api/devices/push-token')
      .set(auth(alice.token))
      .send({ expoToken: TOKEN, platform: 'harmony' });
    expect(bad.status).toBe(400);
    expect((await request(app).post('/api/devices/push-token').send({ expoToken: TOKEN, platform: 'ios' })).status).toBe(401);
  });
});
