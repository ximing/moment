import { ApiError } from '@moment/api-client';
import { describe, expect, it } from 'vitest';
import { humanError } from './errors';

describe('humanError 校验细节', () => {
  it('旧服务端不认识 chainId 时说明换链还没生效', () => {
    const err = new ApiError('请求参数不合法', 400, 'VALIDATION_ERROR', [
      {
        code: 'unrecognized_keys',
        keys: ['chainId'],
        path: [],
        message: "Unrecognized key(s) in object: 'chainId'",
      },
    ]);
    expect(humanError(err)).toBe('换链这一步线上服务还没更新，时刻先留在原来的链上');
  });

  it('按字段指出要改的内容', () => {
    const err = new ApiError('请求参数不合法', 400, 'VALIDATION_ERROR', [
      { code: 'invalid_string', path: ['personIds', 0], message: 'Invalid uuid' },
      { code: 'invalid_string', path: ['tagIds', 0], message: 'Invalid uuid' },
    ]);
    expect(humanError(err)).toBe('人物需要重新选；标签需要重新选');
  });

  it('没有细节时仍用笼统文案', () => {
    expect(humanError(new ApiError('请求参数不合法', 400, 'VALIDATION_ERROR'))).toBe('有些内容需要改一改');
  });
});
