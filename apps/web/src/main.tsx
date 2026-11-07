import { PRODUCT_NAME } from '@app/shared';
import './design/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (root) {
  document.title = PRODUCT_NAME;
  createRoot(root).render(
    <StrictMode>
      <main>{PRODUCT_NAME}</main>
    </StrictMode>,
  );
}
