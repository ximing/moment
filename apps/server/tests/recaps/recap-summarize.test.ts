import { createApp } from '../../src/app.js';
import { buildRecapInput } from '../../src/llm/recap/input.js';
import { seedOfficialTemplates } from '../../src/templates/official-templates.seed.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;

beforeEach(async () => {
  await resetDb(); // resetDb 只清 user scope 模板，官方模板保留；幂等 seed 兜底确保 career 行就位
  await seedOfficialTemplates();
  owner = await createUser(app, 'owner');
});
afterAll(closeDb);

describe('recap summarizePayload 泛化（spec 2026-09-03 §5）', () => {
  it('career-event 出【职业事件】前缀 + 目录 label', async () => {
    const chain = await createChain(app, owner, '职业', 'career');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'career-event',
      payload: { catalog_key: 'promotion' },
    });
    const input = await buildRecapInput(chain.id, '2026-08');
    expect(input.moments).toHaveLength(1);
    expect(input.moments[0].line).toContain('【职业事件】晋升');
  });

  it('reflection 出【思考】+ topic', async () => {
    const chain = await createChain(app, owner, '职业', 'career');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'reflection',
      payload: { topic: '要不要接这个机会' },
    });
    const input = await buildRecapInput(chain.id, '2026-08');
    expect(input.moments[0].line).toContain('【思考】要不要接这个机会');
  });

  it('milestone 前缀保持【里程碑】回归', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'milestone',
      payload: { catalog_key: 'first-steps' },
    });
    const input = await buildRecapInput(chain.id, '2026-08');
    expect(input.moments[0].line).toContain('【里程碑】第一次走路');
  });

  it('metric/standard 分支不变', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'metric',
      payload: { metric: 'height', value: 52, unit: 'cm' },
    });
    const daily = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: daily.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      payload: { mood: '😄' },
    });
    const babyInput = await buildRecapInput(chain.id, '2026-08');
    expect(babyInput.moments[0].line).toContain('【记录】height 52cm');
    const dailyInput = await buildRecapInput(daily.id, '2026-08');
    expect(dailyInput.moments[0].line).toContain('【心情】😄');
  });
});
