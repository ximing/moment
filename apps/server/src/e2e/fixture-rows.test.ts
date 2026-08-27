import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FIXTURE_IMAGE_MIME, FIXTURE_IMAGE_PNG, FIXTURE_IMAGE_STORAGE_KEY } from './fixture-asset.js';
import {
  buildFixtureRows,
  chainId,
  FIXTURE_EXPIRY_MS,
  FIXTURE_FIXED_NOW,
  FIXTURE_INVITE_TOKEN,
  FIXTURE_OWNER_NICKNAME,
  FIXTURE_SHARE_TOKEN,
  FIXTURE_VIEWER_NICKNAME,
  imageMomentId,
  inviteId,
  mediaId,
  momentId,
  ownerId,
  shareLinkId,
  tagId,
  viewerId,
} from './fixture-rows.js';

/**
 * 纯行工厂测试（plan Task 14）：只 import fixture-rows.ts / fixture-asset.ts。
 * 不 import schema / config / db / storage 运行时模块；hashPassword 与 storageMeta 全部注入。
 */

const OWNER_PASSWORD = 'owner-pass-123';
const VIEWER_PASSWORD = 'viewer-pass-123';

const credentials = {
  owner: { email: 'owner.e2e@moment.invalid', password: OWNER_PASSWORD },
  viewer: { email: 'viewer.e2e@moment.invalid', password: VIEWER_PASSWORD },
};

