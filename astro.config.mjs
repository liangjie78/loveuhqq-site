import { defineConfig } from 'astro/config';

/**
 * Fontsource lists a woff fallback beside every woff2 slice. Every browser
 * this site supports reads woff2, so drop the fallback before Vite resolves
 * the URLs; otherwise each slice is emitted twice.
 */
const woff2Only = {
  name: 'fontsource-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('@fontsource') || !id.endsWith('.css')) return;
    return code.replace(/,\s*url\([^)]+\.woff\)\s*format\('woff'\)/g, '');
  },
};

export default defineConfig({
  site: 'https://loveuhqq.x23.shop',
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  vite: {
    plugins: [woff2Only],
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
