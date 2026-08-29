import { sql, type SQL } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';

export function escapeLike(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function likeContains(column: Column, raw: string): SQL {
  const pattern = `%${escapeLike(raw)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE ${sql.raw(`'\\\\'`)}`;
}