const storageMeta = {
  bucket: 'moment-e2e',
  prefix: 'e2e/attachments',
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

function makeHashPassword(calls: string[]) {
  return async (plain: string): Promise<string> => {
    calls.push(plain);
    return plain === OWNER_PASSWORD ? 'hash:owner' : 'hash:viewer';
  };
}

describe('fixture constants', () => {
  test('stable ids and tokens are the exact plan values', () => {
    assert.equal(ownerId, '00000000-0000-4000-8000-000000000011');
    assert.equal(viewerId, '00000000-0000-4000-8000-000000000012');
    assert.equal(tagId, '00000000-0000-4000-8000-000000000013');
    assert.equal(chainId, '00000000-0000-4000-8000-000000000014');
    assert.equal(momentId, '00000000-0000-4000-8000-000000000015');
    assert.equal(imageMomentId, '00000000-0000-4000-8000-000000000016');
    assert.equal(mediaId, '00000000-0000-4000-8000-000000000017');
    assert.equal(shareLinkId, '00000000-0000-4000-8000-000000000018');
    assert.equal(inviteId, '00000000-0000-4000-8000-000000000019');
    assert.equal(FIXTURE_SHARE_TOKEN, 'e2e-design-system-share-token');
    assert.equal(FIXTURE_INVITE_TOKEN, 'e2e-design-system-invite-token');
    assert.equal(FIXTURE_FIXED_NOW, '2026-08-18T09:30:00.000Z');
    assert.equal(FIXTURE_EXPIRY_MS, 315360000000);
    assert.equal(FIXTURE_OWNER_NICKNAME, '林晓满');
    assert.equal(FIXTURE_VIEWER_NICKNAME, '周小禾');
  });

  test('the fixture image is the validated 64x48 PNG literal', () => {
    assert.equal(FIXTURE_IMAGE_MIME, 'image/png');
    assert.equal(FIXTURE_IMAGE_PNG.byteLength, 169);
    assert.equal(FIXTURE_IMAGE_PNG.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(
      FIXTURE_IMAGE_STORAGE_KEY,
      'chains/00000000-0000-4000-8000-000000000014/00000000-0000-4000-8000-000000000016/00000000-0000-4000-8000-000000000017.png',
    );
  });
});

describe('buildFixtureRows', () => {
  test('hashes each password exactly once and only the hashes enter users.passwordHash', async () => {
    const calls: string[] = [];
    const rows = await buildFixtureRows(credentials, {
      hashPassword: makeHashPassword(calls),
      storageMeta,
    });
    assert.deepEqual(calls, [OWNER_PASSWORD, VIEWER_PASSWORD]);
    const hashes = rows.users.map((user) => user.passwordHash);
    assert.deepEqual(hashes, ['hash:owner', 'hash:viewer']);
    const serialized = JSON.stringify(rows);
    assert.ok(!serialized.includes(OWNER_PASSWORD));
    assert.ok(!serialized.includes(VIEWER_PASSWORD));
  });

  test('returns the complete deterministic row set with exact values and FKs', async () => {
    const rows = await buildFixtureRows(credentials, {
      hashPassword: makeHashPassword([]),
      storageMeta,
    });

    const fixedNow = new Date(FIXTURE_FIXED_NOW);
    const expiry = new Date(Date.parse(FIXTURE_FIXED_NOW) + FIXTURE_EXPIRY_MS);

    assert.deepEqual(rows, {
      users: [
        {
          id: ownerId,
          email: 'owner.e2e@moment.invalid',
          passwordHash: 'hash:owner',
          nickname: '林晓满',
          passwordChangedAt: null,
          createdAt: fixedNow,
          avatarMediaId: null,
          avatarColor: null,
          avatarIcon: null,
        },
        {
          id: viewerId,
          email: 'viewer.e2e@moment.invalid',
          passwordHash: 'hash:viewer',
          nickname: '周小禾',
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
          name: '我们一起走过的很长很长的时光链名字',
          description: '一起收藏日常',
          coverMediaId: null,
          avatarMediaId: null,
          avatarFocusX: 5000,
          avatarFocusY: 5000,
          coverFocusX: 5000,
          coverFocusY: 5000,
          color: null,
          icon: null,
          visibility: 'private',
          template: 'daily',
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
          content: '2025 年最后一天：一起把这一年的温柔收好。',
          happenedAt: new Date('2025-12-31T15:30:00.000Z'),
          happenedTzOffset: -480,
          // 东八区墙钟：UTC 15:30 + 8h = 23:30 → 当日
          wallDate: '2025-12-31',
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
          content: '2026 年第一天：新年的第一束光。',
          happenedAt: new Date('2026-01-01T00:30:00.000Z'),
          happenedTzOffset: -480,
          // 东八区墙钟：UTC 00:30 + 8h = 08:30 → 当日
          wallDate: '2026-01-01',
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
          mime: 'image/png',
          size: FIXTURE_IMAGE_PNG.byteLength,
          width: 64,
          height: 48,
          duration: null,
          posterMediaId: null,
          sortOrder: 0,
          status: 'ready',
          storageMeta,
          uploadId: null,
          orphanedAt: null,
          createdAt: fixedNow,
        },
      ],
      tags: [
        {
          id: tagId,
          chainId,
          name: '跨年旅行与新年第一束光和家人的漫长回忆',
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
          email: 'viewer.e2e@moment.invalid',
          role: 'viewer',
          createdBy: ownerId,
          expiresAt: expiry,
          acceptedAt: null,
          createdAt: fixedNow,
        },
      ],
    });
  });

  test('both expiries are fixedNow + 3650 days and never derived from Date.now()', async () => {
    const first = await buildFixtureRows(credentials, {
      hashPassword: makeHashPassword([]),
      storageMeta,
    });
    const second = await buildFixtureRows(credentials, {
      hashPassword: makeHashPassword([]),
      storageMeta,
    });
    const expected = new Date(Date.parse(FIXTURE_FIXED_NOW) + FIXTURE_EXPIRY_MS);
    assert.deepEqual(first.shareLinks[0]!.expiresAt, expected);
    assert.deepEqual(first.chainInvites[0]!.expiresAt, expected);
    // 到期时间落在 2036 年（fixedNow 2026 + 10 年），跨调用完全一致。
    assert.equal(expected.getUTCFullYear(), 2036);
    assert.deepEqual(second.shareLinks[0]!.expiresAt, first.shareLinks[0]!.expiresAt);
    assert.deepEqual(second.chainInvites[0]!.expiresAt, first.chainInvites[0]!.expiresAt);
  });
});
