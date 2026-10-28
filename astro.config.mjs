import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://loveuhqq.x23.shop',
  output: 'static',
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  vite: {
    // Pin the project tsconfig: auto-discovery can climb into an enclosing checkout
    // (e.g. a git worktree nested in the main repo) and fail on its unresolved extends.
    tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
    // `npm run dev` only: forward the API to a local `wrangler dev` (port 8787) so the
    // site can be exercised end to end. The Host header is passed through unchanged,
    // which keeps the Worker's same-origin check satisfied.
    server: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:8787', ws: true },
      },
    },
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
