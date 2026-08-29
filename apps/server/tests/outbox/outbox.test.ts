import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import {
  OUTBOX_MOMENT_CREATED,
  OUTBOX_MOMENT_DELETED,
  emitOutbox,
} from '../../src/outbox/outbox.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('emitOutbox', () => {
  it('在事务内落 pending 行，payload 原样 JSON', async () => {
    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_CREATED, {
        momentId: 'm-1',
        chainId: 'c-1',
        authorId: 'u-1',
        isBackfill: false,
      });
    });
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'moment.created',
      status: 'pending',
      attempts: 0,
    });
    expect(rows[0].payload).toEqual({
      momentId: 'm-1',
      chainId: 'c-1',
      authorId: 'u-1',
      isBackfill: false,
    });
  });

  it('业务事务回滚时 outbox 行随之消失（同事务原子性）', async () => {
    await expect(
      db.transaction(async (tx) => {
        await emitOutbox(tx, OUTBOX_MOMENT_DELETED, { momentId: 'm-2', chainId: 'c-1' });
        throw new Error('business failure');
      })
    ).rejects.toThrow('business failure');
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(0);
  });

  it('type 常量与联合类型一致（编译期由 OutboxType 保证）', async () => {
    expect(OUTBOX_MOMENT_CREATED).toBe('moment.created');
    expect(OUTBOX_MOMENT_DELETED).toBe('moment.deleted');
    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_DELETED, { momentId: 'm-3', chainId: 'c-1' });
    });
    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.deleted'));
    expect(row?.payload).toEqual({ momentId: 'm-3', chainId: 'c-1' });
  });
});

describe('outbox 类型常量（fused-retrieval spec §2.3）', () => {
  it('COMPRESS / EMBED 字符串与 payload 形状锁定', async () => {
    expect(OUTBOX_MOMENT_COMPRESS).toBe('moment.compress');
    expect(OUTBOX_MOMENT_EMBED).toBe('moment.embed');

    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, {
        momentId: 'm-1',
        chainId: 'c-1',
        mediaId: 'media-1',
      });
      await emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId: 'm-1', chainId: 'c-1' });
    });
    const rows = await db.select().from(outbox);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(['moment.compress', 'moment.embed']);
    const compress = rows.find((r) => r.type === 'moment.compress');
    expect(compress?.payload).toEqual({ momentId: 'm-1', chainId: 'c-1', mediaId: 'media-1' });
    const embed = rows.find((r) => r.type === 'moment.embed');
    expect(embed?.payload).toEqual({ momentId: 'm-1', chainId: 'c-1' });
  });
});

