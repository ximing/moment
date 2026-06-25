/**
 * E2E fixture 行工厂（plan Task 14）：DB-free 的确定性行构造。
 * 无 config / DB / storage 运行时 import（schema 仅 type-only，编译期擦除），
 * 无副作用；hashPassword 与 storageMeta 全部注入，时间只由固定常量派生（不碰 Date.now()）。
 */
import type {
  chainMembers,
  momentTags,
  NewChain,
  NewChainInvite,
  NewMedia,
  NewMoment,
  NewShareLink,
  NewTag,
  NewUser,
} from '../db/schema.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import type { E2eFixtureCredentials } from './fixture-cli-contract.js';
import { FIXTURE_IMAGE_MIME, FIXTURE_IMAGE_PNG, FIXTURE_IMAGE_STORAGE_KEY } from './fixture-asset.js';

export const ownerId = '00000000-0000-4000-8000-000000000011';
export const viewerId = '00000000-0000-4000-8000-000000000012';
export const tagId = '00000000-0000-4000-8000-000000000013';
export const chainId = '00000000-0000-4000-8000-000000000014';
export const momentId = '00000000-0000-4000-8000-000000000015';
export const imageMomentId = '00000000-0000-4000-8000-000000000016';
export const mediaId = '00000000-0000-4000-8000-000000000017';
export const shareLinkId = '00000000-0000-4000-8000-000000000018';
export const inviteId = '00000000-0000-4000-8000-000000000019';

export const FIXTURE_FIXED_NOW = '2026-08-18T09:30:00.000Z';
/** 3650 天（10 年）：share/invite 到期时间 = fixedNow + 3650d，2036 年前持续有效且可重复。 */
export const FIXTURE_EXPIRY_MS = 315360000000;

export const FIXTURE_OWNER_NICKNAME = '林晓满';
export const FIXTURE_VIEWER_NICKNAME = '周小禾';
export const FIXTURE_SHARE_TOKEN = 'e2e-design-system-share-token';
export const FIXTURE_INVITE_TOKEN = 'e2e-design-system-invite-token';

export const FIXTURE_CHAIN_NAME = '我们一起走过的很长很长的时光链名字';
export const FIXTURE_TAG_NAME = '跨年旅行与新年第一束光和家人的漫长回忆';
export const FIXTURE_TEXT_MOMENT_CONTENT = '2025 年最后一天：一起把这一年的温柔收好。';
export const FIXTURE_IMAGE_MOMENT_CONTENT = '2026 年第一天：新年的第一束光。';

export const FIXTURE_API_BASE_URL = 'http://127.0.0.1:3000/api';
export const FIXTURE_WEB_BASE_URL = 'http://127.0.0.1:5173';

type NewChainMember = typeof chainMembers.$inferInsert;
type NewMomentTag = typeof momentTags.$inferInsert;

export interface FixtureRows {
  users: NewUser[];
  chains: NewChain[];
  chainMembers: NewChainMember[];
  moments: NewMoment[];
  media: NewMedia[];
  tags: NewTag[];
  momentTags: NewMomentTag[];
  shareLinks: NewShareLink[];
  chainInvites: NewChainInvite[];
}

export async function buildFixtureRows(
  credentials: E2eFixtureCredentials,
  deps: {
    hashPassword(plain: string): Promise<string>;
    storageMeta: StorageMetadata;
  },
): Promise<FixtureRows> {
  const fixedNow = new Date(FIXTURE_FIXED_NOW);
  const expiry = new Date(fixedNow.getTime() + FIXTURE_EXPIRY_MS);

  // 注入的既有 hash 函数每个密码恰好调用一次；只有返回的 hash 进入 users.passwordHash。
  const ownerPasswordHash = await deps.hashPassword(credentials.owner.password);
  const viewerPasswordHash = await deps.hashPassword(credentials.viewer.password);

  return {
    users: [
      {
        id: ownerId,
        email: credentials.owner.email,
        passwordHash: ownerPasswordHash,
        nickname: FIXTURE_OWNER_NICKNAME,
        passwordChangedAt: null,
        createdAt: fixedNow,
        avatarMediaId: null,
        avatarColor: null,
        avatarIcon: null,
      },
      {
        id: viewerId,
        email: credentials.viewer.email,
        passwordHash: viewerPasswordHash,
        nickname: FIXTURE_VIEWER_NICKNAME,
        passwordChangedAt: null,
        createdAt: fixedNow,
        avatarMediaId: null,
        avatarColor: null,
        avatarIcon: null,
      },
    ],
    chains: [
      {
        id: chainId,
        name: FIXTURE_CHAIN_NAME,
        description: '一起收藏日常',
        coverMediaId: null,
        color: null,
        icon: null,
        visibility: 'private',
        ownerId,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      },
    ],
    chainMembers: [
      { chainId, userId: ownerId, role: 'owner', joinedAt: fixedNow },
      { chainId, userId: viewerId, role: 'viewer', joinedAt: fixedNow },
    ],
    moments: [
      {
        id: momentId,
        chainId,
        authorId: ownerId,
        type: 'text',
        content: FIXTURE_TEXT_MOMENT_CONTENT,
        happenedAt: new Date('2025-12-31T15:30:00.000Z'),
        happenedTzOffset: -480,
        isBackfill: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      },
      {
        id: imageMomentId,
        chainId,
        authorId: viewerId,
        type: 'media',
        content: FIXTURE_IMAGE_MOMENT_CONTENT,
        happenedAt: new Date('2026-01-01T00:30:00.000Z'),
        happenedTzOffset: -480,
        isBackfill: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      },
    ],
    media: [
      {
        id: mediaId,
        momentId: imageMomentId,
        uploaderId: viewerId,
        s3Key: FIXTURE_IMAGE_STORAGE_KEY,
        mime: FIXTURE_IMAGE_MIME,
        size: FIXTURE_IMAGE_PNG.byteLength,
        width: 64,
        height: 48,
        duration: null,
        posterMediaId: null,
        sortOrder: 0,
        status: 'ready',
        storageMeta: deps.storageMeta,
        uploadId: null,
        createdAt: fixedNow,
      },
    ],
    tags: [
      {
        id: tagId,
        chainId,
        name: FIXTURE_TAG_NAME,
        createdAt: fixedNow,
      },
    ],
    momentTags: [{ momentId, tagId }],
    shareLinks: [
      {
        id: shareLinkId,
        chainId,
        token: FIXTURE_SHARE_TOKEN,
        createdBy: ownerId,
        expiresAt: expiry,
        revokedAt: null,
        createdAt: fixedNow,
      },
    ],
    chainInvites: [
      {
        id: inviteId,
        chainId,
        token: FIXTURE_INVITE_TOKEN,
        email: credentials.viewer.email,
        role: 'viewer',
        createdBy: ownerId,
        expiresAt: expiry,
        acceptedAt: null,
        createdAt: fixedNow,
      },
    ],
  };
}
