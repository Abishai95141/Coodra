import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests mutate a shared database; run them serially.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
