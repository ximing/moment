import type { ReactNode } from 'react';

export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 shadow-card">
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
