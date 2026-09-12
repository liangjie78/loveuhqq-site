# loveuhqq

向女朋友表达爱意的独立个人网站。目前只有中文占位首页，尚未开始正式内容设计。

- 正式网址：https://loveuhqq.x23.shop
- 唯一正式源码：https://github.com/liangjie78/loveuhqq-site （Private）
- 技术栈：Astro + TypeScript + 普通 CSS，默认静态生成，无后端、数据库或 UI 框架。

## 本地开发

使用满足 package.json 引擎要求的 Node.js 和 npm。先检查当前环境，再运行：

```sh
npm ci
npm run dev
npm run build
npm run preview
```

依赖为项目级，版本由 package-lock.json 固定。构建输出在 `dist/`，不提交到 Git。

## 部署

当前采用手动项目级 Wrangler 部署：经用户授权后，从已合并的 `main` 干净源码运行 `npm ci`、`npm run deploy`。构建后上传 `dist` 至独立 Worker `loveuhqq-site`，绑定正式 Custom Domain。

GitHub 自动部署尚未配置：当前 CLI 登录不能读取 GitHub App 安装列表（HTTP 403），未绕过权限或创建额外凭据。GitHub 是唯一正式源码；生产构建来自本仓库相同提交，不使用其他仓库或 Sites 托管副本。

后续使用开发分支 → PR → 用户手动 Merge → 授权部署；不直接 push 默认分支，不自动 merge。首次允许一次初始基线 push。

当前状态：基础占位页已完成首次生产部署；首页、CSS、favicon 均验证 HTTP 200，权威 DNS 解析正常。浏览器连接不可用，手机/桌面视觉验收尚未完成；响应式及深色样式已实现。操作、验证和回滚见 [部署说明](docs/DEPLOYMENT.md)，视觉方向见 [设计说明](docs/DESIGN.md)。
