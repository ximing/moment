import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 沿用 aimo：@ 别名 + dev 代理 /api → server（同源部署，client.baseUrl 为 ''）
// Expo app 钉死 react@19.1.0，hoisted 布局下根 node_modules/react 占住 19.1.0，
// web 的 19.2.x 变成第二份物理副本（apps/web/node_modules/react ≠ .pnpm/react@19.2.8）。
// 不强制同一份时，源码的 useState 与 react-dom 的 dispatcher 各绑一份 React → Invalid hook call。
const reactRoot = path.resolve(__dirname, './node_modules/react');
const reactDomRoot = path.resolve(__dirname, './node_modules/react-dom');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: reactRoot,
      'react-dom': reactDomRoot,
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
