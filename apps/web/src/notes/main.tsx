import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { NotesApp } from './NotesApp';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <NotesApp />
    </StrictMode>,
  );
}
