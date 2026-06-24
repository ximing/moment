import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotFound } from './not-found';

// NotFound 契约（plan Task 8）：认证通配符的纯 EmptyState「没有这个页面」，
// 空状态不是错误——没有 error Banner（role="alert"）、没有 status Banner、
// 没有 Toast / ToastRegion，也没有操作按钮。
describe('NotFound', () => {
  it('渲染纯 EmptyState「没有这个页面」，无 Banner / Toast / 操作', () => {
    render(<NotFound />);

    expect(screen.getByText('没有这个页面')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.queryByRole('region', { name: /通知|toast/i }),
    ).toBeNull();
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(screen.queryByTestId('toast-region')).toBeNull();
  });
});
