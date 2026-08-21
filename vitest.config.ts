import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@cadence/domain': new URL('./packages/domain/src/index.ts', import.meta.url).pathname,
      '@cadence/rules-engine': new URL('./packages/rules-engine/src/index.ts', import.meta.url)
        .pathname,
      '@cadence/audit': new URL('./packages/audit/src/index.ts', import.meta.url).pathname,
      '@cadence/fixtures': new URL('./packages/fixtures/src/index.ts', import.meta.url).pathname,
      '@cadence/resolver': new URL('./packages/resolver/src/index.ts', import.meta.url).pathname,
    },
  },
});
