import { OFFICIAL_TEMPLATES } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { templates } from '../../src/db/schema.js';
import { seedOfficialTemplates } from '../../src/templates/official-templates.seed.js';
import { closeDb, resetDb } from '../helpers/db.js';

afterAll(closeDb);

describe('official templates seed', () => {
  it('migrate 后五份 official 模板已入库，内容与 dto 常量一致', async () => {
    const rows = await db.select().from(templates).where(eq(templates.scope, 'official'));
    expect(rows).toHaveLength(5);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const t of OFFICIAL_TEMPLATES) {
      const row = byKey[t.key];
      expect(row).toBeDefined();
      expect(row.name).toBe(t.name);
      expect(row.description).toBe(t.description);
      expect(row.icon).toBe(t.icon);
      expect(row.manifest).toEqual(t.manifest);
      expect(row.status).toBe('active');
      expect(row.ownerId).toBeNull();
    }
  });

  it('幂等：重复 seed 不产生重复行；resetDb 清表后自动重 seed', async () => {
    await seedOfficialTemplates();
    await seedOfficialTemplates();
    const rows = await db.select().from(templates).where(eq(templates.scope, 'official'));
    expect(rows).toHaveLength(5);

    await resetDb();
    const after = await db.select().from(templates).where(eq(templates.scope, 'official'));
    expect(after).toHaveLength(5);
  });
});
