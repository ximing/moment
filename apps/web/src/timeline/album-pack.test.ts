import { describe, expect, it } from 'vitest';
import type { MomentMedia, PublicShareMoment } from '@moment/dto';
import {
  estimateNoteHeightPx,
  estimateNoteStack,
  masonryItemStyle,
  packAlbumMonth,
  packShortestColumn,
  packSpanningMasonry,
} from './album-pack';

describe('packShortestColumn', () => {
  it('等高条目按列从左往右铺', () => {
    expect(packShortestColumn([1, 1, 1, 1], (h) => h, 4)).toEqual([[1], [1], [1], [1]]);
  });

  it('矮卡跟进当前最矮列，不另起一行留空洞', () => {
    // 高、矮、矮：第三张应进第 2 列（仍空），第四张矮卡进第 1 列矮堆
    const packed = packShortestColumn([10, 2, 2, 3], (h) => h, 3);
    expect(packed.map((col) => col.reduce((a, b) => a + b, 0))).toEqual([10, 5, 2]);
    expect(packed).toEqual([[10], [2, 3], [2]]);
  });
});

describe('packSpanningMasonry', () => {
  it('全 span 1 时与最短列一致：等高从左往右', () => {
    const { placements, totalHeight } = packSpanningMasonry(
      [1, 1, 1, 1],
      4,
      () => 1,
      (h) => h,
    );
    expect(placements.map((p) => p.col)).toEqual([0, 1, 2, 3]);
    expect(totalHeight).toBe(1);
  });

  it('span 2 视频旁的矮语音填同一行的空列，不掉到下一行', () => {
    // 高截图 + 宽视频 + 两张语音：视频占 1–2 列，两张语音叠在第 4 列
    const items = [
      { id: 'code', span: 1 as const, h: 10 },
      { id: 'video', span: 2 as const, h: 8 },
      { id: 'v1', span: 1 as const, h: 3 },
      { id: 'v2', span: 1 as const, h: 3 },
    ];
    const { placements, totalHeight } = packSpanningMasonry(
      items,
      4,
      (it) => it.span,
      (it) => it.h,
    );
    expect(placements.map((p) => ({ id: p.item.id, col: p.col, span: p.span, y: p.y }))).toEqual([
      { id: 'code', col: 0, span: 1, y: 0 },
      { id: 'video', col: 1, span: 2, y: 0 },
      { id: 'v1', col: 3, span: 1, y: 0 },
      { id: 'v2', col: 3, span: 1, y: 3 },
    ]);
    expect(totalHeight).toBe(10);
  });

  it('视频先放 span 2 时，后续矮卡填右侧空列', () => {
    const items = [
      { id: 'video', span: 2 as const, h: 8 },
      { id: 'v1', span: 1 as const, h: 3 },
      { id: 'v2', span: 1 as const, h: 3 },
    ];
    const { placements } = packSpanningMasonry(
      items,
      4,
      (it) => it.span,
      (it) => it.h,
    );
    expect(placements.map((p) => ({ id: p.item.id, col: p.col, y: p.y }))).toEqual([
      { id: 'video', col: 0, y: 0 },
      { id: 'v1', col: 2, y: 0 },
      { id: 'v2', col: 3, y: 0 },
    ]);
  });

  it('两列且邻列不等高时 span 2 退回 1，避免旁边留洞', () => {
    const items = [
      { id: 'code', span: 1 as const, h: 10 },
      { id: 'video', span: 2 as const, h: 8 },
      { id: 'v1', span: 1 as const, h: 3 },
    ];
    const { placements } = packSpanningMasonry(
      items,
      2,
      (it) => it.span,
      (it) => it.h,
    );
    expect(placements.map((p) => ({ id: p.item.id, col: p.col, span: p.span, y: p.y }))).toEqual([
      { id: 'code', col: 0, span: 1, y: 0 },
      { id: 'video', col: 1, span: 1, y: 0 },
      { id: 'v1', col: 1, span: 1, y: 8 },
    ]);
  });

  it('列数不足时 span 夹到列数', () => {
    const { placements, totalHeight } = packSpanningMasonry(
      [{ id: 'video', span: 2 as const, h: 5 }],
      1,
      (it) => it.span,
      (it) => it.h,
    );
    expect(placements[0]).toMatchObject({ col: 0, span: 1, y: 0 });
    expect(totalHeight).toBe(5);
  });

  it('masonryItemStyle 跨两列含中间间隙', () => {
    expect(masonryItemStyle(1, 2, 10, 100, 12)).toEqual({ left: 112, top: 10, width: 212 });
  });
});

