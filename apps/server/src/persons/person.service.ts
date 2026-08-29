import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { PersonCreateInput, PersonListResponse, PersonPatchInput, PersonResponse } from '@moment/dto';
import { BadRequestError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, momentPersons, persons, type Person } from '../db/schema.js';
import { maybeEmitMomentEmbed } from '../moments/embed-outbox.js';

/** 名归一化（spec §2）：trim + 去内部连续空白（折叠为单空格）；应用层实现，不写 DB 函数。 */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function toResponse(row: Person): PersonResponse {
  return { id: row.id, name: row.name, userId: row.userId };
}

@Service()
export class PersonService {
  /** 编辑器选择器数据源（spec §6 GET）：按 name 升序；词典行无 source/momentCount 概念。 */
  async list(chainId: string): Promise<PersonListResponse> {
    const rows = await db
      .select({ id: persons.id, name: persons.name, userId: persons.userId })
      .from(persons)
      .where(eq(persons.chainId, chainId))
      .orderBy(asc(persons.name));
    return { persons: rows };
  }

  /**
   * 幂等创建（spec §6 POST）：名归一化后撞 uk_persons_chain_name → 返回已存在行
   * （created=false → HTTP 200），不报错、不更新已存在行的 user_id（编辑器「自由文本
   * 新建」天然幂等）。并发兜底：两个请求同时穿过前置查询，后到者撞 ER_DUP_ENTRY 重查返回。
   */
  async create(chainId: string, input: PersonCreateInput): Promise<{ person: PersonResponse; created: boolean }> {
    const name = normalizePersonName(input.name);
    // userId 语义是「链接到链成员用户」（spec §2）——非成员 id 直接拒（见计划偏差 4）
    if (input.userId !== undefined) {
      const [member] = await db
        .select({ userId: chainMembers.userId })
        .from(chainMembers)
        .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, input.userId)))
        .limit(1);
      if (!member) throw new BadRequestError('PERSON_USER_NOT_IN_CHAIN');
    }

    const [existing] = await db
      .select()
      .from(persons)
      .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
      .limit(1);
    if (existing) return { person: toResponse(existing), created: false };

    const row: Person = { id: randomUUID(), chainId, name, userId: input.userId ?? null, createdAt: new Date() };
    try {
      await db.insert(persons).values(row);
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        const [race] = await db
          .select()
          .from(persons)
          .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
          .limit(1);
        if (race) return { person: toResponse(race), created: false };
      }
      throw err;
    }
    return { person: toResponse(row), created: true };
  }

  /** 改名（spec §6 PATCH）：撞名归一化 → 409 PERSON_NAME_CONFLICT；归一化后同名幂等返回。 */
  async rename(chainId: string, personId: string, input: PersonPatchInput): Promise<PersonResponse> {
    const name = normalizePersonName(input.name);
    const [person] = await db
      .select()
      .from(persons)
      .where(and(eq(persons.id, personId), eq(persons.chainId, chainId)))
      .limit(1);
    if (!person) throw new NotFoundError('PERSON_NOT_FOUND');
    if (person.name === name) return toResponse(person);

    const [dup] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
      .limit(1);
    if (dup && dup.id !== personId) throw new HttpError(409, 'PERSON_NAME_CONFLICT');

    await db.transaction(async (tx) => {
      try {
        await tx.update(persons).set({ name }).where(eq(persons.id, personId));
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'PERSON_NAME_CONFLICT');
        throw err;
      }
      const links = await tx
        .select({ momentId: momentPersons.momentId })
        .from(momentPersons)
        .where(eq(momentPersons.personId, personId));
      for (const row of links) {
        await maybeEmitMomentEmbed(tx, row.momentId);
      }
    });
    return { id: person.id, name, userId: person.userId };
  }

  /** 删除（spec §6 DELETE）：先删全部 moment_persons 关联再删词典行（元数据级联，不触时刻本体），一个事务。 */
  async remove(chainId: string, personId: string): Promise<void> {
    const [person] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.id, personId), eq(persons.chainId, chainId)))
      .limit(1);
    if (!person) throw new NotFoundError('PERSON_NOT_FOUND');

    await db.transaction(async (tx) => {
      const links = await tx
        .select({ momentId: momentPersons.momentId })
        .from(momentPersons)
        .where(eq(momentPersons.personId, personId));
      await tx.delete(momentPersons).where(eq(momentPersons.personId, personId));
      await tx.delete(persons).where(eq(persons.id, personId));
      for (const row of links) {
        await maybeEmitMomentEmbed(tx, row.momentId);
      }
    });
  }
}
