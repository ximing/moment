import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { RSRoot, register } from '@rabjs/react';
import { App } from './App';
import { queryClient } from './api/query-client';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { ComposeSessionService } from './services/compose-session.service';
import { ChainListService } from './services/chain-list.service';
import { NotificationService } from './services/notification.service';
import './index.css';

// AuthService 必须排首：ChainListService / NotificationService 构造里 resolve 它（Task 7 起）
register(AuthService);
register(ThemeService);
register(ComposeSessionService);
register(ChainListService);
register(NotificationService);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RSRoot>
          <App />
        </RSRoot>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
