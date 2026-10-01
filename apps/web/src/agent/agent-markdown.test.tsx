import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AgentMarkdown } from './agent-markdown';

const MOMENT_ID = '11111111-1111-4111-8111-111111111111';
const CHAIN_ID = '22222222-2222-4222-8222-222222222222';
const RECAP_ID = '33333333-3333-4333-8333-333333333333';

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderMarkdown(content: string) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AgentMarkdown content={content} />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AgentMarkdown', () => {
  it('渲染加粗、行内代码、无序列表和有序列表', () => {
    renderMarkdown('这是**加粗**和`代码`\n\n- 一项\n- 二项\n\n1. 第一\n2. 第二');

    expect(screen.getByText('加粗').tagName).toBe('STRONG');
    expect(screen.getByText('代码').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '一项',
      '二项',
      '第一',
      '第二',
    ]);
  });

  it('渲染三级标题，更深的井号保持文字', () => {
    renderMarkdown('# 一级\n## 二级\n### 三级\n\n#### 不是标题');

    expect(screen.getByRole('heading', { level: 1, name: '一级' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '二级' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '三级' })).toBeInTheDocument();
    expect(screen.getByText('#### 不是标题')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
  });

  it('三种内部链接在应用内打开，https 新开页', async () => {
    const user = userEvent.setup();
    renderMarkdown(
      [
        `看 moment:${MOMENT_ID}`,
        `链 chain:${CHAIN_ID}`,
        `回顾 recap:${RECAP_ID}/2026-08`,
        '外链 https://example.com/a',
      ].join('\n\n'),
    );

    const external = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(external).toHaveAttribute('href', 'https://example.com/a');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noreferrer');

    await user.click(screen.getByRole('button', { name: `moment:${MOMENT_ID}` }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/moments/${MOMENT_ID}`);

    await user.click(screen.getByRole('button', { name: `chain:${CHAIN_ID}` }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/chains/${CHAIN_ID}`);

    await user.click(screen.getByRole('button', { name: `recap:${RECAP_ID}/2026-08` }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/chains/${RECAP_ID}/recaps/2026-08`);
  });

  it('javascript: 和 moment:// 保持字面量，不变成链接或按钮', () => {
    const view = renderMarkdown('点这里 javascript:alert(1) 不会跳\n\nmoment://invites/abc');

    expect(view.container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/moment:\/\/invites\/abc/)).toBeInTheDocument();
  });

  it('行内代码里的内部链接不跳转', () => {
    renderMarkdown(`看 \`moment:${MOMENT_ID}\``);

    expect(screen.getByText(`moment:${MOMENT_ID}`).tagName).toBe('CODE');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('未闭合的加粗不抛错，按字面量显示', () => {
    const view = renderMarkdown('**没闭合');

    expect(view.container.querySelector('strong')).toBeNull();
    expect(view.container).toHaveTextContent('**没闭合');
  });
});
