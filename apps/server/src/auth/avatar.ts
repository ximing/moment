import { inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, users } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';

export function avatarExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + config.AVATAR_PRESIGN_TTL_SECONDS * 1000);
}

export async function signAvatarGetUrl(s3Key: string, storageMeta: StorageMetadata): Promise<string> {
  return getStorage().generateAccessUrl(s3Key, storageMeta, config.AVATAR_PRESIGN_TTL_SECONDS);
}

/** 批量签发头像 URL（无头像 / 媒体未就绪 → null）。 */
export async function avatarUrlsByUserIds(userIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, string | null>(unique.map((id) => [id, null]));
  if (unique.length === 0) return out;

  const userRows = await db
    .select({ id: users.id, avatarMediaId: users.avatarMediaId })
    .from(users)
    .where(inArray(users.id, unique));
  const mediaIds = userRows.map((u) => u.avatarMediaId).filter((id): id is string => Boolean(id));
  if (mediaIds.length === 0) return out;

  const mediaRows = await db.select().from(media).where(inArray(media.id, mediaIds));
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

  await Promise.all(
    userRows.map(async (u) => {
      if (!u.avatarMediaId) return;
      const row = mediaById.get(u.avatarMediaId);
      if (!row || row.status !== 'ready') return;
      out.set(u.id, await signAvatarGetUrl(row.s3Key, row.storageMeta));
    })
  );
  return out;
}
