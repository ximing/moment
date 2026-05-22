import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { comments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('moment 序列化计数（feed / 链内列表 / 详情统一）', () => {
  it('commentCount 不含软删评论；reactions 按 emoji 分组；myReaction 因请求者而异', async () => {
    const owner = await registerUser();
    const alice = await registerUser();
    const bob = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, alice.id, 'editor');
    await addMember(chainId, bob.id, 'viewer');
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });

    // 3 条评论，1 条软删 → 计数 2
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`/api/moments/${momentId}/comments`)
        .set(auth(alice.token))
        .send({ content: `c-${i}` });
      if (i === 1) {
        await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, res.body.id));
      }
    }
    // alice 点 ❤️、bob 点 ❤️、owner 点 🎉（owner 换过一次：👍 → 🎉，最终只有一个 🎉）
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(alice.token)).send({ emoji: '❤️' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(bob.token)).send({ emoji: '❤️' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(owner.token)).send({ emoji: '👍' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(owner.token)).send({ emoji: '🎉' });

    const fromAlice = await request(app).get(`/api/moments/${momentId}`).set(auth(alice.token));
    expect(fromAlice.status).toBe(200);
    expect(fromAlice.body.commentCount).toBe(2);
    // 不依赖 emoji 排序（MySQL collation 对 emoji 的顺序无契约）：按 count 降序后断言
    const reactionSummaries = [...fromAlice.body.reactions].sort(
      (a: { count: number }, b: { count: number }) => b.count - a.count
    );
    expect(reactionSummaries).toEqual([
      { emoji: '❤️', count: 2 },
      { emoji: '🎉', count: 1 },
    ]);
    expect(fromAlice.body.myReaction).toBe('❤️');

    const fromBob = await request(app).get(`/api/moments/${momentId}`).set(auth(bob.token));
    expect(fromBob.body.myReaction).toBe('❤️');

    const fromOwner = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(fromOwner.body.myReaction).toBe('🎉');

    // 未点表情的链外场景不可构造（非成员 404），用 feed 验证无互动时零值
    const empty = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(Date.now() + 1000) });
    const feed = await request(app).get('/api/feed').set(auth(alice.token));
    const item = feed.body.moments.find((m: { id: string }) => m.id === empty);
    expect(item.commentCount).toBe(0);
    expect(item.reactions).toEqual([]);
    expect(item.myReaction).toBeNull();
  });

  it('feed 与链内列表同样携带计数（同一 serializeMoments 出口）', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: '一条' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '👏' });

    const feedItem = (
      await request(app).get('/api/feed').set(auth(viewer.token))
    ).body.moments.find((m: { id: string }) => m.id === momentId);
    expect(feedItem.commentCount).toBe(1);
    expect(feedItem.reactions).toEqual([{ emoji: '👏', count: 1 }]);
    expect(feedItem.myReaction).toBe('👏');

    const listItem = (
      await request(app).get(`/api/chains/${chainId}/moments`).set(auth(viewer.token))
    ).body.items.find((m: { id: string }) => m.id === momentId);
    expect(listItem.commentCount).toBe(1);
    expect(listItem.myReaction).toBe('👏');
  });
});
