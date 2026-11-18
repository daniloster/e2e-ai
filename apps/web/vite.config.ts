import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

import webPackage from './package.json' with { type: 'json' };
import { firebaseFromCdn } from './vite/firebaseFromCdn.ts';
import { rollupInput } from './vite/htmlEntries.ts';
import { sitePages } from './vite/sitePages.ts';

export default defineConfig({
  plugins: [
    react(),
    firebaseFromCdn(),
    // Site pages: prerendered into dist/ at build, rendered per request in dev.
    ...sitePages(),
  ],
  define: { __APP_VERSION__: JSON.stringify(webPackage.version) },
  build: {
    target: ['es2020', 'chrome87', 'safari14', 'firefox78'],
    sourcemap: true,
    // One input per published HTML page (each a site template filled per locale).
    rolldownOptions: { input: rollupInput(fileURLToPath(new URL('.', import.meta.url))) },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Raw CSS text for the stylesheet checks (theme.test.ts); other CSS stays unprocessed.
    css: { include: [/\.css\?raw$/] },
  },
});
