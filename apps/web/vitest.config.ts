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
    // 修复双 React 实例：lockfile 里存在三份 react@19.2.8 物理副本
    // （apps/web/node_modules、react-dom/node_modules、
    // @testing-library/react/node_modules）。react-dom 与 RTL 都是 CJS，
    // 无论 externalize（纯 Node 解析）还是 inline（module evaluator 给 CJS
    // 注入的是 createRequire(模块自身路径)，见 vitest module-evaluator），
    // 其内部 require('react') 都绕开 alias，命中各自嵌套副本 →
    // 与源码经 alias 命中的 apps/web 副本不是同一份 → act 队列错位，
    // RTL render 永不 flush（渲染为空）。
    //
    // 解法：开启 client 环境的依赖预打包（jsdom 测试跑在 client
    // environment）。esbuild 把 react-dom 与 @testing-library/react 打成
    // ESM chunk，react 被改写为 vite:cjs-external-facade（顶层
    // import 'react'）→ 该 import 回到 runner 解析链，吃上面的 alias，
    // 与源码、JSX runtime 统一落到 apps/web 那份 react，进程内只剩一个
    // React 实例。嵌套副本从此不再被加载，安装布局变化也不影响结论。
    // react-aria-components 同理：它虽是 ESM，但 externalize 时 Node 会
    // 命中其嵌套的 react 副本（Modal 等 hooks 报错），一并交给预打包。
    // react-router@7 同理：node_modules/react-router/node_modules/react@19.2.8
    // 与 apps/web 的 react 同版本但不同物理路径，externalize 时其内部
    // react 命中该嵌套副本 → 真实 App 首帧 useRef 读 null dispatcher。
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: [
            'react-dom',
            'react-dom/client',
            '@testing-library/react',
            'react-aria-components',
            'react-router',
          ],
        },
      },
    },
  },
});
