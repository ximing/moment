import { randomUUID } from 'node:crypto';
import type { ChainDto } from '@moment/dto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { defaultChainColor, focusFromDb, focusToDb } from '../../src/chains/chain-appearance.js';
import { db } from '../../src/db/index.js';
import { chains, media, moments, users, type Media } from '../../src/db/schema.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';

const app = listenLocal(createApp());

let storage: MockStorage;
let owner: TestUser;
let outsider: TestUser;

const STORAGE_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  owner = await createUser(app, 'owner@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 直插一条 tmp key 的 media（默认 ready / image/jpeg / 未绑定），返回 mediaId。 */
async function insertTmpMedia(opts: {
  uploaderId: string;
  mime?: string;
  status?: 'ready' | 'uploading';
  momentId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  const mime = opts.mime ?? 'image/jpeg';
  const ext = mime === 'video/mp4' ? 'mp4' : 'jpeg';
  await db.insert(media).values({
    id,
    momentId: opts.momentId ?? null,
    uploaderId: opts.uploaderId,
    s3Key: `tmp/${id}.${ext}`,
    mime,
    size: 1024,
    status: opts.status ?? 'ready',
    storageMeta: STORAGE_META,
  });
  return id;
}

async function getMediaRow(id: string): Promise<Media> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row!;
}

async function getChainRow(id: string) {
  const [row] = await db.select().from(chains).where(eq(chains.id, id)).limit(1);
  return row!;
}

async function postChain(body: Record<string, unknown>, user: TestUser = owner) {
  return request(app).post('/api/chains').set('Authorization', auth(user)).send(body);
}

async function patchChain(chainId: string, body: Record<string, unknown>, user: TestUser = owner) {
  return request(app).patch(`/api/chains/${chainId}`).set('Authorization', auth(user)).send(body);
}

describe('chain-appearance 纯函数', () => {
  it('defaultChainColor 与 Web FNV-1a 一致（固定向量）', () => {
    expect(defaultChainColor('00000000-0000-4000-8000-000000000014')).toBe('coral');
    expect(defaultChainColor('11111111-1111-4111-8111-111111111111')).toBe('mint');
    expect(defaultChainColor('abcdefab-1234-4567-89ab-cdef01234567')).toBe('orange');
  });

  it('focusToDb 四舍五入到 0..10000 int，focusFromDb 可逆', () => {
    expect(focusToDb({ x: 0.33333, y: 0.66665 })).toEqual({ x: 3333, y: 6667 });
    expect(focusToDb({ x: 0, y: 1 })).toEqual({ x: 0, y: 10000 });
    expect(focusFromDb(3333, 6667)).toEqual({ x: 0.3333, y: 0.6667 });
    expect(focusFromDb(5000, 5000)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('链视觉归一化（创建）', () => {
  it('无视觉输入创建持久化 id 哈希预设色，DTO 图片字段全 null', async () => {
    const res = await postChain({ name: '默认色链', template: 'daily' });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.color).toBe(defaultChainColor(chain.id));
    expect(chain.icon).toBeNull();
    expect(chain.avatarMediaId).toBeNull();
    expect(chain.avatarUrl).toBeNull();
    expect(chain.avatarFocus).toBeNull();
    expect(chain.coverMediaId).toBeNull();
    expect(chain.coverUrl).toBeNull();
    expect(chain.coverFocus).toBeNull();

    const row = await getChainRow(chain.id);
    expect(row.color).toBe(defaultChainColor(chain.id));
    expect(row.icon).toBeNull();
    expect(row.avatarMediaId).toBeNull();
  });

  it('自定义 hex 统一大写持久化', async () => {
    const res = await postChain({ name: 'hex 链', color: '#a1b2c3', template: 'daily' });
    expect(res.status).toBe(201);
    expect(res.body.color).toBe('#A1B2C3');
    const row = await getChainRow(res.body.id);
    expect(row.color).toBe('#A1B2C3');
    expect(row.icon).toBeNull();
  });

  it('旧 color+icon 组合按 Emoji 优先归一化：存 icon，清 color', async () => {
    const res = await postChain({ name: '旧客户端链', color: 'sky', icon: '✈️', template: 'daily' });
    expect(res.status).toBe(201);
    expect(res.body.icon).toBe('✈️');
    expect(res.body.color).toBeNull();
    const row = await getChainRow(res.body.id);
    expect(row.icon).toBe('✈️');
    expect(row.color).toBeNull();
  });

  it('图片模式：copy tmp→final、DTO 返回稳定 URL 与默认居中焦点、提交后删 tmp', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const res = await postChain({ name: '图片链', avatarMediaId: avatarId, template: 'daily' });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.avatarMediaId).toBe(avatarId);
    expect(chain.avatarUrl).toBe(`/api/media/${avatarId}`);
    expect(chain.avatarFocus).toEqual({ x: 0.5, y: 0.5 });
    expect(chain.color).toBeNull();
    expect(chain.icon).toBeNull();

    const finalKey = `chains/${chain.id}/avatar/${avatarId}.jpeg`;
    expect(storage.copyObject).toHaveBeenCalledWith(`tmp/${avatarId}.jpeg`, finalKey, STORAGE_META);
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${avatarId}.jpeg`, STORAGE_META);
    const mediaRow = await getMediaRow(avatarId);
    expect(mediaRow.s3Key).toBe(finalKey);
    expect(mediaRow.status).toBe('ready');
  });

  it('封面：copy 到 cover 前缀，焦点默认居中；coverFocus 可与封面上传一起提交', async () => {
    const coverId = await insertTmpMedia({ uploaderId: owner.id });
    const res = await postChain({
      name: '封面链',
      coverMediaId: coverId,
      coverFocus: { x: 0.25, y: 0.75 },
      template: 'daily',
    });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.coverMediaId).toBe(coverId);
    expect(chain.coverUrl).toBe(`/api/media/${coverId}`);
    expect(chain.coverFocus).toEqual({ x: 0.25, y: 0.75 });
    expect(storage.copyObject).toHaveBeenCalledWith(
      `tmp/${coverId}.jpeg`,
      `chains/${chain.id}/cover/${coverId}.jpeg`,
      STORAGE_META,
    );
  });

  it('焦点四舍五入到 int 存库，读回除以 10000', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const res = await postChain({
      name: '焦点链',
      avatarMediaId: avatarId,
      avatarFocus: { x: 0.33333, y: 0.66665 },
      template: 'daily',
    });
    expect(res.status).toBe(201);
    expect(res.body.avatarFocus).toEqual({ x: 0.3333, y: 0.6667 });
    const row = await getChainRow(res.body.id);
    expect(row.avatarFocusX).toBe(3333);
    expect(row.avatarFocusY).toBe(6667);
  });

  it('头像与封面引用同一 media → 400 CHAIN_MEDIA_DUPLICATED', async () => {
    const mediaId = await insertTmpMedia({ uploaderId: owner.id });
    const res = await postChain({ name: '重复链', avatarMediaId: mediaId, coverMediaId: mediaId, template: 'daily' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CHAIN_MEDIA_DUPLICATED');
  });
});

describe('链图片绑定校验', () => {
  it('media 不存在或不属本人 → 404 MEDIA_NOT_FOUND', async () => {
    const missing = await postChain({ name: 'x', avatarMediaId: randomUUID(), template: 'daily' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('MEDIA_NOT_FOUND');

    const foreign = await insertTmpMedia({ uploaderId: outsider.id });
    const res = await postChain({ name: 'x', avatarMediaId: foreign, template: 'daily' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('status 非 ready → 400 MEDIA_INVALID；非 raster mime → 400 MEDIA_INVALID', async () => {
    const uploading = await insertTmpMedia({ uploaderId: owner.id, status: 'uploading' });
    const res1 = await postChain({ name: 'x', avatarMediaId: uploading, template: 'daily' });
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('MEDIA_INVALID');

    const video = await insertTmpMedia({ uploaderId: owner.id, mime: 'video/mp4' });
    const res2 = await postChain({ name: 'x', avatarMediaId: video, template: 'daily' });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('MEDIA_INVALID');
  });

  it('已绑定 moment → 400 MEDIA_ALREADY_BOUND', async () => {
    const chainRes = await postChain({ name: '占位链', template: 'daily' });
    const chainId = (chainRes.body as ChainDto).id;
    const momentId = randomUUID();
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: owner.id,
      type: 'media',
      content: 'with photo',
      happenedAt: new Date('2026-08-15T10:00:00Z'),
      happenedTzOffset: -480,
      wallDate: wallDateOf(new Date('2026-08-15T10:00:00Z'), -480),
    });
    const momentBound = await insertTmpMedia({ uploaderId: owner.id, momentId });
    const res = await postChain({ name: 'x', avatarMediaId: momentBound, template: 'daily' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
  });

  it('被用户头像引用 → 400 MEDIA_ALREADY_BOUND', async () => {
    const avatarMediaId = await insertTmpMedia({ uploaderId: owner.id });
    await db.update(users).set({ avatarMediaId }).where(eq(users.id, owner.id));
    const res = await postChain({ name: 'x', avatarMediaId, template: 'daily' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
  });

  it('被其他链 avatar/cover 引用 → 400 MEDIA_ALREADY_BOUND', async () => {
    const mediaId = await insertTmpMedia({ uploaderId: owner.id });
    const first = await postChain({ name: '第一链', avatarMediaId: mediaId, template: 'daily' });
    expect(first.status).toBe(201);
    const res = await postChain({ name: '第二链', coverMediaId: mediaId, template: 'daily' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
  });

  it('editor/viewer 不能绑定链图片（403 CHAIN_ROLE_INSUFFICIENT）', async () => {
    const chainRes = await postChain({ name: '权限链', template: 'daily' });
    const chain = chainRes.body as ChainDto;
    const editor = await createUser(app, 'editor@example.com');
    await addMember(chain.id, editor.id, 'editor');
    const mediaId = await insertTmpMedia({ uploaderId: editor.id });
    const res = await patchChain(chain.id, { avatarMediaId: mediaId }, editor);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });
});

describe('链视觉归一化（更新）', () => {
  it('三模式往返：图片 → Emoji → 纯色 → 图片，互斥字段清空、旧媒体 orphaned', async () => {
    const avatarA = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '往返链', avatarMediaId: avatarA, template: 'daily' });
    const chain = created.body as ChainDto;

    // 图片 → Emoji：avatarMediaId 清空，旧图片标 orphaned + orphanedAt
    const toEmoji = await patchChain(chain.id, { icon: '🌱' });
    expect(toEmoji.status).toBe(200);
    expect(toEmoji.body.avatarMediaId).toBeNull();
    expect(toEmoji.body.avatarUrl).toBeNull();
    expect(toEmoji.body.avatarFocus).toBeNull();
    expect(toEmoji.body.icon).toBe('🌱');
    expect(toEmoji.body.color).toBeNull();
    const rowA = await getMediaRow(avatarA);
    expect(rowA.status).toBe('orphaned');
    expect(rowA.orphanedAt).not.toBeNull();
    let chainRow = await getChainRow(chain.id);
    expect(chainRow.avatarMediaId).toBeNull();
    expect(chainRow.color).toBeNull();

    // Emoji → 纯色
    const toColor = await patchChain(chain.id, { color: '#00ffaa' });
    expect(toColor.status).toBe(200);
    expect(toColor.body.icon).toBeNull();
    expect(toColor.body.color).toBe('#00FFAA');
    chainRow = await getChainRow(chain.id);
    expect(chainRow.icon).toBeNull();

    // 纯色 → 图片
    const avatarB = await insertTmpMedia({ uploaderId: owner.id });
    const toImage = await patchChain(chain.id, { avatarMediaId: avatarB });
    expect(toImage.status).toBe(200);
    expect(toImage.body.avatarMediaId).toBe(avatarB);
    expect(toImage.body.avatarUrl).toBe(`/api/media/${avatarB}`);
    expect(toImage.body.color).toBeNull();
    expect(toImage.body.icon).toBeNull();
  });

  it('同一 media 幂等：只更新焦点，不重复 copy、不标 orphaned', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '幂等链', avatarMediaId: avatarId, template: 'daily' });
    const chain = created.body as ChainDto;
    expect(storage.copyObject).toHaveBeenCalledTimes(1);

    const res = await patchChain(chain.id, { avatarMediaId: avatarId, avatarFocus: { x: 0.2, y: 0.8 } });
    expect(res.status).toBe(200);
    expect(res.body.avatarMediaId).toBe(avatarId);
    expect(res.body.avatarFocus).toEqual({ x: 0.2, y: 0.8 });
    expect(storage.copyObject).toHaveBeenCalledTimes(1);
    const mediaRow = await getMediaRow(avatarId);
    expect(mediaRow.status).toBe('ready');
    expect(mediaRow.orphanedAt).toBeNull();
  });

  it('单独调整焦点：当前是图片 → 200；当前无图片 → 400 CHAIN_AVATAR_FOCUS_INVALID', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '焦点链', avatarMediaId: avatarId, template: 'daily' });
    const chain = created.body as ChainDto;

    const ok = await patchChain(chain.id, { avatarFocus: { x: 0.1, y: 0.9 } });
    expect(ok.status).toBe(200);
    expect(ok.body.avatarFocus).toEqual({ x: 0.1, y: 0.9 });
    expect(storage.copyObject).toHaveBeenCalledTimes(1);

    const noImage = await postChain({ name: '无图链', template: 'daily' });
    const bad = await patchChain((noImage.body as ChainDto).id, { avatarFocus: { x: 0.5, y: 0.5 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CHAIN_AVATAR_FOCUS_INVALID');
  });

  it('显式 avatarMediaId:null 且无新模式 → 回退持久化默认纯色，旧图片 orphaned', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '回退链', avatarMediaId: avatarId, template: 'daily' });
    const chain = created.body as ChainDto;

    const res = await patchChain(chain.id, { avatarMediaId: null });
    expect(res.status).toBe(200);
    expect(res.body.avatarMediaId).toBeNull();
    expect(res.body.icon).toBeNull();
    expect(res.body.color).toBe(defaultChainColor(chain.id));
    const row = await getChainRow(chain.id);
    expect(row.color).toBe(defaultChainColor(chain.id));
    const mediaRow = await getMediaRow(avatarId);
    expect(mediaRow.status).toBe('orphaned');
    expect(mediaRow.orphanedAt).not.toBeNull();
  });

  it('替换头像：新媒体 copy + 旧媒体 orphaned，tmp 提交后清理', async () => {
    const avatarA = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '替换链', avatarMediaId: avatarA, template: 'daily' });
    const chain = created.body as ChainDto;

    const avatarB = await insertTmpMedia({ uploaderId: owner.id });
    const res = await patchChain(chain.id, { avatarMediaId: avatarB });
    expect(res.status).toBe(200);
    expect(res.body.avatarMediaId).toBe(avatarB);

    const finalB = `chains/${chain.id}/avatar/${avatarB}.jpeg`;
    expect(storage.copyObject).toHaveBeenCalledWith(`tmp/${avatarB}.jpeg`, finalB, STORAGE_META);
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${avatarB}.jpeg`, STORAGE_META);
    const rowA = await getMediaRow(avatarA);
    expect(rowA.status).toBe('orphaned');
    expect(rowA.orphanedAt).not.toBeNull();
    const rowB = await getMediaRow(avatarB);
    expect(rowB.s3Key).toBe(finalB);
    expect(rowB.status).toBe('ready');
  });

  it('copy 失败：旧引用不变、旧媒体仍 ready、新媒体仍 tmp/ready（copy 原子失败无 final 可清）', async () => {
    const avatarA = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '回滚链', avatarMediaId: avatarA, template: 'daily' });
    const chain = created.body as ChainDto;
    const finalA = `chains/${chain.id}/avatar/${avatarA}.jpeg`;

    const avatarB = await insertTmpMedia({ uploaderId: owner.id });
    storage.copyObject.mockRejectedValueOnce(new Error('s3 copy boom'));
    const res = await patchChain(chain.id, { avatarMediaId: avatarB });
    expect(res.status).toBe(500);

    const chainRow = await getChainRow(chain.id);
    expect(chainRow.avatarMediaId).toBe(avatarA);
    const rowA = await getMediaRow(avatarA);
    expect(rowA.status).toBe('ready');
    expect(rowA.s3Key).toBe(finalA);
    const rowB = await getMediaRow(avatarB);
    expect(rowB.status).toBe('ready');
    expect(rowB.s3Key).toBe(`tmp/${avatarB}.jpeg`);
    // copy 原子失败：final 对象从未产生，rollback 不应删除它
    const finalB = `chains/${chain.id}/avatar/${avatarB}.jpeg`;
    expect(storage.deleteFile).not.toHaveBeenCalledWith(finalB, STORAGE_META);
  });

  it('copy 成功后事务失败：rollback 删除已产生的 final 对象，链与媒体行不留半截状态', async () => {
    // create 同时绑头像+封面，第二次 copy（封面）失败 → 事务回滚，
    // 头像的 final 对象已 copy 成功，必须由 rollback 补偿删除
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const coverId = await insertTmpMedia({ uploaderId: owner.id });
    storage.copyObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('s3 copy boom'));
    const res = await postChain({ name: '回滚链', avatarMediaId: avatarId, coverMediaId: coverId, template: 'daily' });
    expect(res.status).toBe(500);

    // 头像 copy 已成功：其 finalKey 从 copyObject 调用参数取得，rollback 必须删除它
    const copiedFinalKey = storage.copyObject.mock.calls[0]![1] as string;
    expect(copiedFinalKey).toMatch(new RegExp(`^chains/.+/avatar/${avatarId}\\.jpeg$`));
    expect(storage.deleteFile).toHaveBeenCalledWith(copiedFinalKey, STORAGE_META);

    // 链未创建（owner 的链列表为空），两个 media 行仍指向 tmp 且保持 ready，可重试
    const list = await request(app).get('/api/chains').set('Authorization', auth(owner));
    expect(list.body).toEqual([]);
    for (const id of [avatarId, coverId]) {
      const row = await getMediaRow(id);
      expect(row.status).toBe('ready');
      expect(row.s3Key).toBe(`tmp/${id}.jpeg`);
    }
  });

  it('coverMediaId:null 删除封面并把焦点重置为中心；无封面时单独 coverFocus → 400', async () => {
    const coverId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({
      name: '封面链',
      coverMediaId: coverId,
      coverFocus: { x: 0.3, y: 0.4 },
      template: 'daily',
    });
    const chain = created.body as ChainDto;
    expect(chain.coverFocus).toEqual({ x: 0.3, y: 0.4 });

    // 单独调整封面焦点
    const refocus = await patchChain(chain.id, { coverFocus: { x: 0.6, y: 0.7 } });
    expect(refocus.status).toBe(200);
    expect(refocus.body.coverFocus).toEqual({ x: 0.6, y: 0.7 });

    const cleared = await patchChain(chain.id, { coverMediaId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.coverMediaId).toBeNull();
    expect(cleared.body.coverUrl).toBeNull();
    expect(cleared.body.coverFocus).toBeNull();
    const row = await getChainRow(chain.id);
    expect(row.coverMediaId).toBeNull();
    expect(row.coverFocusX).toBe(5000);
    expect(row.coverFocusY).toBe(5000);
    const coverRow = await getMediaRow(coverId);
    expect(coverRow.status).toBe('orphaned');
    expect(coverRow.orphanedAt).not.toBeNull();

    const bad = await patchChain(chain.id, { coverFocus: { x: 0.5, y: 0.5 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CHAIN_COVER_FOCUS_INVALID');
  });

  it('update 把封面设为当前头像同一 media → 400 CHAIN_MEDIA_DUPLICATED', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({ name: '查重链', avatarMediaId: avatarId, template: 'daily' });
    const res = await patchChain((created.body as ChainDto).id, { coverMediaId: avatarId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CHAIN_MEDIA_DUPLICATED');
  });
});

describe('稳定 DTO 与链删除', () => {
  it('列表与详情返回稳定 /api/media/:id URL；关联非 ready 时三项全 null', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const coverId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({
      name: '稳定链',
      avatarMediaId: avatarId,
      coverMediaId: coverId,
      template: 'daily',
    });
    const chain = created.body as ChainDto;

    const list = await request(app).get('/api/chains').set('Authorization', auth(owner));
    const listed = (list.body as ChainDto[]).find((c) => c.id === chain.id)!;
    expect(listed.avatarUrl).toBe(`/api/media/${avatarId}`);
    expect(listed.coverUrl).toBe(`/api/media/${coverId}`);

    // 关联 media 变为非 ready：该 placement 三项全部 null
    await db.update(media).set({ status: 'uploading' }).where(eq(media.id, avatarId));
    const detail = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(detail.status).toBe(200);
    expect(detail.body.avatarMediaId).toBeNull();
    expect(detail.body.avatarUrl).toBeNull();
    expect(detail.body.avatarFocus).toBeNull();
    expect(detail.body.coverUrl).toBe(`/api/media/${coverId}`);
  });

  it('删链把 avatar/cover media 标 orphaned 并写 orphanedAt', async () => {
    const avatarId = await insertTmpMedia({ uploaderId: owner.id });
    const coverId = await insertTmpMedia({ uploaderId: owner.id });
    const created = await postChain({
      name: '将删链',
      avatarMediaId: avatarId,
      coverMediaId: coverId,
      template: 'daily',
    });
    const chain = created.body as ChainDto;

    const res = await request(app).delete(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(204);
    for (const id of [avatarId, coverId]) {
      const row = await getMediaRow(id);
      expect(row.status).toBe('orphaned');
      expect(row.orphanedAt).not.toBeNull();
    }
  });
});
