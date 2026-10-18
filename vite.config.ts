import { defineConfig } from 'vitest/config';

// No framework plugin needed: TypeScript's JSX settings (tsconfig.json) point
// JSX at Preact, and Vite's built-in transform honours them.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
