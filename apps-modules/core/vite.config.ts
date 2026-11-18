// Vitest project for the pure engine. ARCHITECTURE.md §3: the engine keeps 100 % branch coverage.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      thresholds: { branches: 100, lines: 100, functions: 100, statements: 100 },
    },
  },
});
