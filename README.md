<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="loveuhqq：温柔信笺纪念页，Astro 静态生成并手动部署到 Cloudflare Worker">
</p>

# loveuhqq

一张写给何青青的温柔信笺，把平凡的日子，慢慢写成我们的故事。

## 当前状态

- 正式网址：[loveuhqq.x23.shop](https://loveuhqq.x23.shop)
- 唯一正式源码：[liangjie78/loveuhqq-site](https://github.com/liangjie78/loveuhqq-site)（Private）
- 页面状态：暖白纸纹、宋体标题、小信封与一次性淡入，使用固定浅色；支持手机排版和减少动态效果偏好。
- 纪念时间：从 2026-07-01 开始，当天算第 1 天，按北京时间自动更新；JavaScript 不可用时保留文案和起始日期。
- 技术边界：Astro + TypeScript + 普通 CSS，默认静态生成；没有后端、数据库或 UI 框架。

界面截图：[桌面](docs/previews/landing-desktop.png) · [手机](docs/previews/landing-mobile.png)。截图固定在 2026-09-22，显示相恋第 84 天；实际页面按访问当天更新。

## 本地开发

使用满足 `package.json` 引擎要求的 Node.js 和 npm。依赖版本由 `package-lock.json` 固定：

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

构建输出在 `dist/`，不提交到 Git。当前页面入口是 [`src/pages/index.astro`](src/pages/index.astro)，样式入口是 [`src/styles/global.css`](src/styles/global.css)。

## 部署路径

当前采用手动项目级 Wrangler 部署：经用户授权后，从已合并的 `main` 干净源码运行 `npm ci` 和 `npm run deploy`。`npm run deploy` 会先构建，再把 `dist/` 上传到独立 Worker `loveuhqq-site`，并绑定正式 Custom Domain：

```text
GitHub main → npm run build → dist/ → Cloudflare Worker → loveuhqq.x23.shop
```

GitHub 自动部署尚未配置；没有绕过权限或创建额外凭据。GitHub 是唯一正式源码，生产构建来自本仓库相同提交，不使用其他仓库或 Sites 托管副本。

生产操作、回滚、DNS 边界和已有验证证据见 [部署说明](docs/DEPLOYMENT.md)，视觉约束见 [设计说明](docs/DESIGN.md)。生产部署、Cloudflare 和 DNS 修改都需要当前任务的明确授权。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| [`astro.config.mjs`](astro.config.mjs) | Astro 构建配置 |
| [`wrangler.jsonc`](wrangler.jsonc) | Worker、静态资源目录和 Custom Domain 配置 |
| [`public/favicon.svg`](public/favicon.svg) | 页面 favicon |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 发布、核验和回滚边界 |
| [`src/lib/anniversary.ts`](src/lib/anniversary.ts) | 起始日期、北京时间天数与跨日计算 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | 信笺首页的视觉与行为约定 |

## 生产状态说明

温柔信笺首页已于 2026-09-22 完成生产部署。首页、CSS 与 favicon 均返回 HTTP 200，线上静态资源与本地构建一致；源码提交、生产版本和验收结果见 [部署说明](docs/DEPLOYMENT.md)。后续仍采用手动发布，合并 PR 不会自动更新正式网站。
