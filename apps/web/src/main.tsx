import { PRODUCT_NAME } from '@app/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import { initI18n } from './i18n/i18n';

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  await initI18n();
  document.title = PRODUCT_NAME;
  createRoot(root).render(
    <StrictMode>
      <main>{PRODUCT_NAME}</main>
    </StrictMode>,
  );
}

void start();
