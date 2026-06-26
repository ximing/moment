import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 每个用例结束后卸载渲染树，保持用例互不污染。
afterEach(() => {
  cleanup();
});
