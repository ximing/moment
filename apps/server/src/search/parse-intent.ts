import { isoDatetime, type SearchParsed, type SearchTime } from '@moment/dto';
import { wallDateOf } from '../moments/wall-date.js';

export function viewerWallDate(tzOffset: number, nowMs: number = Date.now()): string {
  return wallDateOf(new Date(nowMs), tzOffset);
}

export function degradedParsed(q: string): SearchParsed {
  return { personNames: [], place: null, time: null, text: q };
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function parseTime(value: unknown): SearchTime | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const t = value as Record<string, unknown>;
  if (t.kind === 'range') {
    if (typeof t.from !== 'string' || typeof t.to !== 'string') return undefined;
    if (!isoDatetime.safeParse(t.from).success || !isoDatetime.safeParse(t.to).success) return undefined;
    if (Date.parse(t.from) > Date.parse(t.to)) return undefined;
    return { kind: 'range', from: t.from, to: t.to };
  }
  if (t.kind === 'wall_date') {
    if (!isInt(t.year) || !isInt(t.month) || !isInt(t.day)) return undefined;
    if (t.year < 1 || t.month < 1 || t.month > 12 || t.day < 1 || t.day > 31) return undefined;
    return { kind: 'wall_date', year: t.year, month: t.month, day: t.day };
  }
  return undefined;
}

export function parseIntentJson(raw: string): SearchParsed | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.personNames)) return null;
    const personNames = o.personNames.filter((x): x is string => typeof x === 'string');
    if (o.place !== null && typeof o.place !== 'string' && o.place !== undefined) return null;
    const place = typeof o.place === 'string' ? o.place : null;
    if (o.text !== undefined && typeof o.text !== 'string') return null;
    const parsedText = typeof o.text === 'string' ? o.text : '';
    const time = o.time === undefined ? null : parseTime(o.time);
    if (time === undefined) return null;
    return { personNames, place, time, text: parsedText };
  } catch {
    return null;
  }
}
