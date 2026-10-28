import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@application': path.resolve(__dirname, 'src/application'),
      '@infrastructure': path.resolve(__dirname, 'src/infrastructure'),
      '@electron': path.resolve(__dirname, 'electron')
    }
  }
});

