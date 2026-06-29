import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

const alice = { email: 'Alice@Example.com', password: 'secret123', nickname: 'Alice' };

beforeEach(resetDb);
afterAll(closeDb);

describe('auth 全流程', () => {
  it('register → me → refresh → logout', async () => {
    // 注册：email 归一化为小写
    const reg = await request(app).post('/api/auth/register').send(alice);
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('alice@example.com');
    expect(reg.body.user.nickname).toBe('Alice');
    expect(reg.body.tokens.accessToken).toBeTruthy();
    expect(reg.body.tokens.refreshToken).toBeTruthy();
    expect(reg.body.tokens.expiresIn).toBe(900);
    // 响应不泄露敏感字段
    expect(reg.body.user.passwordHash).toBeUndefined();

    // me：带 access token
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('alice@example.com');
    expect(me.body.avatarColor).toBeNull();
    expect(me.body.avatarIcon).toBeNull();

    const patched = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.tokens.accessToken}`)
      .send({ avatarColor: 'mint', avatarIcon: '⭐' });
    expect(patched.status).toBe(200);
    expect(patched.body.avatarColor).toBe('mint');
    expect(patched.body.avatarIcon).toBe('⭐');

    // refresh：换新对，旧 refresh 不可复用
    const ref = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.body.tokens.refreshToken });
    expect(ref.status).toBe(200);
    expect(ref.body.tokens.refreshToken).not.toBe(reg.body.tokens.refreshToken);

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.body.tokens.refreshToken });
    expect(reuse.status).toBe(401);

    // logout：吊销新 refresh
    const out = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: ref.body.tokens.refreshToken });
    expect(out.status).toBe(204);
    const afterLogout = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: ref.body.tokens.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  it('重复注册同 email（大小写不同）返回 409', async () => {
    await request(app).post('/api/auth/register').send(alice);
    const dup = await request(app)
      .post('/api/auth/register')
      .send({ ...alice, email: 'ALICE@example.com' });
    expect(dup.status).toBe(409);
  });

  it('login：密码错误 401；成功后可用 token 访问 me', async () => {
    await request(app).post('/api/auth/register').send(alice);

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'wrong-pass' });
    expect(bad.status).toBe(401);

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: alice.password });
    expect(ok.status).toBe(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ok.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('校验失败 400 统一错误结构；无 token 访问 me 返回 401', async () => {
    const invalid = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad', password: 'short', nickname: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('change-password：旧密码错误 400 INVALID_OLD_PASSWORD；成功后全端下线', async () => {
    const reg = await request(app).post('/api/auth/register').send(alice);
    const { accessToken, refreshToken } = reg.body.tokens as { accessToken: string; refreshToken: string };

    // 无 token 401
    const noAuth = await request(app)
      .post('/api/auth/change-password')
      .send({ oldPassword: alice.password, newPassword: 'new-secret-123' });
    expect(noAuth.status).toBe(401);

    // 旧密码错误 400（不是 401：避免客户端 refresh+重放误清登录态）
    const wrongOld = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'wrong-old', newPassword: 'new-secret-123' });
    expect(wrongOld.status).toBe(400);
    expect(wrongOld.body.error.code).toBe('INVALID_OLD_PASSWORD');

    // 新密码规则同 register：过短 400 VALIDATION_ERROR
    const weakNew = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: alice.password, newPassword: 'short' });
    expect(weakNew.status).toBe(400);
    expect(weakNew.body.error.code).toBe('VALIDATION_ERROR');

    // 等待 1s+：passwordChangedAt（秒精度）必须严格晚于 access token 的 iat，旧 token 才失效
    await new Promise((r) => setTimeout(r, 1100));
    const ok = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: alice.password, newPassword: 'new-secret-123' });
    expect(ok.status).toBe(204);

    // 旧 access token 失效（passwordChangedAt > iat）
    const meAfter = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meAfter.status).toBe(401);

    // 全部 refresh token 吊销（含当前会话）
    const refAfter = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refAfter.status).toBe(401);

    // 旧密码不可登录，新密码可登录
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: alice.email, password: alice.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'new-secret-123' });
    expect(newLogin.status).toBe(200);
  });
});
