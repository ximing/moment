import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import svgr from 'vite-plugin-svgr';
import path from 'node:path';
import { createRequire } from 'node:module';

// 沿用 aimo：@ 别名 + dev 代理 /api → server（同源部署，client.baseUrl 为 ''）
// Expo app 钉死 react@19.1.0，hoisted 布局下根 node_modules/react 占住 19.1.0，
// web 的 19.2.x 变成第二份物理副本（apps/web/node_modules/react ≠ .pnpm/react@19.2.8）。
// 不强制同一份时，源码的 useState 与 react-dom 的 dispatcher 各绑一份 React → Invalid hook call。
const reactRoot = path.resolve(__dirname, './node_modules/react');
// react-dom 只允许根 node_modules 一份（Expo 钉死 react，不钉 react-dom，根即 19.2.8）。
// apps/web/node_modules/react-dom 不存在，不能再用 __dirname 相对路径；用 createRequire
// 从本配置位置走 Node 解析，hoisted/isolated 布局下都能落到真实安装根。
const reactDomRoot = path.dirname(
  createRequire(import.meta.url).resolve('react-dom/package.json'),
);
// emojibase-data 在 hoisted 布局下落在根 node_modules，不在 apps/web/node_modules；
// 用 createRequire 解析真实安装路径，再转回相对路径——vite-plugin-static-copy 会把
// 绝对 src 的目录结构镜像进 dest（path.join(absolute) 会产出 vendor/emojibase/zh/node_modules/...）。
const emojibaseRoot = path.relative(
  __dirname,
  path.dirname(createRequire(import.meta.url).resolve('emojibase-data/package.json')),
);

export default defineConfig({
  plugins: [
    react(),
    // @moment/icons 画稿 svg → React 组件（?react 后缀导入），AppIcon 消费
    svgr(),
    // 离线 Emoji 数据（spec §7.2）：Emojibase 中文数据与许可证随构建产物同源部署，
    // frimousse 运行时只请求 /vendor/emojibase/**，不触碰公共 CDN。
    viteStaticCopy({
      // 插件永远保留 src 的目录前缀（README：Directory structure is always preserved）；
      // hoisted 布局下 src 相对根含 ../../node_modules/...，落盘会出现
      // vendor/.../node_modules/emojibase-data/... 嵌套。rename.stripBase 按段剥掉
      // 目录前缀（dirClean 已去掉 ../ 段，只剩 node_modules/emojibase-data[/zh]）。
      targets: [
        {
          src: path.join(emojibaseRoot, 'zh/data.json'),
          dest: 'vendor/emojibase/zh',
          rename: { stripBase: 3 },
        },
        {
          src: path.join(emojibaseRoot, 'zh/messages.json'),
          dest: 'vendor/emojibase/zh',
          rename: { stripBase: 3 },
        },
        {
          src: path.join(emojibaseRoot, 'LICENSE'),
          dest: 'vendor/emojibase',
          rename: { stripBase: 2 },
        },
      ],
    }),
  ],
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
