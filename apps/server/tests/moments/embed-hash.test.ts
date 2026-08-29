import { createHash } from 'node:crypto';
import {
  assembleEmbedText,
  computeEmbedHash,
  derivedFingerprintOf,
} from '../../src/moments/embed-hash.js';

const base = {
  content: '正文',
  transcript: '转写',
  personNames: ['外婆', '朵朵'],
  placeName: '朝阳公园',
  derivedFingerprint: 'm1:ready:chains/c/m/m1.derived.webp',
  model: 'qwen3-vl-embedding',
  dim: 2560,
};

describe('computeEmbedHash（spec fused-retrieval §2.2）', () => {
  it('与手工 sha256 逐字一致；64 hex；不含 outputType', () => {
    const names = ['外婆', '朵朵'].sort().join('\n');
    const manual = createHash('sha256')
      .update(`正文\0转写\0${names}\0朝阳公园\0${base.derivedFingerprint}\0qwen3-vl-embedding:2560`)
      .digest('hex');
    expect(computeEmbedHash(base)).toBe(manual);
    expect(manual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('personNames 在函数内排序（调用方顺序不影响）', () => {
    expect(computeEmbedHash({ ...base, personNames: ['朵朵', '外婆'] })).toBe(computeEmbedHash(base));
  });

  it('transcript null 与空串同 hash；content/人名/地名/fingerprint/model/dim 变化则变', () => {
    expect(computeEmbedHash({ ...base, transcript: null })).toBe(computeEmbedHash({ ...base, transcript: '' }));
    expect(computeEmbedHash({ ...base, content: '改' })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, personNames: ['外婆'] })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, placeName: null })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, derivedFingerprint: 'x' })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, dim: 1024 })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, model: 'other' })).not.toBe(computeEmbedHash(base));
  });
});

describe('derivedFingerprintOf（含 poster 行；GIF 排除；pending/failed 改 hash）', () => {
  const jpeg = (id: string, sortOrder: number, status: string | null, key: string | null) => ({
    id,
    mime: 'image/jpeg',
    sortOrder,
    derivedStatus: status,
    derivedS3Key: key,
  });

  it('按 sortOrder,id；不可压 mime 丢弃', () => {
    const a = jpeg('a-uuid', 1, 'ready', 'ka');
    const b = jpeg('b-uuid', 0, 'pending', null);
    const gif = { id: 'g', mime: 'image/gif', sortOrder: 0, derivedStatus: null, derivedS3Key: null };
    const video = { id: 'v', mime: 'video/mp4', sortOrder: 0, derivedStatus: null, derivedS3Key: null };
    expect(derivedFingerprintOf([a, gif, video, b])).toBe('b-uuid:pending:-\na-uuid:ready:ka');
  });

  it('同 sortOrder 按 id；status null → 字面 null', () => {
    expect(derivedFingerprintOf([jpeg('b', 0, null, null), jpeg('a', 0, 'failed', null)])).toBe(
      'a:failed:-\nb:null:-',
    );
  });
});

describe('assembleEmbedText', () => {
  it('换行拼接后 trim；全空 → 空串', () => {
    expect(assembleEmbedText('正文', '转写', ['朵朵', '外婆'], '公园')).toBe('正文\n转写\n朵朵\n外婆\n公园');
    expect(assembleEmbedText('', null, [], null)).toBe('');
    expect(assembleEmbedText('  hi  ', null, [], null)).toBe('hi');
  });
});
