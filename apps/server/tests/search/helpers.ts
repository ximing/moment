import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function idsOf(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id);
}

export async function setPlace(momentId: string, name: string): Promise<void> {
  await db
    .update(moments)
    .set({
      placeLat: 39.9042,
      placeLng: 116.4074,
      placeName: name,
      placeSource: 'manual',
    })
    .where(eq(moments.id, momentId));
}

export async function setTranscript(momentId: string, transcript: string): Promise<void> {
  await db.update(moments).set({ transcript }).where(eq(moments.id, momentId));
}
