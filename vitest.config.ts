import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    // Prevent module cache sharing between tests (important for singleton modules)
    isolate: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
});
