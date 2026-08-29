import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media } from '../db/schema.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { getStorage } from '../storage/factory.js';
import { alignedGetPresign } from './presign-ttl.js';

/** 列表/详情每次返回媒体 URL 时签发（默认 TTL 6h，整点窗内同一 key 字符串稳定）。 */
export async function signMediaGetUrl(key: string, metadata: StorageMetadata): Promise<string> {
  const { signingDate, expiresIn } = alignedGetPresign();
  return getStorage().generateAccessUrl(key, metadata, expiresIn, signingDate);
}

/** 按 media id 签发 ready 原图 GET。缺失或未 ready 的 id 不进 map。 */
export async function signReadyMediaUrls(mediaIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(mediaIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const rows = await db
    .select({ id: media.id, s3Key: media.s3Key, storageMeta: media.storageMeta, status: media.status })
    .from(media)
    .where(and(inArray(media.id, unique), eq(media.status, 'ready')));
  await Promise.all(
    rows.map(async (r) => {
      out.set(r.id, await signMediaGetUrl(r.s3Key, r.storageMeta as StorageMetadata));
    }),
  );
  return out;
}
