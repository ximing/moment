import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoreHorizontal, Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink, IconButton } from './index';

// Button 家族行为契约（Button 规范 §6 / §9 / §10）：
// 默认原生 type="button"；loading 置 aria-busy 并抑制 onClick；ButtonLink 是链接语义；
// IconButton 必须有不依赖 Tooltip 的可访问名称；danger + pill 在类型层被拒绝。

describe('Button', () => {
  it('默认使用原生 type="button"', () => {
    render(<Button>保存更改</Button>);
    expect(screen.getByRole('button', { name: '保存更改' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('表单提交必须显式传 type="submit"', () => {
    render(<Button type="submit">发布</Button>);
    expect(screen.getByRole('button', { name: '发布' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('loading 时设置 aria-busy 并抑制 onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <Button loading onClick={onClick}>
          发布中…
        </Button>
        <Button onClick={onClick}>发布</Button>
      </>,
    );

    const loadingButton = screen.getByRole('button', { name: '发布中…' });
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');

    await user.click(loadingButton);
    expect(onClick).not.toHaveBeenCalled();

    // 非 loading 的同一动作仍可正常触发
    await user.click(screen.getByRole('button', { name: '发布' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('非 loading 不带 aria-busy', () => {
    render(<Button>保存更改</Button>);
    expect(screen.getByRole('button', { name: '保存更改' })).not.toHaveAttribute(
      'aria-busy',
    );
  });

  it('leading icon 仅作装饰，可访问名称来自文案', () => {
    render(<Button leadingIcon={Plus}>添加媒体</Button>);
    const button = screen.getByRole('button', { name: '添加媒体' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ButtonLink', () => {
  it('渲染为原生链接语义而不是 button 包裹链接', () => {
    render(
      <ButtonLink href="/invite" variant="primary" shape="pill">
        接受邀请
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: '接受邀请' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/invite');
  });
});

describe('IconButton', () => {
  it('通过 label 提供独立可访问名称，图标本身为装饰', () => {
    render(<IconButton icon={MoreHorizontal} label="更多操作" />);
    const button = screen.getByRole('button', { name: '更多操作' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('类型契约', () => {
  it('danger + pill 被 discriminated union 拒绝', () => {
    // @ts-expect-error danger 固定使用 standard，pill 组合不允许通过类型检查
    const fixture = <Button variant="danger" shape="pill">删除时刻</Button>;
    expect(fixture).toBeTruthy();
  });
});
