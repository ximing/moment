/**
 * E2E fixture seeder（plan Task 14）：唯一写 DB/存储的生产者。
 * 只接受已解析凭据，绝不读 process.env；守卫在 fixture-cli 层先行通过。
 * 不创建 HTTP endpoint/controller/route、不建第二个 adapter、不调 resetDb()。
 */
import { hashPassword } from '../auth/password.js';
import { db, pool } from '../db/index.js';
import {
  chainInvites,
  chainMembers,
  chains,
  comments,
  media,
  momentPersons,
  momentTags,
  moments,
  notifications,
  outbox,
  persons,
  pushTokens,
  reactions,
  refreshTokens,
  shareLinks,
  tags,
  users,
} from '../db/schema.js';
import { currentStorageMeta, getStorage } from '../storage/factory.js';
import { FIXTURE_IMAGE_PNG, FIXTURE_IMAGE_STORAGE_KEY } from './fixture-asset.js';
import type { E2eFixtureCredentials } from './fixture-cli-contract.js';
import {
  buildFixtureRows,
  chainId,
  FIXTURE_API_BASE_URL,
  FIXTURE_INVITE_TOKEN,
  FIXTURE_OWNER_NICKNAME,
  FIXTURE_SHARE_TOKEN,
  FIXTURE_VIEWER_NICKNAME,
  FIXTURE_WEB_BASE_URL,
  FIXTURE_FIXED_NOW,
  imageMomentId,
  inviteId,
  mediaId,
  momentId,
  ownerId,
  personId,
  shareLinkId,
  tagId,
  viewerId,
} from './fixture-rows.js';

/** seed 结果（不含口令）：Web 侧 runner 据此驱动可见登录与截图矩阵。 */
export type DesignSystemFixture = {
  owner: { id: string; email: string; nickname: string };
  viewer: { id: string; email: string; nickname: string };
  tagId: string;
  personId: string;
  chainId: string;
  momentId: string;
  imageMomentId: string;
  mediaId: string;
  shareLinkId: string;
  inviteId: string;
  shareToken: string;
  inviteToken: string;
  fixedNow: string;
  apiBaseUrl: string;
  webBaseUrl: string;
};

/**
 * reset：删除 fixture 上传对象（幂等），再按外键逆序清空各表。
 * 安全性来自守卫：MYSQL_DATABASE 必须整串等于 moment_e2e（专用一次性库）。
 */
export async function resetFixture(): Promise<{ ok: true }> {
  const storage = getStorage();
  const storageMeta = currentStorageMeta();
  if (await storage.fileExists(FIXTURE_IMAGE_STORAGE_KEY)) {
    await storage.deleteFile(FIXTURE_IMAGE_STORAGE_KEY, storageMeta);
  }
  // 外键逆序：pushTokens, notifications, reactions, comments, momentTags, momentPersons, tags, persons,
  // outbox, media, moments, chainInvites, chainMembers, shareLinks, chains, refreshTokens, users
  // chains→media 与 media→moments→chains 构成引用环：delete(media) 前先显式断开链的图片引用
  await db.delete(pushTokens);
  await db.delete(notifications);
  await db.delete(reactions);
  await db.delete(comments);
  await db.delete(momentTags);
  await db.delete(momentPersons);
  await db.delete(tags);
  await db.delete(persons);
  await db.delete(outbox);
  await db.update(chains).set({ avatarMediaId: null, coverMediaId: null });
  await db.delete(media);
  await db.delete(moments);
  await db.delete(chainInvites);
  await db.delete(chainMembers);
  await db.delete(shareLinks);
  await db.delete(chains);
  await db.delete(refreshTokens);
  await db.delete(users);
  return { ok: true };
}

/**
 * seed：先 reset，上传精确 PNG，捕获存储快照，经 buildFixtureRows 构造行后
 * 事务性逐行插入（不改写任何值、不依赖隐式默认）。事务失败则删除已上传对象并 rethrow。
 * invite 故意指向已是成员的 viewer：现行幂等 accept 语义返回该链，
 * 精确的未来到期时间 2036 年前持续有效且可重复。
 */
export async function seedFixture(credentials: E2eFixtureCredentials): Promise<DesignSystemFixture> {
  await resetFixture();
  const storage = getStorage();
  const storageMeta = currentStorageMeta();
  await storage.uploadFile(FIXTURE_IMAGE_STORAGE_KEY, FIXTURE_IMAGE_PNG);
  try {
    const rows = await buildFixtureRows(credentials, { hashPassword, storageMeta });
    await db.transaction(async (tx) => {
      await tx.insert(users).values(rows.users);
      await tx.insert(chains).values(rows.chains);
      await tx.insert(chainMembers).values(rows.chainMembers);
      await tx.insert(moments).values(rows.moments);
      await tx.insert(media).values(rows.media);
      await tx.insert(tags).values(rows.tags);
      await tx.insert(momentTags).values(rows.momentTags);
      await tx.insert(persons).values(rows.persons);
      await tx.insert(momentPersons).values(rows.momentPersons);
      await tx.insert(shareLinks).values(rows.shareLinks);
      await tx.insert(chainInvites).values(rows.chainInvites);
    });
  } catch (error) {
    await storage.deleteFile(FIXTURE_IMAGE_STORAGE_KEY, storageMeta).catch(() => undefined);
    throw error;
  }
  return {
    owner: { id: ownerId, email: credentials.owner.email, nickname: FIXTURE_OWNER_NICKNAME },
    viewer: { id: viewerId, email: credentials.viewer.email, nickname: FIXTURE_VIEWER_NICKNAME },
    tagId,
    personId,
    chainId,
    momentId,
    imageMomentId,
    mediaId,
    shareLinkId,
    inviteId,
    shareToken: FIXTURE_SHARE_TOKEN,
    inviteToken: FIXTURE_INVITE_TOKEN,
    fixedNow: FIXTURE_FIXED_NOW,
    apiBaseUrl: FIXTURE_API_BASE_URL,
    webBaseUrl: FIXTURE_WEB_BASE_URL,
  };
}

export async function teardownFixture(): Promise<{ ok: true }> {
  return resetFixture();
}

export async function closeFixtureDb(): Promise<void> {
  await pool.end();
}
