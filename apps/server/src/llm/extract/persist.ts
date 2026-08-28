import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { momentPersons, moments, persons } from '../../db/schema.js';
import type { DbTx } from '../../outbox/outbox.js';
import { normalizePersonName } from '../../persons/person.service.js';
import type { ExtractResult } from './extract.js';

/** AI 抽取人物数上限：对齐 dto momentPersonIdsSchema max(20)——LLM 输出防御（偏差 9）。 */
const MAX_AI_PERSONS = 20;
/** 词典名列宽 persons.name varchar(50)（P1）；归一化后超长名丢弃（截断会产生半截人名，偏差 9）。 */
const PERSON_NAME_MAX_CHARS = 50;
/** 地名截断上限：对齐 moments.place_name varchar(255)（P3 PLACE_NAME_MAX_CHARS 同款范式）。 */
const PLACE_NAME_MAX_CHARS = 255;

/**
 * 链词典 upsert（spec §5）：名归一化后按 (chainId, name) 查，已存在复用 id，不存在插入新行。
 * 并发兜底对齐 PersonService.create：撞 uk_persons_chain_name 的 ER_DUP_ENTRY 重查返回。
 */
async function upsertPersonByName(tx: DbTx, chainId: string, name: string): Promise<string> {
  const [existing] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const id = randomUUID();
  try {
    await tx.insert(persons).values({ id, chainId, name });
    return id;
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      const [race] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
        .limit(1);
      if (race) return race.id;
    }
    throw err;
  }
}

/**
 * 抽取结果落库（spec §5 抽取内容与落库规则）。调用方必须在同一事务内先行完成
 * 软删 / 素材快照 / hash 幂等三项守卫（见 handlers.ts 的 handleMomentExtract）。
 *
 * - persons：normalizePersonName 归一化 → 去重（≤20、名长 ≤50）→ 链词典 upsert（已存在复用 id）
 *   → moment_persons **仅补缺**：已存在的关联行一律不动（manual 不降级；用户删除的 ai 行在
 *   「内容未变不重抽」下不会走到这里，内容变化重抽时复活为 ai 行是 spec 接受的语义，见偏差 4）。
 * - place：仅当四列全空（三值列 + source 同生同灭，spec §2）时填 place_name = places[0]
 *   （截断 255）、place_source='ai'（无坐标）；exif/manual/ai 已有 place 一律不覆盖
 *   （spec §5 冲突规则 manual > exif > ai）。条件 UPDATE 自带竞态防御（IO 后再校验）。
 * - 最后写 ai_extract_hash = extractHash（幂等判据收口，与落库同事务原子）。
 */
export async function persistExtraction(
  tx: DbTx,
  moment: { id: string; chainId: string },
  extraction: ExtractResult,
  extractHash: string,
): Promise<void> {
  const names = [
    ...new Set(
      extraction.persons
        .map((raw) => normalizePersonName(raw))
        .filter((name) => name.length > 0 && name.length <= PERSON_NAME_MAX_CHARS),
    ),
  ].slice(0, MAX_AI_PERSONS);

  if (names.length > 0) {
    const personIds = new Set<string>();
    for (const name of names) {
      personIds.add(await upsertPersonByName(tx, moment.chainId, name));
    }
    const existingRows = await tx
      .select({ personId: momentPersons.personId })
      .from(momentPersons)
      .where(eq(momentPersons.momentId, moment.id));
    const existing = new Set(existingRows.map((r) => r.personId));
    const missing = [...personIds].filter((id) => !existing.has(id));
    if (missing.length > 0) {
      await tx
        .insert(momentPersons)
        .values(missing.map((personId) => ({ momentId: moment.id, personId, source: 'ai' as const })));
    }
  }

  if (extraction.places.length > 0) {
    const placeName = extraction.places[0].slice(0, PLACE_NAME_MAX_CHARS);
    await tx
      .update(moments)
      .set({ placeName, placeSource: 'ai' })
      .where(
        and(
          eq(moments.id, moment.id),
          isNull(moments.placeLat),
          isNull(moments.placeLng),
          isNull(moments.placeName),
          isNull(moments.placeSource),
        ),
      );
  }

  await tx.update(moments).set({ aiExtractHash: extractHash }).where(eq(moments.id, moment.id));
}
