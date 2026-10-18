import { defineConfig } from 'vitest/config';

// No framework plugin needed: TypeScript's JSX settings (tsconfig.json) point
// JSX at Preact, and Vite's built-in transform honours them.
export default defineConfig({
  // Relative asset URLs so the build works at any path, e.g. a GitHub Pages
  // project site (https://<user>.github.io/polaris/). Routing uses URL hashes,
  // so no server-side rewrites are needed.
  base: './',
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
