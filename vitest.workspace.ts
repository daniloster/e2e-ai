// Vitest 5 removed standalone workspace files and `--workspace`, so this file keeps the
// SPEC's name but is a regular config loaded with `--config` (see WP-01 T-3).
import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Vitest refuses to start on a missing project path or an empty project list, and
// packages/* and apps/web are scaffolded by later WPs.
const projects = [
  ...(existsSync('packages') && readdirSync('packages').length > 0 ? ['packages/*'] : []),
  ...(existsSync('apps-modules') && readdirSync('apps-modules').length > 0 ? ['apps-modules/*'] : []),
  ...(existsSync('apps/web') ? ['apps/web'] : []),
  ...(existsSync('tools') && readdirSync('tools').length > 0 ? ['tools/*'] : []),
];

export default defineConfig({
  test: projects.length > 0 ? { projects } : { include: [] },
});
