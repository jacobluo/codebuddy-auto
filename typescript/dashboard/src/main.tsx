import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app.js';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Dashboard root element was not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
