import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://loveuhqq.x23.shop',
  output: 'static',
  build: {
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});

