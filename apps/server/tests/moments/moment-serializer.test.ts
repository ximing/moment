import { momentSerializer } from '../../src/moments/moment-serializer.js';

const moment = {
  id: 'm-1',
  chainId: 'c-1',
  authorId: 'u-1',
  type: 'media' as const,
  kind: 'standard',
  payload: null,
  content: '九张图',
  transcript: null,
  transcriptionStatus: null,
  happenedAt: new Date('2026-08-15T02:00:00Z'),
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: new Date('2026-08-15T02:00:01Z'),
};

function mediaRow(
  partial: Partial<{
    id: string;
    mime: string;
    width: number | null;
    height: number | null;
    duration: number | null;
    sortOrder: number;
    posterMediaId: string | null;
    url: string;
    derivedUrl: string | null;
    posterUrl: string | null;
    posterDerivedUrl: string | null;
  }> = {},
) {
  return {
    id: 'md-1',
    mime: 'image/jpeg',
    width: 10,
    height: 10,
    duration: null as number | null,
    sortOrder: 0,
    posterMediaId: null as string | null,
    url: 'https://signed.example/orig',
    derivedUrl: null as string | null,
    posterUrl: null as string | null,
    posterDerivedUrl: null as string | null,
    ...partial,
  };
}

describe('momentSerializer（moment → API 响应唯一出口）', () => {
  it('media 按 sortOrder 升序，透传已签发的 url', () => {
    const res = momentSerializer(moment, {
      media: [
        mediaRow({
          id: 'md-2',
          mime: 'image/jpeg',
          width: 100,
          height: 200,
          sortOrder: 1,
          url: 'https://signed.example/md-2',
        }),
        mediaRow({
          id: 'md-1',
          mime: 'image/png',
          width: 10,
          height: 20,
          sortOrder: 0,
          url: 'https://signed.example/md-1',
        }),
      ],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect(res.media.map((m) => m.id)).toEqual(['md-1', 'md-2']);
    expect(res.media[0].url).toBe('https://signed.example/md-1');
    expect(res.happenedAt).toBe('2026-08-15T02:00:00.000Z');
    expect(res.author).toEqual({ id: 'u-1', nickname: 'Alice', avatarUrl: null });
    expect(res.tags).toEqual([]);
    // 不传 counts / tags 时走默认值
    expect(res.commentCount).toBe(0);
    expect(res.reactions).toEqual([]);
    expect(res.myReaction).toBeNull();
  });

  it('text 类型 media 为空数组', () => {
    const res = momentSerializer(
      { ...moment, type: 'text', content: 'hi' },
      { media: [], author: { id: 'u-1', nickname: 'Alice', avatarUrl: null } }
    );
    expect(res.media).toEqual([]);
    expect(res.tags).toEqual([]);
  });

  it('extras.tags 原样挂到响应', () => {
    const res = momentSerializer(moment, {
      media: [],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
      tags: [{ id: 't-1', name: '周岁' }],
    });
    expect(res.tags).toEqual([{ id: 't-1', name: '周岁' }]);
    expect(res.author).toEqual({ id: 'u-1', nickname: 'Alice', avatarUrl: null });
    expect(res.media).toEqual([]);
  });

  it('voice：transcript / transcriptionStatus 透传出口；非 voice 恒 null（spec §3.3）', () => {
    const res = momentSerializer(
      { ...moment, type: 'voice', content: '', transcript: 'ASR 原文', transcriptionStatus: 'done' },
      { media: [], author: { id: 'u-1', nickname: 'Alice', avatarUrl: null } }
    );
    expect(res.transcript).toBe('ASR 原文');
    expect(res.transcriptionStatus).toBe('done');
    const plain = momentSerializer(moment, { media: [], author: { id: 'u-1', nickname: 'A', avatarUrl: null } });
    expect(plain.transcript).toBeNull();
    expect(plain.transcriptionStatus).toBeNull();
  });
});

describe('momentSerializer 公开基形（spec §8：persons/place 不在基函数输出）', () => {
  it('输出不含 persons/place 键——两键由 serializeMoments 在 includePrivate 路径拼接', () => {
    const res = momentSerializer(moment, {
      media: [],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect('persons' in res).toBe(false);
    expect('place' in res).toBe(false);
    expect(Object.keys(res)).not.toContain('persons');
    expect(Object.keys(res)).not.toContain('place');
  });
});

describe('momentSerializer derivedUrl / posterDerivedUrl（spec fused-retrieval §2.1）', () => {
  it('透传已签发的 derivedUrl；空则保持 null', () => {
    const ready = momentSerializer(moment, {
      media: [
        mediaRow({
          width: 512,
          height: 256,
          url: 'https://signed.example/orig',
          derivedUrl: 'https://signed.example/derived',
        }),
      ],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect(ready.media[0].derivedUrl).toBe('https://signed.example/derived');
    expect(ready.media[0].posterDerivedUrl).toBeNull();
    expect(ready.media[0].url).toBe('https://signed.example/orig');

    const empty = momentSerializer(moment, {
      media: [mediaRow()],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect(empty.media[0].derivedUrl).toBeNull();
  });

  it('视频行：透传 posterUrl / posterDerivedUrl；图片行 posterDerivedUrl 恒 null', () => {
    const video = momentSerializer(
      { ...moment, type: 'video' },
      {
        media: [
          mediaRow({
            id: 'vid-1',
            mime: 'video/mp4',
            width: 1280,
            height: 720,
            duration: 12,
            posterMediaId: 'poster-1',
            url: 'https://signed.example/vid',
            posterUrl: 'https://signed.example/poster',
            posterDerivedUrl: 'https://signed.example/poster-derived',
          }),
        ],
        author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
      },
    );
    expect(video.media[0].derivedUrl).toBeNull();
    expect(video.media[0].posterUrl).toBe('https://signed.example/poster');
    expect(video.media[0].posterDerivedUrl).toBe('https://signed.example/poster-derived');

    const image = momentSerializer(moment, {
      media: [mediaRow({ derivedUrl: 'https://signed.example/derived' })],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect(image.media[0].posterDerivedUrl).toBeNull();
  });
});
