import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import 'streamdown/styles.css';
import { App } from './app';
import { initializeDocumentTheme } from './lib/theme';
import './styles.css';
import './tailwind.css';

initializeDocumentTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
