import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MomentResponse } from '@moment/dto';

export interface ComposeRequest {
  chainId?: string;
  edit?: MomentResponse;
}

interface ComposeContextValue {
  request: ComposeRequest | null;
  openCompose: (req?: ComposeRequest) => void;
  closeCompose: () => void;
  /** 发布成功的 moment id：时间线「从链节长出来」微动效用（spec §1.6）。真实 state——Timeline 已挂载，
      发布发生在其生命周期内，必须是响应式值渲染期直读，不能用 ref/首渲染消费 */
  lastCreatedId: string | null;
  markCreated: (id: string) => void;
}

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ComposeRequest | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const openCompose = useCallback((req?: ComposeRequest) => {
    // 下一次打开发布面板即自清，生长动画只作用于刚发布的那张卡（显式动作，不用 setTimeout/effect）
    setLastCreatedId(null);
    setRequest(req ?? {});
  }, []);
  const closeCompose = useCallback(() => setRequest(null), []);
  const markCreated = useCallback((id: string) => setLastCreatedId(id), []);
  const value = useMemo(
    () => ({ request, openCompose, closeCompose, lastCreatedId, markCreated }),
    [request, openCompose, closeCompose, lastCreatedId, markCreated],
  );
  return <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompose(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error('useCompose must be used within ComposeProvider');
  return ctx;
}
