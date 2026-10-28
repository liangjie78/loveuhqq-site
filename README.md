<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="loveuhqq 项目标识：Astro 静态纪念站，手动部署到 Cloudflare Worker">
</p>

# loveuhqq

一本写给何青青的纸上手账。

## 当前源码

- 正式网址：[loveuhqq.x23.shop](https://loveuhqq.x23.shop)
- 唯一正式源码：[liangjie78/loveuhqq-site](https://github.com/liangjie78/loveuhqq-site)（Private）
- 页面结构：封面、日子、照片、心里话、往后、共同回忆册入口、信、页脚，自然连续滚动；另有相册页 `/photos/` 和 404 页（`dist/404.html` 由 `wrangler.jsonc` 的 `not_found_handling: "404-page"` 送出，缺这项时 Workers 只回空 404）。
- 视觉与交互：「余温」暖光极简——暖象牙底与单一胭脂红、可变字重宋体与 Instrument Serif 数字、WebGL 暖色光晕与胶片颗粒；光点年历（逐一点亮、鱼眼悬停、方向键与轻扫、往年回看）、逐字点亮的心里话、以光打开的门禁、蜡封拆信、相册灯箱放大、深色「夜灯」模式；全部动效在减少动态效果偏好下关闭。详见 [设计说明](docs/DESIGN.md)。
- 纪念时间：从 2026-07-01 开始，当天算第 1 天，按北京时间自动更新；JavaScript 不可用时保留文案和起始日期。
- 下一纪念日：第 100 天之后转向下一周年，纪念日当天显示“今天”，跨日和返回页面时自动刷新。
- 内容状态：相册是登录后才能看到的真实照片（保存在 Workers KV，经 Worker 鉴权后送出）；值得标记的日子（`src/data/moments.ts`）已登记 3 个用户确认的日子。百日信须解锁共同手账且到达北京时间 2026-10-08 00:00 才能阅读；正式内容通过私密 KV 上传，不进入仓库，尚未上传时沿用已确认初稿。百日信保持只读，新的未来信件在 `/memories/` 内撰写与封存；照片可在解锁后的相册页「贴一张」，也可用本机 prepare/upload 脚本批量维护。
- 技术边界：Astro + TypeScript + 普通 CSS，页面静态生成，交互为原生 TypeScript 控制器（`src/app/`），动效用 `motion` 与 `lenis`，不引入 UI 框架；Cloudflare Worker 提供登录、共享手账与回忆册接口，D1 保存记录和会话，KV 保存私密照片与短音频，SQLite Durable Object 协调实时桌面。
- 共同手账：访客浏览展示内容，解锁后两个人可以查看、编辑同一份备注和清单。云端按单条记录保存并检测编辑冲突，页面可见时每 10 秒同步；登录后可在不同设备继续使用。

界面截图：[桌面封面](docs/previews/yuwen-desktop-light-cover.webp) · [深色封面](docs/previews/yuwen-desktop-dark-cover.webp) · [光点年历](docs/previews/yuwen-desktop-light-days.webp) · [照片](docs/previews/yuwen-desktop-light-photos.webp) · [回忆册](docs/previews/yuwen-desktop-light-memories.webp) · [手机封面](docs/previews/yuwen-phone-light-cover.webp) · [门禁](docs/previews/yuwen-desktop-gate.webp)。截图使用本地示例数据，日期计数表示截图时的状态；顶部项目标识插画不作为当前页面截图。上述内容描述当前源码，不能据此判断正式网址已更新。

共同回忆册入口为 `/memories/`（首页在“往后”与“信”之间有入口，目录项可直达各分区）：连接故事、双人版本、未来信件、愿望、声音、地点备忘、浏览器放映和实时桌面。地点目前只保留名称、年份与关联记录，坐标可留空，不加载地图。源码与隔离预览的实施状态、规则和验收记录见 [共同回忆册路线图](docs/product/ROADMAP-shared-memory-book.md)；正式站生效仍需单独合并、迁移及部署。

## 本地开发

使用满足 `package.json` 引擎要求的 Node.js 和 npm。依赖版本由 `package-lock.json` 固定：

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

新增可见文案后运行 `npm run subset:font` 重新生成宋体子集并连同字符清单一起提交，否则 `tests/font-subset.test.mjs` 会失败、页面会回退到系统字体。

`npm test` 运行单元测试（日期、日记同步与合并、照片、桌面协议、门禁问题、导出、字体子集隐私、运维脚本）和真实 workerd（D1/KV/Durable Object）上的接口测试；`npm run test:build` 在构建后检查产物（文案、外部资源、分享预览不含门禁答案、私密信件不在静态文件中）；`npm run test:e2e` 用 Playwright 在隔离的本地 Worker 上跑桌面与手机两套端到端流程（本地使用系统 Chrome，CI 安装 Chromium）。CI 依次执行类型检查、`npm test`、构建、`test:build` 与端到端测试。

构建输出在 `dist/`，不提交到 Git。当前页面入口是 [`src/pages/index.astro`](src/pages/index.astro)，样式入口是 [`src/styles/global.css`](src/styles/global.css)。

相册照片不进仓库：用 `npm run photos:prepare -- <照片文件夹> --featured "标题,标题,标题"` 在本机生成去除 EXIF 的 WebP 和清单（输出到已忽略的 `.private-photos/`，文件名即标题），再用 `npm run photos:upload:preview` 或 `photos:upload:production` 上传到对应的 KV 命名空间，详见 [部署说明](docs/DEPLOYMENT.md#私密相册)。日期仍只修改 `src/lib/anniversary.ts` 中的来源，不在页面写死天数。

百日信正式正文放在已忽略的 `.private-letter/hundred-day.json`，运行 `npm run letter:check` 检查格式；得到当前任务生产上传授权后用 `npm run letter:upload:production` 写入私密 KV。真实信件不上传预览环境，也不写入源码、测试或 PR；详见 [私密百日信](docs/DEPLOYMENT.md#私密百日信)。

## 部署路径

正式站由 GitHub Actions 自动部署：PR 合并进 `main` 后，`CI` 工作流通过即触发 [`deploy-loveuhqq.yml`](.github/workflows/deploy-loveuhqq.yml)，用同一提交运行 `npm ci`、生产绑定检查和 `npm run build`，再用项目级 Wrangler 把 `dist/` 上传到独立 Worker `loveuhqq-site`，并绑定正式 Custom Domain：

```text
GitHub main → npm run build → dist/ → Cloudflare Worker → loveuhqq.x23.shop
```

**合并 PR 即上线**：合并前先在临时预览站验收。也可以在 Actions 页面手动运行该工作流重新部署；本地仍可用 `npm run deploy` 手动部署，需当前任务明确授权。GitHub 是唯一正式源码，生产构建来自本仓库相同提交，不使用其他仓库或 Sites 托管副本。

## 临时预览

可见 UI 改动完成后，运行 `npm run deploy:preview`，从当前分支构建并更新独立 Worker `loveuhqq-site-preview`。验收地址是 [临时预览站](https://loveuhqq-site-preview.1756127916.workers.dev/)；每次更新后需实际检查首页、受影响页面和资源，并把链接与截图发给用户。此地址公开可访问，始终显示最近一次手动上传的预览版本，不会自动跟随 Git 提交，也不影响正式域名。

预览配置位于 `wrangler.preview.jsonc`，只有 `workers.dev` 地址，没有正式站点的 Custom Domain 路由。共享手账使用独立的 `loveuhqq-notebook-preview` 数据库，不能导入真实私人记录用于公开验收。通过 `npm run password:preview` 在交互式终端设置预览编辑密码，输入不会显示，也不需要写进聊天或源码。

生产操作、回滚、DNS 边界和已有验证证据见 [部署说明](docs/DEPLOYMENT.md)，视觉约束见 [设计说明](docs/DESIGN.md)。生产部署、Cloudflare 和 DNS 修改都需要当前任务的明确授权。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| [`astro.config.mjs`](astro.config.mjs) | Astro 构建配置 |
| [`wrangler.jsonc`](wrangler.jsonc) | Worker、静态资源目录和 Custom Domain 配置 |
| [`wrangler.preview.jsonc`](wrangler.preview.jsonc) | 独立预览 Worker 配置，不绑定正式域名 |
| [`public/favicon.svg`](public/favicon.svg) | 页面 favicon |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 发布、核验和回滚边界 |
| [`src/lib/anniversary.ts`](src/lib/anniversary.ts) | 起始日期、北京时间天数与跨日计算 |
| [`scripts/subset-font.mjs`](scripts/subset-font.mjs) | 按站点用字生成思源宋体子集（`npm run subset:font`） |
| [`docs/DESIGN.md`](docs/DESIGN.md) | 「余温」的视觉、动效、布局与交互约定 |

## 生产状态说明

合并 PR 到 `main` 且 CI 通过后，正式网站会自动更新。正式网站版本须以对应的「Deploy loveuhqq」运行记录及域名、正文、资源核验为准，源码和截图本身不构成生产已更新的证明。既往 V2 工作记录见 [PR #6](https://github.com/liangjie78/loveuhqq-site/pull/6)，已有部署证据保留在 [部署说明](docs/DEPLOYMENT.md) 中。


### 当前身份选择方式

共同门禁通过后进入首页，上方只提供「男生」「女生」两项身份选择，不再注册称呼或填写个人口令；选择会沿用到回忆册与共同桌面，可随时切换。两份署名段落、共同揭晓、未来信件的收件人与日期规则保留，已有记录不迁移、不删除。身份只区分署名，不提供双方之间的口令隔离；任何通过共同门禁的人都可以切换查看相应身份的内容。此前独立个人口令的描述由本约定替代。
