import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    coverage: {
      include: ['packages/core/src/**'],
      thresholds: { lines: 90 },
    },
  },
});
