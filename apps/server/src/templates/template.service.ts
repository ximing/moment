import {
  type CreateTemplateInput,
  type TemplateDto,
  type TemplateScope,
  type UpdateTemplateInput,
} from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { templates, type Template } from '../db/schema.js';
import { assertAdditiveEdit, validateManifest } from './manifest-validator.js';

function toDto(row: Template): TemplateDto {
  return {
    id: row.id,
    key: row.key,
    scope: row.scope,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    manifest: row.manifest,
    version: row.version,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Service()
export class TemplateService {
  /** 列表：official 全部 + 我的 user 模板；仅 active（archived 不再可选，spec §3.4）。 */
  async list(userId: string, scope?: TemplateScope): Promise<TemplateDto[]> {
    const scopeCond: SQL =
      scope === 'official'
        ? eq(templates.scope, 'official')
        : scope === 'user'
          ? and(eq(templates.scope, 'user'), eq(templates.ownerId, userId))!
          : or(eq(templates.scope, 'official'), and(eq(templates.scope, 'user'), eq(templates.ownerId, userId))!)!;
    const rows = await db
      .select()
      .from(templates)
      .where(and(eq(templates.status, 'active'), scopeCond))
      .orderBy(asc(templates.key));
    return rows.map(toDto);
  }

  /**
   * 详情：任意状态可读（archived 的存量链仍要渲染 manifest）。
   * 对他人的 user 模板同样可读：manifest 是纯结构定义、不含用户数据；
   * 可见性控制由 list 承担（只列 official + 我的），详情接口不额外设防（编排者裁决 S2）。
   */
  async getByKey(key: string): Promise<TemplateDto> {
    return toDto(await this.getRowByKey(key));
  }

  /** active 模板行：P3 的链创建/payload 校验/聚合端点用；archived 视同不存在（阻止新建链选用）。 */
  async getActiveByKey(key: string): Promise<Template> {
    const row = await this.getRowByKey(key);
    if (row.status !== 'active') throw new NotFoundError('TEMPLATE_NOT_FOUND');
    return row;
  }

  async create(userId: string, input: CreateTemplateInput): Promise<TemplateDto> {
    const manifest = validateManifest(input.manifest);
    const id = randomUUID();
    // u_ + 21 位十六进制随机（server 无 nanoid 依赖，randomUUID 去横线截取；`u/` 含路由非法字符，spec §2.1 已定为 u_）
    const key = `u_${randomUUID().replaceAll('-', '').slice(0, 21)}`;
    await db.insert(templates).values({
      id,
      key,
      scope: 'user',
      ownerId: userId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon,
      manifest: { ...manifest, version: 1 },
      version: 1,
      status: 'active',
    });
    return this.getByKey(key);
  }

  async update(userId: string, key: string, input: UpdateTemplateInput): Promise<TemplateDto> {
    const row = await this.getOwnedRow(userId, key);
    let version = row.version;
    let manifest = row.manifest;
    if (input.manifest !== undefined) {
      const next = validateManifest(input.manifest);
      assertAdditiveEdit(row.manifest, next);
      version = row.version + 1;
      // manifest.version 由 server 归一为行版本（客户端填的值不采信）
      manifest = { ...next, version };
    }
    await db
      .update(templates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        manifest,
        version,
      })
      .where(eq(templates.id, row.id));
    return this.getByKey(key);
  }

  /** archive：不物理删除；存量链照常（详情仍可读），仅阻止新建链选用（spec §3.4）。 */
  async archive(userId: string, key: string): Promise<void> {
    const row = await this.getOwnedRow(userId, key);
    if (row.status === 'archived') return; // 幂等
    // 已知行为空隙（编排者裁决 S3，可接受）：archived 模板仍允许 PATCH 编辑 manifest——
    // 归档语义只约束「新建链不可选用」（getActiveByKey 拦截），不冻结定义本身。
    await db.update(templates).set({ status: 'archived' }).where(eq(templates.id, row.id));
  }

  private async getRowByKey(key: string): Promise<Template> {
    const [row] = await db.select().from(templates).where(eq(templates.key, key)).limit(1);
    if (!row) throw new NotFoundError('TEMPLATE_NOT_FOUND');
    return row;
  }

  private async getOwnedRow(userId: string, key: string): Promise<Template> {
    const row = await this.getRowByKey(key);
    if (row.scope === 'official' || row.ownerId !== userId) throw new ForbiddenError('TEMPLATE_FORBIDDEN');
    return row;
  }
}
