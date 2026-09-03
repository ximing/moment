import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { register, resolve } from '@rabjs/react';
import type { TemplateManifest } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { ComposePanelService } from './compose-panel/compose-panel.service';
import { TemplateFields } from './template-fields';

// 发布器词表渲染（spec 2026-09-03-svg-icon-system §4.2）：
// mood emoji-picker 选项与里程碑目录 chips 的 icon 位是数据值，经 AppIcon 走
// 注册表 SVG（存量 emoji 经 EMOJI_TO_ICON 映射命中）；写回草稿的值仍是原文
// （emoji / catalog key），值契约不变。
// 与 person-picker.test.tsx 同一约定：渲染前播种 service 字段（jsdom 下 RAB
// 属性变更不触发 observer 重渲）。

vi.mock('@/api/client', () => ({
  client: new Proxy({}, { get: () => () => new Promise(() => undefined) }),
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);
register(ChainListService);
register(ComposeSessionService);
register(ComposePanelService);

function seed(over: { manifest: TemplateManifest; kind?: string }) {
  const service = resolve(ComposePanelService);
  service.manifest = over.manifest;
  service.kind = over.kind ?? 'standard';
  service.payloadDraft = {};
  return service;
}

beforeEach(() => {
  const service = resolve(ComposePanelService);
  service.manifest = null;
  service.kind = 'standard';
  service.payloadDraft = {};
});

describe('TemplateFields emoji-picker', () => {
  const manifest = {
    version: 1,
    momentFields: [
      { key: 'mood', type: 'emoji-picker', label: '此刻心情', options: ['😄', '🥰', '😭', '😤', '😴'] },
    ],
  } as unknown as TemplateManifest;

  it('mood 选项渲染为注册表 SVG（无障碍名 = 注册表 label），不再是 emoji 文本节点', () => {
    render(<TemplateFields service={seed({ manifest })} edit={false} />);

    const group = screen.getByRole('group', { name: '此刻心情' });
    const joyOption = within(group).getByRole('button', { name: '开心' });
    const icon = within(joyOption).getByRole('img', { name: '开心' });
    expect(icon.tagName).toBe('svg');
    expect(joyOption).not.toHaveTextContent('😄');
    // 词表其余四项同样命中（幸福/难过/烦躁/困倦）
    expect(within(group).getByRole('button', { name: '幸福' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: '烦躁' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: '困倦' })).toBeInTheDocument();
  });

  it('点选写回草稿的仍是 emoji 原文（值契约不变）', async () => {
    const user = userEvent.setup();
    const service = seed({ manifest });
    render(<TemplateFields service={service} edit={false} />);

    await user.click(screen.getByRole('button', { name: '开心' }));
    expect(service.payloadDraft.mood).toBe('😄');
  });
});

describe('TemplateFields rating emoji-picker（reading 模板 rating-* key 选项）', () => {
  const manifest = {
    version: 1,
    momentFields: [
      { key: 'book', type: 'text', label: '在读的书' },
      {
        key: 'rating',
        type: 'emoji-picker',
        label: '推荐度',
        options: ['rating-love', 'rating-good', 'rating-ok', 'rating-pass'],
      },
    ],
  } as unknown as TemplateManifest;

  it('rating-* key 选项经 AppIcon 命中注册表出 SVG：rating-love 渲染 aria-label="超爱"', () => {
    render(<TemplateFields service={seed({ manifest })} edit={false} />);

    const group = screen.getByRole('group', { name: '推荐度' });
    const loveOption = within(group).getByRole('button', { name: '超爱' });
    const icon = within(loveOption).getByRole('img', { name: '超爱' });
    expect(icon.tagName).toBe('svg');
    // key 原文不得泄漏为文本节点
    expect(loveOption).not.toHaveTextContent('rating-love');
    // 词表其余三项同样命中（推荐/一般/不推荐）
    expect(within(group).getByRole('button', { name: '推荐' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: '一般' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: '不推荐' })).toBeInTheDocument();
  });

  it('点选写回草稿的仍是 rating-* key 原文（值契约不变）', async () => {
    const user = userEvent.setup();
    const service = seed({ manifest });
    render(<TemplateFields service={service} edit={false} />);

    await user.click(screen.getByRole('button', { name: '超爱' }));
    expect(service.payloadDraft.rating).toBe('rating-love');
  });
});

describe('TemplateFields 里程碑目录 chips', () => {
  const manifest = {
    version: 1,
    kinds: [
      {
        key: 'milestone',
        label: '里程碑',
        payloadSchema: { type: 'object', properties: { catalog_key: { type: 'string' } } },
      },
    ],
    milestoneCatalog: [
      { key: 'first-smile', label: '第一次微笑', icon: 'milestone-first-smile' },
      { key: 'first-tooth', label: '第一颗牙', icon: '🦷' },
    ],
  } as unknown as TemplateManifest;

  it('目录 icon 位经 AppIcon 渲染（key 形态与存量 emoji 都命中注册表）', () => {
    render(
      <TemplateFields service={seed({ manifest, kind: 'milestone' })} edit={false} />,
    );

    const group = screen.getByRole('group', { name: '里程碑' });
    const smile = within(group).getByRole('button', { name: /第一次微笑/ });
    expect(smile.querySelector('svg')).not.toBeNull();
    const tooth = within(group).getByRole('button', { name: /第一颗牙/ });
    // 存量 emoji 🦷 经映射命中 milestone-first-tooth
    expect(tooth.querySelector('svg')).not.toBeNull();
    expect(tooth).not.toHaveTextContent('🦷');
  });
});
