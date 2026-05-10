import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password', () => {
  it('hash 后可校验通过', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
  });

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('同一密码两次 hash 不同（内嵌随机盐）', async () => {
    const [h1, h2] = await Promise.all([hashPassword('secret123'), hashPassword('secret123')]);
    expect(h1).not.toBe(h2);
  });
});
