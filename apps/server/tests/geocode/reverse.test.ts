import { jest } from '@jest/globals';
import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, registerUser } from '../helpers/fixtures.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';

afterEach(() => setGeocodeProvider(undefined));
afterAll(closeDb);

describe('POST /api/geocode/reverse', () => {
  beforeEach(resetDb);

  it('未登录 → 401', async () => {
    const res = await request(app).post('/api/geocode/reverse').send({ lat: 39.9, lng: 116.4 });
    expect(res.status).toBe(401);
  });

  it('provider 返回地名 → {name}', async () => {
    const owner = await registerUser();
    setGeocodeProvider({
      reverse: jest.fn(async () => '北京大学人民医院'),
    } as unknown as GeocodeProvider);
    const res = await request(app)
      .post('/api/geocode/reverse')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ lat: 39.9042, lng: 116.4074 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: '北京大学人民医院' });
  });

  it('provider 抛错 / null → {name:null} 不 5xx', async () => {
    const owner = await registerUser();
    setGeocodeProvider({
      reverse: jest.fn(async () => {
        throw new Error('amap down');
      }),
    } as unknown as GeocodeProvider);
    const res = await request(app)
      .post('/api/geocode/reverse')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ lat: 39.9042, lng: 116.4074 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: null });
  });

  it('越界坐标 → 400', async () => {
    const owner = await registerUser();
    const res = await request(app)
      .post('/api/geocode/reverse')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ lat: 91, lng: 0 });
    expect(res.status).toBe(400);
  });
});
