import * as lancedb from '@lancedb/lancedb';
import type { Table } from '@lancedb/lancedb';
import { config } from '../config.js';
import { MOMENT_VECTORS_TABLE, momentVectorsSchema } from './schema.js';

let db: Awaited<ReturnType<typeof lancedb.connect>> | null = null;
let table: Table | null = null;

async function createMomentVectorsTable(
  conn: NonNullable<typeof db>,
): Promise<Table> {
  const schema = momentVectorsSchema();
  const anyConn = conn as unknown as {
    createEmptyTable?: (name: string, schema: unknown) => Promise<Table>;
    createTable: (name: string, data: unknown[], opts?: { schema: unknown }) => Promise<Table>;
  };
  if (typeof anyConn.createEmptyTable === 'function') {
    return anyConn.createEmptyTable(MOMENT_VECTORS_TABLE, schema);
  }
  return anyConn.createTable(MOMENT_VECTORS_TABLE, [], { schema });
}

function tableNameList(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return names.map((n) => (typeof n === 'string' ? n : String((n as { name?: string })?.name ?? n)));
}

export async function ensureLance(): Promise<void> {
  if (db && table) return;
  db = await lancedb.connect(config.LANCEDB_PATH);
  const names = tableNameList(await db.tableNames());
  table = names.includes(MOMENT_VECTORS_TABLE)
    ? await db.openTable(MOMENT_VECTORS_TABLE)
    : await createMomentVectorsTable(db);
}

export function getLanceTable(): Table {
  if (!table) {
    const err = new Error('LANCE_NOT_READY');
    throw err;
  }
  return table;
}

export function isLanceReady(): boolean {
  return table !== null;
}

export async function resetLanceForTests(): Promise<void> {
  await ensureLance();
  if (!db) throw new Error('LANCE_NOT_READY');
  const names = tableNameList(await db.tableNames());
  if (names.includes(MOMENT_VECTORS_TABLE)) {
    await db.dropTable(MOMENT_VECTORS_TABLE);
  }
  table = await createMomentVectorsTable(db);
}

export async function closeLanceForTests(): Promise<void> {
  try {
    db?.close();
  } catch {
    /* native 句柄释放失败不挡测试收尾 */
  }
  db = null;
  table = null;
}
