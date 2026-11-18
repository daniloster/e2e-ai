// The built HTML entries: one template per site page (the client entry each one loads differs).
import { resolve } from 'node:path';

/** Built HTML entries: published path without ".html" -> source file, relative to apps/web. */
export const HTML_ENTRIES: Readonly<Record<string, string>> = Object.freeze({
  index: 'index.html',
  faq: 'faq.html',
  contact: 'contact.html',
  support: 'support.html',
  'your-data': 'your-data.html',
  get: 'get.html',
  s: 's.html',
});

/** HTML_ENTRIES keys that are site templates: sitePages serves them in dev and fills them at build. */
export const SITE_TEMPLATE_KEYS: readonly string[] = Object.freeze(Object.keys(HTML_ENTRIES));

/** Client-only app pages (not site templates): the Pocket Notes app the e2e tool is spiked against. */
export const APP_ENTRIES: Readonly<Record<string, string>> = Object.freeze({ app: 'app.html' });

// Vite build input: key -> absolute source path under `root` (apps/web).
export function rollupInput(root: string): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, file] of Object.entries({ ...HTML_ENTRIES, ...APP_ENTRIES })) input[key] = resolve(root, file);
  return input;
}
