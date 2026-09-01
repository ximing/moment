import { describe, expect, it } from 'vitest';
import type { MomentMedia, PublicShareMoment } from '@moment/dto';
import { noteColSpan, noteFaceHeight, noteTiltDeg } from './note-layout';

function img(partial: Partial<MomentMedia> & Pick<MomentMedia, 'id' | 'width' | 'height'>): MomentMedia {
  return {
    url: '/x',
    mime: 'image/jpeg',
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: null,
    posterDerivedUrl: null,
    ...partial,
  };
}

function base(over: Partial<PublicShareMoment>): PublicShareMoment {
  return {
    id: 'm-1',
    chainId: 'c-1',
    author: { id: 'u-1', nickname: '林', avatarUrl: null },
    type: 'text',
    kind: 'standard',
    payload: null,
    content: '',
    transcript: null,
    transcriptionStatus: null,
    happenedAt: '2026-09-01T00:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...over,
  };
}

describe('noteColSpan / noteFaceHeight', () => {
  it('video → span 2 高度 192', () => {
    const m = base({ type: 'video', media: [img({ id: 'v', width: 1920, height: 1080, mime: 'video/mp4' })] });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceHeight(m)).toBe(192);
  });

  it('2–9 张图 → span 2 高度 168', () => {
    const m = base({
      type: 'media',
      media: [img({ id: 'a', width: 100, height: 100 }), img({ id: 'b', width: 100, height: 100 })],
    });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceHeight(m)).toBe(168);
  });

  it('横图 width/height ≥ 1.4 → span 2 高度 192', () => {
    const m = base({ type: 'media', media: [img({ id: 'w', width: 1400, height: 1000 })] });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceHeight(m)).toBe(192);
  });

  it('竖图 height/width ≥ 1.25 → span 1 高度 240', () => {
    const m = base({ type: 'media', media: [img({ id: 'p', width: 1000, height: 1250 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceHeight(m)).toBe(240);
  });

  it('方图 0.9–1.1 → span 1 高度 192', () => {
    const m = base({ type: 'media', media: [img({ id: 's', width: 1000, height: 1000 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceHeight(m)).toBe(192);
  });

  it('voice / text → span 1 高度 null', () => {
    expect(noteColSpan(base({ type: 'voice' }))).toBe(1);
    expect(noteFaceHeight(base({ type: 'voice' }))).toBeNull();
    expect(noteFaceHeight(base({ type: 'text' }))).toBeNull();
  });

  it('缺宽高的单图 → span 1 高度 168', () => {
    const m = base({ type: 'media', media: [img({ id: 'u', width: null, height: null })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceHeight(m)).toBe(168);
  });
});

describe('noteTiltDeg', () => {
  it('同一 id 两次结果相同，且 ∈ {-2,-1,0,1,2}', () => {
    const a = noteTiltDeg('m-abc', false);
    expect(a).toBe(noteTiltDeg('m-abc', false));
    expect([-2, -1, 0, 1, 2]).toContain(a);
  });

  it('reducedMotion 时恒 0', () => {
    expect(noteTiltDeg('m-abc', true)).toBe(0);
  });
});
