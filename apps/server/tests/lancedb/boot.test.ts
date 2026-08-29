import { jest } from '@jest/globals';
import type { Express } from 'express';
import { startServer } from '../../src/boot.js';
import { closeDb } from '../helpers/db.js';

const app = { name: 'fake-app' } as unknown as Express;

afterAll(closeDb);

describe('startServer（spec §1 ensure 时机）', () => {
  it('顺序 createApp → ensureLance → listen', async () => {
    const order: string[] = [];
    const listen = jest.fn();
    const exit = jest.fn();
    await startServer({
      createApp: () => {
        order.push('create');
        return app;
      },
      ensureLance: async () => {
        order.push('ensure');
      },
      listen: (a) => {
        order.push('listen');
        listen(a);
      },
      exit,
      nodeEnv: 'production',
    });
    expect(order).toEqual(['create', 'ensure', 'listen']);
    expect(listen).toHaveBeenCalledWith(app);
    expect(exit).not.toHaveBeenCalled();
  });

  it('production ensure 失败 → exit(1) 且不 listen', async () => {
    const listen = jest.fn();
    const exit = jest.fn();
    const log = { error: jest.fn(), info: jest.fn() };
    await startServer({
      createApp: () => app,
      ensureLance: async () => {
        throw new Error('disk full');
      },
      listen,
      exit,
      nodeEnv: 'production',
      logger: log,
    });
    expect(log.error).toHaveBeenCalledWith('lancedb ensure failed', expect.any(Error));
    expect(exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
  });

  it('development ensure 失败 → throw、不 listen、不 exit', async () => {
    const listen = jest.fn();
    const exit = jest.fn();
    const log = { error: jest.fn(), info: jest.fn() };
    await expect(
      startServer({
        createApp: () => app,
        ensureLance: async () => {
          throw new Error('disk full');
        },
        listen,
        exit,
        nodeEnv: 'development',
        logger: log,
      }),
    ).rejects.toThrow(/disk full/);
    expect(log.error).toHaveBeenCalledWith('lancedb ensure failed', expect.any(Error));
    expect(exit).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});
