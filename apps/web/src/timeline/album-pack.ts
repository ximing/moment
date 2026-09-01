import { layout, prepare } from '@chenglou/pretext';
import type { PublicShareMoment } from '@moment/dto';
import { noteColSpan, noteFaceRatio } from './note-layout';

/** 与网格 `gap-3` 同档，打包时计入列间/卡间空隙。 */
export const ALBUM_GAP_PX = 12;

export type MasonryPlacement<T> = {
  item: T;
  col: number;
  span: number;
  y: number;
  h: number;
};

/** 视频/宽图在有同伴时尽量占满「留一列给矮卡」；独占月份再放大。 */
export function notePreferredSpan(moment: PublicShareMoment, colCount: number, siblingCount: number): number {
  const n = Math.max(1, colCount);
  if (n === 1) return 1;
  const hero = moment.type === 'video' || noteColSpan(moment) === 2;
  if (siblingCount <= 0) {
    if (hero) return Math.min(3, n);
    return Math.min(2, n);
  }
  if (hero) return Math.min(n, Math.max(2, n - 1), 3);
  return 1;
}

/** 把条目按「当前最矮列」从左到右投放，避免 Grid 行高被最高卡撑开后留下空洞。 */
export function packShortestColumn<T>(items: T[], weight: (item: T) => number, colCount: number): T[][] {
  const n = Math.max(1, colCount);
  const cols: T[][] = Array.from({ length: n }, () => []);
  const heights = Array<number>(n).fill(0);
  for (const item of items) {
    let i = 0;
    for (let c = 1; c < n; c++) {
      if (heights[c] < heights[i]!) i = c;
    }
    cols[i]!.push(item);
    heights[i]! += weight(item);
  }
  return cols;
}

/**
 * 可跨列的最短槽位：span 占相邻列同一 y，其余卡填当前最矮且能放下的槽。
 * 列高并列时取最左，时间序大致从左到右。
 */
export function packSpanningMasonry<T>(
  items: T[],
  colCount: number,
  spanOf: (item: T) => number,
  heightOf: (item: T, span: number) => number,
  gap = 0,
): { placements: MasonryPlacement<T>[]; totalHeight: number } {
  const n = Math.max(1, colCount);
  const heights = Array<number>(n).fill(0);
  const placements: MasonryPlacement<T>[] = [];
  for (const item of items) {
    const requested = spanOf(item);
    let span = Math.min(Math.max(1, requested), n);
    const slot = (s: number) => {
      let bestCol = 0;
      let bestY = Number.POSITIVE_INFINITY;
      let uneven = false;
      for (let c = 0; c <= n - s; c++) {
        let y = 0;
        let minH = heights[c]!;
        for (let k = 0; k < s; k++) {
          const colH = heights[c + k]!;
          if (colH > y) y = colH;
          if (colH < minH) minH = colH;
        }
        if (y < bestY) {
          bestY = y;
          bestCol = c;
          uneven = s > 1 && minH + 1 < y;
        }
      }
      return { col: bestCol, y: bestY, uneven };
    };
    let chosen = slot(span);
    while (span > 1 && chosen.uneven) {
      span -= 1;
      chosen = slot(span);
    }
    const h = heightOf(item, span);
    placements.push({ item, col: chosen.col, span, y: chosen.y, h });
    const next = chosen.y + h + gap;
    for (let k = 0; k < span; k++) heights[chosen.col + k] = next;
  }
  let totalHeight = 0;
  for (const colH of heights) {
    const bottom = colH === 0 ? 0 : colH - gap;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  return { placements, totalHeight };
}

/** 相对列宽的堆叠高度：面子 span/ratio，纸边约 0.32 列宽；语音/文字更矮。 */
export function estimateNoteStack(moment: PublicShareMoment): number {
  const writing = 0.32;
  const ratio = noteFaceRatio(moment);
  const span = noteColSpan(moment);
  if (ratio === null) return moment.type === 'voice' ? 0.48 : 0.55;
  return span / ratio + writing;
}

const NOTE_PAD = 8;
const WRITING_PAD_X = 4;
const WRITING_PAD_Y = 10;
const META_GAP = 8;
const VOICE_BAR = 36;
const NOTE_FONT = '13px sans-serif';
const NOTE_LINE = 20;

function fallbackTextHeight(text: string, maxWidth: number, lineHeight: number, maxLines: number): number {
  if (!text) return 0;
  let lineW = 0;
  let lines = 1;
  for (const ch of text) {
    if (ch === '\n') {
      lines += 1;
      lineW = 0;
      continue;
    }
    const w = ch.charCodeAt(0) > 0x2e80 ? 13 : 7;
    if (lineW > 0 && lineW + w > maxWidth) {
      lines += 1;
      lineW = w;
    } else {
      lineW += w;
    }
  }
  return Math.min(lines, maxLines) * lineHeight;
}

const preparedCache = new Map<string, ReturnType<typeof prepare>>();

function canUsePretext(): boolean {
  return typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent);
}

