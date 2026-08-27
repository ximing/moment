import type { ChainDto } from '@moment/dto';
import { describe, expect, it } from 'vitest';
import {
  appearanceDraftFromChain,
  appearanceInputFromDraft,
  CENTER_FOCUS,
  focusObjectPosition,
  shiftFocusForDrag,
  type ChainAppearanceDraft,
  type ChainImageDraft,
} from './appearance-model';

// 草稿模型纯逻辑（chain-appearance plan Task 7）：
// ChainDto → 三模式互斥草稿；草稿 → create/update payload（恰好一个模式激活，
// inactive 字段显式 null 切模式；cover 独立：有 id 才随附 focus，null 时省略 focus——
// 对应 Task 1 DTO「coverMediaId:null + coverFocus 拒绝」与删除语义）；
// 焦点几何：cover 缩放超出量换算、无 overflow 轴回 0.5、两轴 clamp。

function makeChain(partial: Partial<ChainDto>): ChainDto {
  return {
    id: 'chain-1',
    name: '测试链',
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: null,
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    ...partial,
  };
}

function makeImage(partial: Partial<ChainImageDraft>): ChainImageDraft {
  return {
    mediaId: null,
    src: null,
    focus: CENTER_FOCUS,
    persisted: false,
    status: 'ready',
    progress: 0,
    error: null,
    fileName: null,
    ...partial,
  };
}

function makeDraft(partial: Partial<ChainAppearanceDraft>): ChainAppearanceDraft {
  return {
    avatarMode: 'color',
    color: 'mint',
    icon: null,
    avatar: null,
    cover: null,
    ...partial,
  };
}

describe('appearanceDraftFromChain', () => {
  it('图片模式：avatarMediaId/URL/focus 进入持久化图片草稿，焦点默认居中', () => {
    const draft = appearanceDraftFromChain(
      makeChain({
        avatarMediaId: 'm-1',
        avatarUrl: '/api/media/m-1',
        avatarFocus: { x: 0.25, y: 0.75 },
        color: null,
        icon: null,
      }),
    );
    expect(draft.avatarMode).toBe('image');
    expect(draft.color).toBeNull();
    expect(draft.icon).toBeNull();
    expect(draft.avatar).toEqual({
      mediaId: 'm-1',
      src: '/api/media/m-1',
      focus: { x: 0.25, y: 0.75 },
      persisted: true,
      status: 'ready',
      progress: 0,
      error: null,
      fileName: null,
    });
    expect(draft.cover).toBeNull();
  });

  it('图片模式缺 focus 时回退居中', () => {
    const draft = appearanceDraftFromChain(
      makeChain({ avatarMediaId: 'm-1', avatarUrl: '/api/media/m-1', avatarFocus: null }),
    );
    expect(draft.avatar?.focus).toEqual(CENTER_FOCUS);
  });

  it('Emoji 模式：icon 非空时 color 也忽略（防御性优先级 image > icon > color）', () => {
    const draft = appearanceDraftFromChain(
      makeChain({ icon: '🌱', color: 'mint' }),
    );
    expect(draft.avatarMode).toBe('emoji');
    expect(draft.icon).toBe('🌱');
    expect(draft.color).toBeNull();
    expect(draft.avatar).toBeNull();
  });

  it('纯色模式：color 非空；全空时回退 color 模式且 color 为 null（展示层再按 id 哈希）', () => {
    const colored = appearanceDraftFromChain(makeChain({ color: '#A1B2C3' }));
    expect(colored.avatarMode).toBe('color');
    expect(colored.color).toBe('#A1B2C3');

    const empty = appearanceDraftFromChain(makeChain({}));
    expect(empty.avatarMode).toBe('color');
    expect(empty.color).toBeNull();
  });

  it('cover 独立水合：id/URL/focus 齐全才成为持久化封面，否则为 null', () => {
    const withCover = appearanceDraftFromChain(
      makeChain({
        coverMediaId: 'm-9',
        coverUrl: '/api/media/m-9',
        coverFocus: { x: 0.5, y: 0.1 },
      }),
    );
    expect(withCover.cover).toEqual({
      mediaId: 'm-9',
      src: '/api/media/m-9',
      focus: { x: 0.5, y: 0.1 },
      persisted: true,
      status: 'ready',
      progress: 0,
      error: null,
      fileName: null,
    });

    // 历史脏数据：coverMediaId 存在但 URL/focus 为 null → 不可安全复用，视为无封面
    const broken = appearanceDraftFromChain(
      makeChain({ coverMediaId: 'm-9', coverUrl: null, coverFocus: null }),
    );
    expect(broken.cover).toBeNull();
  });
});

