import { S3UnifiedStorageAdapter } from '../../src/storage/s3.adapter.js';
import { alignedGetPresign } from '../../src/media/presign-ttl.js';

describe('alignedGetPresign（签名时刻 + TTL 双整点对齐，spec §5.3）', () => {
  it('signingDate 对齐到当前小时窗起点，expiresIn = TTL + 3600（常量）', () => {
    const { signingDate, expiresIn } = alignedGetPresign(7_200_000 + 123_456, 3600);
    expect(signingDate.getTime()).toBe(7_200_000);
    expect(expiresIn).toBe(3600 + 3600);
  });

  it('窗内任意时刻距过期 ≥ TTL（边界：整点自身与下一整点前 1 秒）', () => {
    for (const nowMs of [3_600_000, 3_600_000 + 1, 7_200_000 - 1000]) {
      const { signingDate, expiresIn } = alignedGetPresign(nowMs, 3600);
      expect(signingDate.getTime() + expiresIn * 1000 - nowMs).toBeGreaterThanOrEqual(3600 * 1000);
    }
  });

  it('TTL=6h 时窗内任意时刻剩余 ≥ 6h，expiresIn = 21600 + 3600', () => {
    const ttl = 6 * 3600;
    for (const nowMs of [3_600_000, 3_600_000 + 1, 7_200_000 - 1000]) {
      const { signingDate, expiresIn } = alignedGetPresign(nowMs, ttl);
      expect(signingDate.getTime() + expiresIn * 1000 - nowMs).toBeGreaterThanOrEqual(ttl * 1000);
    }
    expect(alignedGetPresign(0, ttl).expiresIn).toBe(ttl + 3600);
  });

  it('跨窗后 signingDate 切换（URL 只随整点变化）', () => {
    expect(alignedGetPresign(7_200_000 - 1, 3600).signingDate.getTime()).toBe(3_600_000);
    expect(alignedGetPresign(7_200_000, 3600).signingDate.getTime()).toBe(7_200_000);
  });

  it('真 S3 adapter（mocked credentials，不起网，仅本地计算签名串）：同窗两次签出的 URL 字符串完全一致', async () => {
    const adapter = new S3UnifiedStorageAdapter({
      bucket: 'moment-test',
      prefix: 'test/attachments',
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    });
    const meta = {
      bucket: 'moment-test',
      prefix: 'test/attachments',
      region: 'us-east-1',
      isPublicBucket: 'false' as const,
    };
    // 同窗不同时刻（若 expiresIn 或签名时刻随 now 变化，两串必然不等——这正是本断言防的回归）
    const a = alignedGetPresign(7_200_000 + 123_000, 3600);
    const b = alignedGetPresign(7_200_000 + 125_000, 3600);
    const u1 = await adapter.generateAccessUrl('chains/c/m/x.jpeg', meta, a.expiresIn, a.signingDate);
    const u2 = await adapter.generateAccessUrl('chains/c/m/x.jpeg', meta, b.expiresIn, b.signingDate);
    expect(u1).toBe(u2);
    // 跨窗则必然不同（signingDate 变化）
    const c = alignedGetPresign(10_800_000 + 123_000, 3600);
    const u3 = await adapter.generateAccessUrl('chains/c/m/x.jpeg', meta, c.expiresIn, c.signingDate);
    expect(u3).not.toBe(u1);
  });
});
