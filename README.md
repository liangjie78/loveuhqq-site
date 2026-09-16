<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="loveuhqq：Astro 静态占位首页，手动部署到 Cloudflare Worker">
</p>

# loveuhqq

一个仍在慢慢搭建中的独立个人网站。目前只有中文占位首页，尚未开始正式内容设计。

## 当前状态

- 正式网址：[loveuhqq.x23.shop](https://loveuhqq.x23.shop)
- 唯一正式源码：[liangjie78/loveuhqq-site](https://github.com/liangjie78/loveuhqq-site)（Private）
- 页面状态：只保留站名、两句中文说明和系统深色模式适配，没有照片、纪念日、背景音乐或第三方素材；页面文案以源码为准。
- 技术边界：Astro + TypeScript + 普通 CSS，默认静态生成；没有后端、数据库或 UI 框架。

## 本地开发

使用满足 `package.json` 引擎要求的 Node.js 和 npm。依赖版本由 `package-lock.json` 固定：

```sh
npm ci
npm run dev
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
| [`docs/DESIGN.md`](docs/DESIGN.md) | 当前占位页的视觉方向 |

## 生产状态说明

基础占位页已经完成生产部署；首页、CSS、favicon 和权威 DNS 均曾完成 HTTP/线上核验。当前仓库只描述已存在的占位内容，不把后续正式设计或自动部署写成已完成能力。
