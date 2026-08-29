import type { SearchParsed } from '@moment/dto';

export function formatSearchParsed(parsed: SearchParsed): string {
  const bits: string[] = [];
  if (parsed.personNames.length > 0) bits.push(parsed.personNames.join('、'));
  if (parsed.place) bits.push(parsed.place);
  if (parsed.time?.kind === 'wall_date') {
    bits.push(`${parsed.time.year}年${parsed.time.month}月${parsed.time.day}日`);
  } else if (parsed.time?.kind === 'range') {
    bits.push(`${parsed.time.from.slice(0, 10)} – ${parsed.time.to.slice(0, 10)}`);
  }
  if (parsed.text) bits.push(parsed.text);
  return bits.length > 0 ? `找到：${bits.join(' · ')}` : '搜索结果';
}