function measureClampedText(text: string, maxWidth: number, lineHeight: number, maxLines: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (canUsePretext()) {
    try {
      let prepared = preparedCache.get(trimmed);
      if (!prepared) {
        prepared = prepare(trimmed, NOTE_FONT, { whiteSpace: 'pre-wrap' });
        preparedCache.set(trimmed, prepared);
      }
      const { height, lineCount } = layout(prepared, maxWidth, lineHeight);
      if (lineCount > 0 && height > 0) {
        return Math.min(lineCount, maxLines) * lineHeight;
      }
    } catch {
      /* 无 canvas 时回退 */
    }
  }
  return fallbackTextHeight(trimmed, maxWidth, lineHeight, maxLines);
}

/** 卡片像素高：面子按媒体宽高比吃 span 后的内容宽，纸边用 pretext 量正文。 */
export function estimateNoteHeightPx(
  moment: PublicShareMoment,
  span: number,
  colWidthPx: number,
  gap = ALBUM_GAP_PX,
): number {
  const cardW = span * colWidthPx + Math.max(0, span - 1) * gap;
  const innerW = Math.max(1, cardW - NOTE_PAD * 2);
  const textW = Math.max(1, innerW - WRITING_PAD_X * 2);
  const ratio = noteFaceRatio(moment);
  let mediaH = 0;
  if (ratio !== null) mediaH = innerW / ratio;
  else if (moment.type === 'voice') mediaH = VOICE_BAR;

  const tags = moment.tags.map((t) => `#${t.name}`).join(' ');
  const body = [tags, moment.content].filter(Boolean).join(' ');
  const bodyH = measureClampedText(body, textW, NOTE_LINE, moment.type === 'text' ? 5 : 2);
  const meta = `${moment.author.nickname} · 下午 5:00`;
  const metaH = Math.max(NOTE_LINE, measureClampedText(meta, textW, NOTE_LINE, 3));
  return NOTE_PAD * 2 + mediaH + WRITING_PAD_Y + (bodyH > 0 ? bodyH + META_GAP : META_GAP) + metaH;
}

export function packAlbumMonth(
  moments: PublicShareMoment[],
  colCount: number,
  colWidthPx: number,
  measuredHeights?: ReadonlyMap<string, number>,
): { placements: MasonryPlacement<PublicShareMoment>[]; totalHeight: number } {
  const n = Math.max(1, colCount);
  const siblings = Math.max(0, moments.length - 1);
  return packSpanningMasonry(
    moments,
    n,
    (m) => notePreferredSpan(m, n, siblings),
    (m, span) => measuredHeights?.get(m.id) ?? estimateNoteHeightPx(m, span, colWidthPx),
    ALBUM_GAP_PX,
  );
}

export function masonryItemStyle(
  col: number,
  span: number,
  y: number,
  colWidth: number,
  gap = ALBUM_GAP_PX,
): { left: number; top: number; width: number } {
  return {
    left: col * (colWidth + gap),
    top: y,
    width: span * colWidth + (span - 1) * gap,
  };
}

export function albumColCount(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 2;
  if (window.matchMedia('(min-width: 1400px)').matches) return 4;
  if (window.matchMedia('(min-width: 900px)').matches) return 3;
  return 2;
}
