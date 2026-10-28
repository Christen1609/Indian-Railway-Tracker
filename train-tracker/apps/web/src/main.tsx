import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { assert } from '@train-tracker/core/types';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
assert(root !== null, 'a #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
