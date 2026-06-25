import type { ReactNode } from 'react';

/** 登录 / 注册共享的居中面板：只承担布局与 token 消费（规范迁移 plan Task 13）。 */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-surface-lg bg-surface p-8">
        <p className="text-center font-display text-3xl">
          时<span className="text-action">刻</span>
        </p>
        {/* 标题含「登录/加入」等子集外字形，不用 font-display，走系统黑体 */}
        <h1 className="mb-6 mt-2 text-center text-lg font-medium">{title}</h1>
        {children}
      </div>
    </div>
  );
}
