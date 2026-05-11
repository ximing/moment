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
});
