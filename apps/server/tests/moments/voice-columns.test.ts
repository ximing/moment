import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, moments, users } from '../../src/db/schema.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

it('moments 表：voice 类型 + transcript/transcription_status 列 round-trip（spec voice-moment §1）', async () => {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const id = randomUUID();
  const happenedAt = new Date('2026-08-23T02:00:00Z');
  await db.insert(moments).values({
    id,
    chainId,
    authorId: userId,
    type: 'voice',
    content: '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: 'pending',
  });
  const [row] = await db.select().from(moments).where(eq(moments.id, id));
  expect(row.type).toBe('voice');
  expect(row.transcriptionStatus).toBe('pending');
  expect(row.transcript).toBeNull();

  await db.update(moments).set({ transcript: '你好', transcriptionStatus: 'done' }).where(eq(moments.id, id));
  const [done] = await db.select().from(moments).where(eq(moments.id, id));
  expect(done.transcript).toBe('你好');
  expect(done.transcriptionStatus).toBe('done');

  // 非 voice 类型两列恒 NULL（可空而非 default，spec §1）
  const textId = randomUUID();
  await db.insert(moments).values({
    id: textId,
    chainId,
    authorId: userId,
    type: 'text',
    content: 'hi',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
  });
  const [textRow] = await db.select().from(moments).where(eq(moments.id, textId));
  expect(textRow.transcript).toBeNull();
  expect(textRow.transcriptionStatus).toBeNull();
});
