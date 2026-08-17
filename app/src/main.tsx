import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App';
import i18n from '@/i18n';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found in index.html');
}

// Translations are bundled, so `i18n` is already initialised by the time this
// runs — nothing suspends. The boundary is the contract React expects of an
// i18next tree, and the guard if a namespace is ever lazy-loaded.
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <React.Suspense fallback={null}>
        <App />
      </React.Suspense>
    </I18nextProvider>
  </React.StrictMode>,
);
