import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { notifications } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { registerUser, app } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seed(userId: string, n: number, readFirst = 0): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    ids.push(id);
    await db.insert(notifications).values({
      id,
      userId,
      type: 'moment.created',
      payload: { chainName: '链', actorNickname: 'n', summary: 's' },
      readAt: i < readFirst ? new Date() : null,
      // 显式 createdAt 逐条 +1ms：默认值仅毫秒级递增，同毫秒两行会让 (created_at, id) 降序退化为随机 UUID 序、顺序断言偶发失败
      createdAt: new Date(Date.now() + i),
    });
  }
  return ids;
}

describe('GET /api/notifications', () => {
  it('仅本人、降序、unread 过滤、游标翻页', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const ids = await seed(alice.id, 4, 1); // 第 1 条已读
    await seed(bob.id, 2);

    const page1 = await request(app).get('/api/notifications?limit=2').set(auth(alice.token));
    expect(page1.status).toBe(200);
    // 降序（新→旧），bob 的不出现
    expect(page1.body.notifications.map((n: { id: string }) => n.id)).toEqual([ids[3], ids[2]]);
    expect(page1.body.notifications[0].payload).toEqual({ chainName: '链', actorNickname: 'n', summary: 's' });

    const page2 = await request(app)
      .get(`/api/notifications?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set(auth(alice.token));
    expect(page2.body.notifications.map((n: { id: string }) => n.id)).toEqual([ids[1], ids[0]]);
    expect(page2.body.nextCursor).toBeNull();

    const unread = await request(app).get('/api/notifications?unread=true').set(auth(alice.token));
    expect(unread.body.notifications).toHaveLength(3);

    // 坏游标 400
    const bad = await request(app)
      .get(`/api/notifications?cursor=${encodeURIComponent('!!!')}`)
      .set(auth(alice.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });

  it('未登录 401', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});

describe('POST /api/notifications/read', () => {
  it('仅本人的置已读；他人 id 静默不动', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const aliceIds = await seed(alice.id, 2);
    const bobIds = await seed(bob.id, 1);

    const res = await request(app)
      .post('/api/notifications/read')
      .set(auth(alice.token))
      .send({ ids: [aliceIds[0], bobIds[0]] });
    expect(res.status).toBe(204);

    const [a0] = await db.select().from(notifications).where(eq(notifications.id, aliceIds[0]));
    expect(a0.readAt).not.toBeNull();
    const [a1] = await db.select().from(notifications).where(eq(notifications.id, aliceIds[1]));
    expect(a1.readAt).toBeNull();
    const [b0] = await db.select().from(notifications).where(eq(notifications.id, bobIds[0]));
    expect(b0.readAt).toBeNull();
  });

  it('空 ids 400 VALIDATION_ERROR', async () => {
    const alice = await registerUser();
    const res = await request(app).post('/api/notifications/read').set(auth(alice.token)).send({ ids: [] });
    expect(res.status).toBe(400);
  });
});
