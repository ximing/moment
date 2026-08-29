import { LANCE_UUID_RE, lanceEqUuid, lanceInUuids } from '../../src/lancedb/ids.js';

const A = '123e4567-e89b-12d3-a456-426614174000';
const B = '123e4567-e89b-12d3-a456-426614174001';

describe('lanceInUuids（spec §2.5 防拼接）', () => {
  it('只保留 uuid；空则 null', () => {
    expect(LANCE_UUID_RE.test(A)).toBe(true);
    expect(lanceInUuids('chainId', [A, B])).toBe(`chainId IN ('${A}', '${B}')`);
    expect(lanceInUuids('momentId', [`${A}' OR 1=1`, 'not-a-uuid'])).toBeNull();
    expect(lanceInUuids('chainId', [])).toBeNull();
    expect(lanceEqUuid('chainId', A)).toBe(`chainId = '${A}'`);
  });
});
