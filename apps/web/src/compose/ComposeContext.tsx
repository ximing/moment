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
}

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ComposeRequest | null>(null);
  const openCompose = useCallback((req?: ComposeRequest) => setRequest(req ?? {}), []);
  const closeCompose = useCallback(() => setRequest(null), []);
  const value = useMemo(() => ({ request, openCompose, closeCompose }), [request, openCompose, closeCompose]);
  return <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompose(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error('useCompose must be used within ComposeProvider');
  return ctx;
}
