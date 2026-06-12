import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    css: true,
  },
});
