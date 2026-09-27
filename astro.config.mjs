import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://loveuhqq.x23.shop',
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  vite: {
    build: {
      assetsInlineLimit: 4096, // 4KB以下的资源内联
      cssCodeSplit: true,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true, // 生产环境移除console
          drop_debugger: true,
        },
      },
    },
  },
});

