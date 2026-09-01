import { describe, expect, it } from 'vitest';
import type { MomentMedia, PublicShareMoment } from '@moment/dto';
import { clampFaceRatio, noteColSpan, noteFaceRatio, noteTiltDeg } from './note-layout';

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

describe('noteColSpan / noteFaceRatio', () => {
  it('横屏视频 → span 2，面子跟 16/9 走', () => {
    const m = base({ type: 'video', media: [img({ id: 'v', width: 1920, height: 1080, mime: 'video/mp4' })] });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceRatio(m)).toBe(16 / 9);
  });

  it('竖屏视频 → span 1，面子跟 9/16 走，不裁成 16/9', () => {
    const m = base({ type: 'video', media: [img({ id: 'v', width: 720, height: 1280, mime: 'video/mp4' })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(9 / 16);
  });

  it('多图跟封面自身比，竖封面不跨列', () => {
    const m = base({
      type: 'media',
      media: [img({ id: 'a', width: 960, height: 1280 }), img({ id: 'b', width: 100, height: 100 })],
    });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(3 / 4);
  });

  it('多图 4:3 封面也不跨列，只因张数多不放大', () => {
    const m = base({
      type: 'media',
      media: [img({ id: 'a', width: 4096, height: 3072 }), img({ id: 'b', width: 100, height: 100 })],
    });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(4 / 3);
  });

  it('手机横拍 4:3（4096×3072）span 1，面子跟 4/3 走', () => {
    const m = base({ type: 'media', media: [img({ id: 'w', width: 4096, height: 3072 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(4 / 3);
  });

  it('手机竖拍 3:4（3072×4096）span 1，面子跟 3/4 走', () => {
    const m = base({ type: 'media', media: [img({ id: 'p', width: 3072, height: 4096 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(3 / 4);
  });

  it('9:16 竖拍不夹成 3:4，整张都露出来', () => {
    const m = base({ type: 'media', media: [img({ id: 'p', width: 720, height: 1280 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(9 / 16);
  });

  it('16:9 横图 span 2，面子跟 16/9 走', () => {
    const m = base({ type: 'media', media: [img({ id: 'w', width: 1920, height: 1080 })] });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceRatio(m)).toBe(16 / 9);
  });

  it('方图 span 1，面子 1', () => {
    const m = base({ type: 'media', media: [img({ id: 's', width: 1000, height: 1000 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(1);
  });

  it('voice / text → span 1，无面子比', () => {
    expect(noteColSpan(base({ type: 'voice' }))).toBe(1);
    expect(noteFaceRatio(base({ type: 'voice' }))).toBeNull();
    expect(noteFaceRatio(base({ type: 'text' }))).toBeNull();
  });

  it('clampFaceRatio 只夹极端超宽超竖', () => {
    expect(clampFaceRatio(2)).toBe(16 / 9);
    expect(clampFaceRatio(0.4)).toBe(9 / 16);
    expect(clampFaceRatio(1)).toBe(1);
  });

  it('缺宽高的单图 → span 1，按手机横拍 4/3', () => {
    const m = base({ type: 'media', media: [img({ id: 'u', width: null, height: null })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceRatio(m)).toBe(4 / 3);
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
