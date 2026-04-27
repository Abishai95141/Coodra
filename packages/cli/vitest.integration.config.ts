import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