describe('appearanceInputFromDraft', () => {
  it('Emoji 模式：只激活 icon，avatar/cover 字段按草稿状态输出', () => {
    const input = appearanceInputFromDraft(makeDraft({ avatarMode: 'emoji', icon: '🐾' }));
    expect(input.icon).toBe('🐾');
    expect(input.color).toBeNull();
    expect(input.avatarMediaId).toBeNull();
    expect(input.avatarFocus).toBeUndefined();
    expect(input.coverMediaId).toBeNull();
    expect(input.coverFocus).toBeUndefined();
  });

  it('纯色模式：只激活 color', () => {
    const input = appearanceInputFromDraft(
      makeDraft({ avatarMode: 'color', color: '#FF8800' }),
    );
    expect(input.color).toBe('#FF8800');
    expect(input.icon).toBeNull();
    expect(input.avatarMediaId).toBeNull();
    expect(input.avatarFocus).toBeUndefined();
  });

  it('图片模式：mediaId + focus 一起提交；未 ready 视为无图', () => {
    const ready = appearanceInputFromDraft(
      makeDraft({
        avatarMode: 'image',
        avatar: makeImage({ mediaId: 'm-1', focus: { x: 0.2, y: 0.8 } }),
      }),
    );
    expect(ready.avatarMediaId).toBe('m-1');
    expect(ready.avatarFocus).toEqual({ x: 0.2, y: 0.8 });
    expect(ready.icon).toBeNull();
    expect(ready.color).toBeNull();

    // 上传中：mediaId 可能已存在但状态不是 ready，不能提交半成品（服务端会拒绝并清模式）
    const uploading = appearanceInputFromDraft(
      makeDraft({
        avatarMode: 'image',
        avatar: makeImage({ mediaId: 'm-1', status: 'uploading' }),
      }),
    );
    expect(uploading.avatarMediaId).toBeNull();
    expect(uploading.avatarFocus).toBeUndefined();
  });

  it('cover 有 ready 图片时随附 mediaId + focus；无封面传 null 并省略 focus', () => {
    const withCover = appearanceInputFromDraft(
      makeDraft({
        avatarMode: 'color',
        color: 'gold',
        cover: makeImage({ mediaId: 'm-9', focus: { x: 0.5, y: 0.3 } }),
      }),
    );
    expect(withCover.coverMediaId).toBe('m-9');
    expect(withCover.coverFocus).toEqual({ x: 0.5, y: 0.3 });

    const noCover = appearanceInputFromDraft(makeDraft({}));
    expect(noCover.coverMediaId).toBeNull();
    expect(noCover.coverFocus).toBeUndefined();
  });
});

describe('shiftFocusForDrag', () => {
  // 宽图放进高视口：scale 由高度决定，水平方向产生 overflow
  it('水平拖动按 excessX 换算：focus.x - dx/excessX', () => {
    // 1000x500 图进 200x200 视口：scale=0.4，显示 400x200，excessX=200
    const next = shiftFocusForDrag(
      { x: 0.5, y: 0.5 },
      { deltaX: 50, deltaY: 30 },
      { imageWidth: 1000, imageHeight: 500, viewportWidth: 200, viewportHeight: 200 },
    );
    expect(next.x).toBeCloseTo(0.25); // 0.5 - 50/200
    // 垂直方向无 overflow：不继承旧值，回到 0.5
    expect(next.y).toBe(0.5);
  });

  it('垂直方向同理：excessY 换算，水平无 overflow 回 0.5', () => {
    // 500x1000 图进 200x200：scale=0.4，显示 200x400，excessY=200
    const next = shiftFocusForDrag(
      { x: 0.5, y: 0.5 },
      { deltaX: 10, deltaY: -100 },
      { imageWidth: 500, imageHeight: 1000, viewportWidth: 200, viewportHeight: 200 },
    );
    expect(next.y).toBeCloseTo(1); // 0.5 - (-100)/200
    expect(next.x).toBe(0.5);
  });

  it('拖动越界时 clamp 到 [0,1]（横图 clamp x，竖图 clamp y）', () => {
    // 横图 1000x500 进 200x200：excessX=200。x 拖出 0 下界。
    const wide = shiftFocusForDrag(
      { x: 0.1, y: 0.9 },
      { deltaX: 1000, deltaY: 0 },
      { imageWidth: 1000, imageHeight: 500, viewportWidth: 200, viewportHeight: 200 },
    );
    expect(wide.x).toBe(0);
    expect(wide.y).toBe(0.5); // 无 overflow 轴回 0.5

    // 竖图 500x1000 进 200x200：excessY=200。y 拖过 1 上界。
    const tall = shiftFocusForDrag(
      { x: 0.1, y: 0.9 },
      { deltaX: 0, deltaY: -1000 },
      { imageWidth: 500, imageHeight: 1000, viewportWidth: 200, viewportHeight: 200 },
    );
    expect(tall.x).toBe(0.5); // 无 overflow 轴回 0.5
    expect(tall.y).toBe(1);
  });

  it('视口与图片等比（两轴都无 overflow）时两轴都回 0.5', () => {
    const next = shiftFocusForDrag(
      { x: 0.2, y: 0.8 },
      { deltaX: 40, deltaY: 40 },
      { imageWidth: 200, imageHeight: 200, viewportWidth: 100, viewportHeight: 100 },
    );
    expect(next).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('focusObjectPosition', () => {
  it('输出 CSS object-position 百分比', () => {
    expect(focusObjectPosition({ x: 0.5, y: 0.5 })).toBe('50% 50%');
    expect(focusObjectPosition({ x: 0, y: 1 })).toBe('0% 100%');
    expect(focusObjectPosition({ x: 0.25, y: 0.75 })).toBe('25% 75%');
  });
});