function img(width: number, height: number, mime = 'image/jpeg'): MomentMedia {
  return {
    id: 'm',
    url: '/x',
    mime,
    width,
    height,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: null,
    posterDerivedUrl: null,
  };
}

function moment(over: Partial<PublicShareMoment>): PublicShareMoment {
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

describe('packAlbumMonth', () => {
  it('4 列时横屏视频最多跨 2 列，不占满三列挤掉邻居', () => {
    const photo = moment({ id: 'photo', type: 'media', media: [img(4096, 3072)] });
    const video = moment({
      id: 'video',
      type: 'video',
      media: [img(1920, 1080, 'video/mp4')],
    });
    const v1 = moment({ id: 'v1', type: 'voice', content: '好看萌萌的' });
    const v2 = moment({ id: 'v2', type: 'voice', content: '真棒 哈哈哈' });
    const { placements } = packAlbumMonth([photo, video, v1, v2], 4, 200);
    const byId = Object.fromEntries(placements.map((p) => [p.item.id, p]));
    expect(byId.photo).toMatchObject({ col: 0, span: 1 });
    expect(byId.video).toMatchObject({ col: 1, span: 2 });
    expect(byId.v1?.col).toBe(3);
    expect(byId.v2?.col).toBe(3);
    expect(byId.v2!.y).toBeGreaterThan(byId.v1!.y);
  });

  it('竖拍无论单张还是独占月份都不跨列，避免一张通天高', () => {
    const port = moment({ id: 'port', type: 'media', media: [img(960, 1280)] });
    expect(packAlbumMonth([port], 4, 200).placements[0]).toMatchObject({ col: 0, span: 1 });
    const withFriend = moment({ id: 'land', type: 'media', media: [img(4096, 3072)] });
    const packed = packAlbumMonth([port, withFriend], 4, 200);
    expect(packed.placements.find((p) => p.item.id === 'port')).toMatchObject({ span: 1 });
  });

  it('月份里只有一张 4:3 照片时放大到 span 2，不留三列空', () => {
    const photo = moment({ id: 'july', type: 'media', media: [img(4096, 3072)] });
    const { placements } = packAlbumMonth([photo], 4, 200);
    expect(placements[0]).toMatchObject({ col: 0, span: 2 });
  });

  it('月份里只有一条横屏视频时放大到 span 2，不再跨 3 列', () => {
    const video = moment({
      id: 'solo-video',
      type: 'video',
      media: [img(1920, 1080, 'video/mp4')],
    });
    const { placements } = packAlbumMonth([video], 4, 200);
    expect(placements[0]).toMatchObject({ col: 0, span: 2 });
  });
});

describe('estimateNoteStack', () => {
  it('语音短于 4:3 照片，竖拍高于横拍', () => {
    const voice = estimateNoteStack(moment({ type: 'voice' }));
    const land = estimateNoteStack(moment({ type: 'media', media: [img(4096, 3072)] }));
    const port = estimateNoteStack(moment({ type: 'media', media: [img(3072, 4096)] }));
    expect(voice).toBeLessThan(land);
    expect(land).toBeLessThan(port);
    const video = estimateNoteStack(moment({ type: 'video', media: [img(1920, 1080, 'video/mp4')] }));
    expect(land).toBeLessThan(video);
  });
});

describe('estimateNoteHeightPx', () => {
  it('同一条 16:9 视频 span 3 高于 span 2，面子跟媒体宽高走', () => {
    const video = moment({ type: 'video', media: [img(1920, 1080, 'video/mp4')] });
    const h2 = estimateNoteHeightPx(video, 2, 200);
    const h3 = estimateNoteHeightPx(video, 3, 200);
    expect(h3).toBeGreaterThan(h2);
    const inner2 = 2 * 200 + 12 - 16;
    const inner3 = 3 * 200 + 24 - 16;
    expect(h3 - h2).toBeCloseTo(inner3 / (16 / 9) - inner2 / (16 / 9), 0);
  });

  it('同样列宽下长正文比短正文更高', () => {
    const short = moment({ type: 'text', content: '嗯' });
    const long = moment({
      type: 'text',
      content: '第一次自己说回家。那天风很大，帽子被吹走一次，后来又捡回来了。',
    });
    expect(estimateNoteHeightPx(long, 1, 200)).toBeGreaterThan(estimateNoteHeightPx(short, 1, 200));
  });
});
