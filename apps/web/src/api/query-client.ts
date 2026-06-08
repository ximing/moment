import { QueryClient } from '@tanstack/react-query';

/** 过渡期单例：AuthService 与迁移中的组件需要 invalidate RQ 缓存（main.tsx 不再是唯一持有者）。
 *  Task 14 随 @tanstack/react-query 一起删除。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});
