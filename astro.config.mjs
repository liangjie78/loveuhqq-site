import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [react()],
  site: 'https://loveuhqq.x23.shop',
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  vite: {
    plugins: [tailwindcss()],
    // Pin the project tsconfig: auto-discovery can climb into an enclosing checkout
    // (e.g. a git worktree nested in the main repo) and fail on its unresolved extends.
    tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
    build: {
      // Fonts stay separate files: the CSP only allows fonts from 'self'.
      assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
      cssCodeSplit: true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
    },
  },
});
