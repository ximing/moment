import { OFFICIAL_TEMPLATES } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { templates } from '../db/schema.js';

/**
 * official 模板 seed：以 dto 的 OFFICIAL_TEMPLATES 为唯一数据源（SQL 迁移无法 import TS 常量）。
 * 幂等 upsert：重复执行不产生重复行；manifest 随代码发布会同步更新 DB 行
 * （official 模板的「增量编辑」由 dto 侧人工保证，同 spec §3.4 规则）。
 * 调用方：migrate.ts（迁移后）、tests/helpers/db.ts 的 resetDb()（清表后重 seed）。
 */
export async function seedOfficialTemplates(): Promise<void> {
  for (const t of OFFICIAL_TEMPLATES) {
    await db
      .insert(templates)
      .values({
        id: randomUUID(),
        key: t.key,
        scope: 'official',
        ownerId: null,
        name: t.name,
        description: t.description,
        icon: t.icon,
        manifest: t.manifest,
        version: 1,
        status: 'active',
      })
      .onDuplicateKeyUpdate({
        set: { name: t.name, description: t.description, icon: t.icon, manifest: t.manifest },
      });
  }
}
