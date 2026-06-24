import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, ToastRegion } from '@/ui/feedback/index';
import { DesignLab } from './index';

// Design Lab 契约（plan Task 8）：开发期专用视觉脚手架。
// - 只在 import.meta.env.DEV 渲染；生产构建无任何分区输出。
// - 五族分区：Button / Field / Modal / Menu / Feedback，各自带可访问名称。
// - 四个带标签的视口预设：390 / 1024 / 1440 / 1895。
// - 本地明暗切换写 documentElement.dataset.theme，卸载后还原。

function renderLab() {
  return render(
    <ToastProvider>
      <DesignLab />
      <ToastRegion />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete document.documentElement.dataset.theme;
});

describe('Design Lab（/__design-lab）', () => {
  it('DEV=true 时渲染 Button/Field/Modal/Menu/Feedback 五族分区', () => {
    vi.stubEnv('DEV', true);
    renderLab();
    for (const name of ['Button', 'Field', 'Modal', 'Menu', 'Feedback']) {
      expect(
        screen.getByRole('region', { name }),
        `缺少 ${name} 分区`,
      ).toBeInTheDocument();
    }
  });

  it('DEV=true 时渲染 390/1024/1440/1895 四个带标签视口预设', () => {
    vi.stubEnv('DEV', true);
    renderLab();
    for (const label of ['390', '1024', '1440', '1895']) {
      expect(
        screen.getByRole('button', { name: label }),
        `缺少视口预设 ${label}`,
      ).toBeInTheDocument();
    }
  });

  it('明暗切换写 documentElement.dataset.theme，卸载后还原挂载前的值', async () => {
    vi.stubEnv('DEV', true);
    document.documentElement.dataset.theme = 'light';
    const user = userEvent.setup();
    const lab = renderLab();

    await user.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: '浅色' }));
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('button', { name: '深色' }));
    lab.unmount();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('DEV=false 时不渲染任何分区或预设', () => {
    vi.stubEnv('DEV', false);
    const { container } = renderLab();
    expect(container.querySelector('section')).toBeNull();
    for (const name of ['Button', 'Field', 'Modal', 'Menu', 'Feedback']) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    for (const label of ['390', '1024', '1440', '1895']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});
