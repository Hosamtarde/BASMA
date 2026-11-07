import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import { App } from './app/App';
import { createQueryClient } from './app/query-client';
import { createAppRouter } from './app/router';
import { initI18n } from './i18n/i18n';

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  await initI18n();
  createRoot(root).render(
    <StrictMode>
      <App queryClient={createQueryClient()} router={createAppRouter()} />
    </StrictMode>,
  );
}

void start();
