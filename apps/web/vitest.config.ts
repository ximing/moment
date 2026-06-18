import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 与 vite.config.ts 同一约束：Expo 钉死 react@19.1.0，hoisted 布局下根
// node_modules/react 是 19.1.0；测试也必须让组件代码与 react-dom 共用
// apps/web 的 react 19.2.x，否则源码的 hooks 与 react-dom dispatcher
// 各绑一份 React → Invalid hook call。
const require = createRequire(import.meta.url);
const reactRoot = path.dirname(require.resolve('react/package.json'));
const reactDomRoot = path.dirname(require.resolve('react-dom/package.json'));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      react: reactRoot,
      'react-dom': reactDomRoot,
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 组件契约测试就近放在源码旁；支持 `pnpm test -- Button.test.tsx` 聚焦执行
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
