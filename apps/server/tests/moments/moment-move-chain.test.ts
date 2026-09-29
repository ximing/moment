import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { comments, media, momentPersons, momentTags, moments, outbox, reactions } from '../../src/db/schema.js';
import { config } from '../../src/config.js';
import { computeEmbedHash } from '../../src/moments/embed-hash.js';
import { OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';

let storage: MockStorage;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

const happened = {
  happenedAt: '2026-08-29T10:00:00.000Z',
  happenedTzOffset: -480,
};

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set(auth(token)).send({ ...happened, ...body });
}

function patchMoment(token: string, momentId: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/moments/${momentId}`).set(auth(token)).send(body);
}

async function createTag(chainId: string, token: string, name: string): Promise<string> {
  const res = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function createPerson(chainId: string, token: string, name: string): Promise<string> {
  const res = await request(app).post(`/api/chains/${chainId}/persons`).set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function readyImage(token: string): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set(auth(token))
    .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
  expect(presigned.status).toBe(201);
  storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });
  const done = await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set(auth(token)).send({});
  expect(done.status).toBe(200);
  return presigned.body.mediaId as string;
}

describe('PATCH /api/moments/:id chainId', () => {
  it('作者换到自己可编辑的链：标签和人物清空，评论和表情留在原时刻上', async () => {
    const author = await registerUser();
    const friend = await registerUser();
    const source = await createChain(author.id, '原来', 'daily');
    const dest = await createChain(friend.id, '过去', 'daily');
    await addMember(dest, author.id, 'editor');
    await addMember(source, friend.id, 'editor');
    const tagId = await createTag(source, author.token, '家里');
    const personId = await createPerson(source, author.token, '外婆');
    const created = await postMoment(author.token, source, {
      type: 'text',
      content: '在外婆家',
      tagIds: [tagId],
      personIds: [personId],
    });
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;

    const comment = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(friend.token))
      .send({ content: '留下' });
    expect(comment.status).toBe(201);
    const reaction = await request(app)
      .put(`/api/moments/${momentId}/reaction`)
      .set(auth(friend.token))
      .send({ emoji: '🎉' });
    expect(reaction.status).toBe(204);

    const res = await patchMoment(author.token, momentId, { chainId: dest });
    expect(res.status).toBe(200);
    expect(res.body.chainId).toBe(dest);
    expect(res.body.tags).toEqual([]);
    expect(res.body.persons).toEqual([]);

    const [row] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(row?.chainId).toBe(dest);
    expect(await db.select().from(momentTags).where(eq(momentTags.momentId, momentId))).toHaveLength(0);
    expect(await db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId))).toHaveLength(0);
    const [keptComment] = await db.select().from(comments).where(eq(comments.momentId, momentId));
    expect(keptComment?.content).toBe('留下');
    const [keptReaction] = await db.select().from(reactions).where(eq(reactions.momentId, momentId));
    expect(keptReaction?.emoji).toBe('🎉');
  });

  it('chainId 与当前链相同：不因此清空标签', async () => {
    const author = await registerUser();
    const source = await createChain(author.id, '原来', 'daily');
    const tagId = await createTag(source, author.token, '家里');
    const created = await postMoment(author.token, source, {
      type: 'text',
      content: '在外婆家',
      tagIds: [tagId],
    });
    expect(created.status).toBe(201);
    const res = await patchMoment(author.token, created.body.id, { chainId: source, content: '改一句' });
    expect(res.status).toBe(200);
    expect(res.body.chainId).toBe(source);
    expect(res.body.tags.map((t: { id: string }) => t.id)).toEqual([tagId]);
    expect(res.body.content).toBe('改一句');
  });

  it('显式带上目标链的标签会挂上；旧链标签被拒且时刻仍在原链', async () => {
    const author = await registerUser();
    const source = await createChain(author.id, '原来', 'daily');
    const dest = await createChain(author.id, '过去', 'daily');
    const oldTag = await createTag(source, author.token, '旧');
    const newTag = await createTag(dest, author.token, '新');
    const created = await postMoment(author.token, source, {
      type: 'text',
      content: '一条',
      tagIds: [oldTag],
    });
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;

    const ok = await patchMoment(author.token, momentId, { chainId: dest, tagIds: [newTag] });
    expect(ok.status).toBe(200);
    expect(ok.body.tags.map((t: { id: string }) => t.id)).toEqual([newTag]);

    const back = await patchMoment(author.token, momentId, { chainId: source, tagIds: [newTag] });
    expect(back.status).toBe(400);
    expect(back.body.error.code).toBe('TAG_NOT_IN_CHAIN');
    const [row] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(row?.chainId).toBe(dest);
    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(links.map((t) => t.tagId)).toEqual([newTag]);
  });

  it('目标链的人物能挂上；旧链人物被拒', async () => {
    const author = await registerUser();
    const source = await createChain(author.id, '原来', 'daily');
    const dest = await createChain(author.id, '过去', 'daily');
    const oldPerson = await insertPerson({ chainId: source, name: '外婆' });
    const newPerson = await createPerson(dest, author.token, '朵朵');
    const created = await postMoment(author.token, source, {
      type: 'text',
      content: '一条',
      personIds: [oldPerson],
    });
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;

    const rejected = await patchMoment(author.token, momentId, { chainId: dest, personIds: [oldPerson] });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('PERSON_NOT_IN_CHAIN');
    const [stayed] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(stayed?.chainId).toBe(source);

    const ok = await patchMoment(author.token, momentId, { chainId: dest, personIds: [newPerson] });
    expect(ok.status).toBe(200);
    expect(ok.body.persons.map((p: { id: string }) => p.id)).toEqual([newPerson]);
  });

  it('模板不同：即使同包带了 kind/payload，也收成 standard 且 payload 为空', async () => {
    const author = await registerUser();
    const baby = await createChain(author.id, '宝宝', 'baby');
    const daily = await createChain(author.id, '日常', 'daily');
    const created = await postMoment(author.token, baby, {
      type: 'text',
      content: '第一次走路',
      kind: 'milestone',
      payload: { custom_label: '第一次走路' },
    });
    expect(created.status).toBe(201);
    const res = await patchMoment(author.token, created.body.id, {
      chainId: daily,
      kind: 'milestone',
      payload: { custom_label: '第一次走路' },
    });
    expect(res.status).toBe(200);
    expect(res.body.chainId).toBe(daily);
    expect(res.body.kind).toBe('standard');
    expect(res.body.payload).toBeNull();
  });

  it('模板相同：不传 kind/payload 时结构化内容留着', async () => {
    const author = await registerUser();
    const source = await createChain(author.id, '甲', 'daily');
    const dest = await createChain(author.id, '乙', 'daily');
    const created = await postMoment(author.token, source, {
      type: 'text',
      content: '今天',
      payload: { mood: '😄' },
    });
    expect(created.status).toBe(201);
    const res = await patchMoment(author.token, created.body.id, { chainId: dest });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('standard');
    expect(res.body.payload).toEqual({ mood: '😄' });
  });

  it('非作者即使在目标链是 owner 也不能换', async () => {
    const author = await registerUser();
    const other = await registerUser();
    const source = await createChain(author.id, '原来', 'daily');
    const dest = await createChain(other.id, '别人的', 'daily');
    await addMember(source, other.id, 'editor');
    const created = await postMoment(author.token, source, { type: 'text', content: '我的' });
    expect(created.status).toBe(201);
    const res = await patchMoment(other.token, created.body.id, { chainId: dest });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_MOMENT_AUTHOR');
    const [row] = await db.select().from(moments).where(eq(moments.id, created.body.id));
    expect(row?.chainId).toBe(source);
  });

  it('作者在目标链只是 viewer → CHAIN_ROLE_INSUFFICIENT；不是成员 → CHAIN_NOT_FOUND', async () => {
    const author = await registerUser();
    const owner = await registerUser();
    const source = await createChain(author.id, '原来', 'daily');
    const asViewer = await createChain(owner.id, '只看', 'daily');
    const hidden = await createChain(owner.id, '看不见', 'daily');
    await addMember(asViewer, author.id, 'viewer');
    const created = await postMoment(author.token, source, { type: 'text', content: '我的' });
    expect(created.status).toBe(201);

    const viewer = await patchMoment(author.token, created.body.id, { chainId: asViewer });
    expect(viewer.status).toBe(403);
    expect(viewer.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const missing = await patchMoment(author.token, created.body.id, { chainId: hidden });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CHAIN_NOT_FOUND');

    const [row] = await db.select().from(moments).where(eq(moments.id, created.body.id));
    expect(row?.chainId).toBe(source);
  });

  it('嵌入指纹已吻合时换链仍发出 moment.embed，向量不会留在旧链', async () => {
    const author = await registerUser();
    const source = await createChain(author.id, '甲', 'daily');
    const dest = await createChain(author.id, '乙', 'daily');
    const created = await postMoment(author.token, source, { type: 'text', content: '指纹不变' });
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;
    const hash = computeEmbedHash({
      content: '指纹不变',
      transcript: null,
      personNames: [],
      placeName: null,
      derivedFingerprint: '',
      model: config.MULTIMODAL_EMBEDDING_MODEL,
      dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
    });
    await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
    const before = await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EMBED));

    const res = await patchMoment(author.token, momentId, { chainId: dest });
    expect(res.status).toBe(200);

    const after = await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EMBED));
    const beforeIds = new Set(before.map((row) => row.id));
    const added = after.filter((row) => !beforeIds.has(row.id));
    expect(added).toHaveLength(1);
    expect(added[0]?.payload).toEqual({ momentId, chainId: dest });
    const [row] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(row?.embedHash).toBeNull();
  });

  it('已绑定的媒体留在原 key；同一次换链新加的图落到目标链 key', async () => {
    const author = await registerUser();
    const source = await createChain(author.id, '甲', 'daily');
    const dest = await createChain(author.id, '乙', 'daily');
    const keptId = await readyImage(author.token);
    const created = await postMoment(author.token, source, {
      type: 'media',
      content: '有图',
      mediaIds: [keptId],
    });
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;
    const [keptBefore] = await db.select().from(media).where(eq(media.id, keptId));

    const moved = await patchMoment(author.token, momentId, { chainId: dest });
    expect(moved.status).toBe(200);
    const [keptAfter] = await db.select().from(media).where(eq(media.id, keptId));
    expect(keptAfter?.s3Key).toBe(keptBefore?.s3Key);
    expect(keptAfter?.s3Key.startsWith(`chains/${source}/`)).toBe(true);

    const freshId = await readyImage(author.token);
    const home = await createChain(author.id, '丙', 'daily');
    const withNew = await patchMoment(author.token, momentId, { chainId: home, mediaIds: [keptId, freshId] });
    expect(withNew.status).toBe(200);
    const [fresh] = await db.select().from(media).where(eq(media.id, freshId));
    expect(fresh?.s3Key.startsWith(`chains/${home}/${momentId}/`)).toBe(true);
    const [keptStill] = await db.select().from(media).where(eq(media.id, keptId));
    expect(keptStill?.s3Key).toBe(keptBefore?.s3Key);
  });
});
