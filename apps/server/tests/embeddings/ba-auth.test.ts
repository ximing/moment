import { UnauthorizedError } from 'routing-controllers';
import { jest } from '@jest/globals';
import {
  assertBaAuth,
  baAuth,
  getBaAuthToken,
  setBaAuthTokenForTests,
} from '../../src/embeddings/ba-auth.js';

afterEach(() => setBaAuthTokenForTests(undefined));

function thrown(fn: () => void): UnauthorizedError {
  try {
    fn();
    throw new Error('expected throw');
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedError);
    return err as UnauthorizedError;
  }
}

describe('assertBaAuth（spec §6.3）', () => {
  it('空配置：有/无 Authorization 都是 BA_NOT_CONFIGURED（不探测）', () => {
    expect(thrown(() => assertBaAuth('', undefined)).message).toBe('BA_NOT_CONFIGURED');
    expect(thrown(() => assertBaAuth('', 'Bearer secret')).message).toBe('BA_NOT_CONFIGURED');
    expect(thrown(() => assertBaAuth('', 'Bearer ')).message).toBe('BA_NOT_CONFIGURED');
  });

  it('已配置：缺头 / 非 Bearer / 错 token → BA_AUTH_INVALID；精确匹配通过', () => {
    const tok = 'ba-secret-token';
    expect(thrown(() => assertBaAuth(tok, undefined)).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Basic abc')).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Bearer')).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Bearer wrong')).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Bearer ba-secret-tokex')).message).toBe('BA_AUTH_INVALID'); // 等长错误
    expect(() => assertBaAuth(tok, 'Bearer ba-secret-token')).not.toThrow();
  });

  it('Authorization 数组取首元素', () => {
    expect(() => assertBaAuth('t', ['Bearer t', 'Bearer other'])).not.toThrow();
  });
});

describe('setBaAuthTokenForTests', () => {
  it('override 空串 / 非空；undefined 回落 config', () => {
    const original = getBaAuthToken();
    setBaAuthTokenForTests('');
    expect(getBaAuthToken()).toBe('');
    setBaAuthTokenForTests('injected');
    expect(getBaAuthToken()).toBe('injected');
    setBaAuthTokenForTests(undefined);
    expect(getBaAuthToken()).toBe(original);
  });
});

describe('baAuth 中间件', () => {
  it('失败 next(err)；成功 next()', () => {
    setBaAuthTokenForTests('');
    const next1 = jest.fn();
    baAuth({ headers: {} } as never, {} as never, next1);
    expect(next1.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect((next1.mock.calls[0][0] as UnauthorizedError).message).toBe('BA_NOT_CONFIGURED');

    setBaAuthTokenForTests('tok');
    const next2 = jest.fn();
    baAuth({ headers: { authorization: 'Bearer tok' } } as never, {} as never, next2);
    expect(next2).toHaveBeenCalledWith();
  });
});
