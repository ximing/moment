import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chainMembers, comments, moments, notifications, pushTokens } from '../../src/db/schema.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { MockPushService } from '../../src/push/mock.js';
import { handleMomentCompress } from '../../src/media/handle-moment-compress.js';
import { handleMomentEmbed } from '../../src/embedding/handle-moment-embed.js';
import {
  handleCommentCreated,
  handleMomentCreated,
  handleMomentDeleted,
  handleReactionCreated,
  handleRecapGenerate,
  handleMomentTranscribe,
  handleMomentGeocode,
  handleMomentExtract,
  handlers,
} from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

/** 造一条链：owner（moment 作者）+ extra 个 viewer 成员。 */
async function setupChainMoment(extra: number, opts: { isBackfill?: boolean; deleted?: boolean } = {}) {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const members: string[] = [];
  for (let i = 0; i < extra; i++) {
    const u = await registerUser();
    await db.insert(chainMembers).values({ chainId, userId: u.id, role: 'viewer', joinedAt: new Date() });
    members.push(u.id);
  }
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date(),
    isBackfill: opts.isBackfill ?? false,
    deletedAt: opts.deleted ? new Date() : undefined,
  });
  return { owner, members, chainId, momentId };
}

describe('handleMomentCreated（链内新 moment，spec §5.4）', () => {
  it('voice 空 content：summary 与 body 摘要用 [语音] 兜底（spec §3.4）', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const chainId = await createChain(owner.id);
    await db.insert(chainMembers).values({ chainId, userId: member.id, role: 'viewer', joinedAt: new Date() });
    // insertMoment 夹具 type 恒 text，voice 直插（content 空 + transcriptionStatus pending）
    const momentId = randomUUID();
    const happenedAt = new Date('2026-08-23T02:00:00Z');
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: owner.id,
      type: 'voice',
      content: '',
      happenedAt,
      happenedTzOffset: 0,
      wallDate: wallDateOf(happenedAt, 0),
      transcriptionStatus: 'pending',
    });
    const push = new MockPushService();

    await handleMomentCreated({ momentId, chainId, authorId: owner.id, isBackfill: false }, { push });

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.summary).toBe('[语音]');
  });

  it('扇出到链全体成员（除作者）：owner+2 成员 → 2 条通知 + push', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(2);
    const push = new MockPushService();

    await handleMomentCreated(
      { momentId, chainId, authorId: owner.id, isBackfill: false },
      { push }
    );

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set(members));
    expect(rows.every((r) => r.type === 'moment.created')).toBe(true);
    // 快照字段
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.momentId).toBe(momentId);
    expect(payload.chainName).toEqual(expect.any(String));
    expect(payload.actorNickname).toBeTruthy();
    expect(payload.backfill).toBe(false);
    // push 走到有效 token 的用户（无 token → 0 条消息，不报错）
    expect(push.sent).toHaveLength(0);
  });

  it('is_backfill=true：仍插通知（backfill:true）但跳过 push', async () => {
    const { owner, chainId, momentId } = await setupChainMoment(1, { isBackfill: true });
    const push = new MockPushService();

    await handleMomentCreated(
      { momentId, chainId, authorId: owner.id, isBackfill: true },
      { push }
    );

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { backfill: boolean }).backfill).toBe(true);
    expect(push.sent).toHaveLength(0);
  });

  it('moment 已软删 → 不扇出', async () => {
    const { owner, chainId, momentId } = await setupChainMoment(1, { deleted: true });
    const push = new MockPushService();
    await handleMomentCreated({ momentId, chainId, authorId: owner.id, isBackfill: false }, { push });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it('有 push_token 的成员收到推送；send 返回的失效 token 被置 invalidated_at', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(2);
    const token = 'ExponentPushToken[eeeeeeeeeeeeeeeeeeeeee]';
    await db.insert(pushTokens).values({
      id: 'tok-1',
      userId: members[0],
      expoToken: token,
      platform: 'ios',
      lastSeenAt: new Date(),
      invalidatedAt: null,
    });
    const push = new MockPushService();
    push.invalidTokensToReport = [token];

    await handleMomentCreated({ momentId, chainId, authorId: owner.id, isBackfill: false }, { push });

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0].to).toBe(token);
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.id, 'tok-1'));
    expect(row.invalidatedAt).not.toBeNull();
  });
});

describe('handleCommentCreated / handleReactionCreated', () => {
  it('评论 → 仅 moment 作者收到通知与推送；作者自己评论不通知', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(1);
    const push = new MockPushService();
    // handler 先查评论行（查不到/已软删直接 return），必须先插入真实行
    await db.insert(comments).values({ id: 'c-1', momentId, authorId: members[0], content: '好文' });
    await handleCommentCreated(
      { commentId: 'c-1', momentId, chainId, authorId: members[0] },
      { push }
    );
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(owner.id);
    expect(rows[0].type).toBe('comment.created');

    // 作者评论自己的 moment → 在 `m.authorId === authorId` 分支 return，不插行（同样先插行，语义真实）
    await db.insert(comments).values({ id: 'c-2', momentId, authorId: owner.id, content: '自评' });
    await handleCommentCreated({ commentId: 'c-2', momentId, chainId, authorId: owner.id }, { push });
    expect(await db.select().from(notifications)).toHaveLength(1);
    expect(push.sent).toHaveLength(0);
  });

  it('表情 → 仅 moment 作者；点自己 moment 不通知；payload 含 emoji', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(1);
    const push = new MockPushService();
    await handleReactionCreated(
      { momentId, chainId, userId: members[0], emoji: '🎉' },
      { push }
    );
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { emoji: string }).emoji).toBe('🎉');

    await handleReactionCreated({ momentId, chainId, userId: owner.id, emoji: '👍' }, { push });
    expect(await db.select().from(notifications)).toHaveLength(1);

    // 换表情 = 新通知（去重键含 emoji，Global Constraints）
    await handleReactionCreated({ momentId, chainId, userId: members[0], emoji: '❤️' }, { push });
    expect(await db.select().from(notifications)).toHaveLength(2);
  });
});

describe('handlers 注册表', () => {
  it('十种事件均已注册（含 moment.embed）', () => {
    expect(handlers['moment.created']).toBe(handleMomentCreated);
    expect(handlers['comment.created']).toBe(handleCommentCreated);
    expect(handlers['reaction.created']).toBe(handleReactionCreated);
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(handlers['recap.generate']).toBe(handleRecapGenerate);
    expect(handlers['moment.transcribe']).toBe(handleMomentTranscribe);
    expect(handlers['moment.geocode']).toBe(handleMomentGeocode);
    expect(handlers['moment.extract']).toBe(handleMomentExtract);
    expect(handlers['moment.compress']).toBe(handleMomentCompress);
    expect(handlers['moment.embed']).toBe(handleMomentEmbed);
    expect(Object.keys(handlers)).toHaveLength(10);
  });

  it('moment.deleted：无匹配 media 行时静默成功、不产生通知（Phase 8 已替换为 orphaned 标记实现）', async () => {
    await expect(
      handleMomentDeleted({ momentId: 'm-x', chainId: 'c-x' }, { push: new MockPushService() })
    ).resolves.toBeUndefined();
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});
