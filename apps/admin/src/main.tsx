// Side-effect import: configures Zod before any schema module is evaluated.
import './zod-config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('NEXORA admin: #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
