# 部署说明

## 唯一来源与拓扑

`GitHub liangjie78/loveuhqq-site 的 main → 同提交本地构建 → dist → Cloudflare Worker Static Assets loveuhqq-site → loveuhqq.x23.shop`

当前为手动 Wrangler 部署，Cloudflare 没有配置 Git 自动构建来源。没有第二个源码仓库。GitHub 自动部署尚未配置，当前 GitHub CLI 登录读取 App installations 返回 403；不绕过权限。

## 目标

- Worker：`loveuhqq-site`
- Custom Domain：`loveuhqq.x23.shop`
- Zone：`x23.shop`
- 账户：由 `wrangler.jsonc` 中 account_id 明确指定，部署前用项目级 `wrangler whoami` 核对。
- 页面产物：`dist/`；`worker/index.ts` 处理 `/api/*`，其余请求仍由 Static Assets 提供，无需 Astro 服务端 adapter。
- 数据：生产使用单独的 `loveuhqq-notebook` D1；预览使用 `loveuhqq-notebook-preview`，禁止共用数据库。
- 编辑权限：Worker secret `EDITOR_PASSWORD_HASH` 保存带随机盐的 PBKDF2 验证值，随机会话的哈希保存在 D1；浏览器 Cookie 使用 HttpOnly、Secure、SameSite=Strict。改密使旧会话失效。
- DNS 与 HTTPS 由 Cloudflare Custom Domain 管理；不手工替换其他 DNS 记录。

## 正常发布

1. 开发按仓库流程使用 feature/fix/chore 分支或 worktree；完成必要验证后，可自主 commit、push 和创建/更新 PR。默认分支保持 PR-first，不直接 push main；PR 合并、历史改写、tag、force push 与生产部署需明确授权。
2. 取得本次生产部署授权，核验干净 main 与 origin/main 的提交一致。确认账号、目标 Worker、Custom Domain 无异常；已有其他资源占用目标时停止报告。
3. 根据当前环境满足依赖的 Node.js 引擎要求，运行 `npm ci`、`npm run build`，检查 dist 中 HTML、CSS 和 favicon。
4. 首次启用云端手账时，先按下节配置独立生产数据库和密码。运行项目级 `npm run deploy`（检查生产数据库绑定、重新 build 后 wrangler deploy），记录返回的版本 ID。只发布这个 Worker。
5. 核验 Custom Domain 指向正确 Worker，查询 Cloudflare 权威 DNS，并访问 HTTPS：首页须为 200 且正文与本次发布的源码一致，实际 CSS/favicon 必须为 200；不可出现 work1 或 x23-personal-site 页面。

## 预览验收

可见 UI 改动先用 `npm run deploy:preview` 从当前分支构建并手动更新 `loveuhqq-site-preview`，地址为 [临时预览站](https://loveuhqq-site-preview.1756127916.workers.dev/)。它使用 `wrangler.preview.jsonc`，仅绑定 `workers.dev`，与正式 Worker 和 Custom Domain 分离。每次交付需核验公网首页、受影响页面和实际资源，提供网址及截图；预览网址始终显示最后一次上传的内容，不能仅凭 PR 或构建成功声称网址已更新。预览站公开可访问，提交正式发布仍按上节的授权和 `main` 流程执行。

共享手账预览使用独立 D1，首次执行 `npx wrangler d1 migrations apply DB --remote --config wrangler.preview.jsonc`，然后在交互式终端运行 `npm run password:preview` 设置密码。API 与私密正文禁止缓存；未知 `/api/*` 返回 JSON 404，不能落入静态页面。预览仅使用合成测试内容，至少验收两次独立登录、同步、同时修改冲突、访客拒绝、退出撤销和断网草稿保留。

## 私密相册

照片字节保存在 Workers KV，标题、日期、精选和清单版本保存在 D1，不进 Git、不进静态资源。KV 生产命名空间 `loveuhqq-photos`（`f2758069198e4a90896513225121d661`），预览 `loveuhqq-photos-preview`（`b74bb16196a048cc82b2c1c0feae90e9`），均以 `PHOTOS` 绑定；KV 没有公网地址，只能经 Worker 读取。账号未开通 R2，选用 Workers 自带的 KV（免费额度 1GB、每日 10 万次读取，单值上限 25MB）。Worker 的 `GET /api/photos`（清单）和 `GET /api/photos/<id>/<thumb|large>`（图片）都要求有效会话，图片以 `private, no-store` 返回；没有清单时相册为空，绑定缺失或清单损坏时返回 503。

1. 本机处理（批量/纠错）：`npm run photos:prepare -- <照片文件夹> --featured "标题,标题,标题"`。文件名（去扩展名）是标题，EXIF 日期用于排序和显示；输出 800×1000 以内的缩略图与 1800px 以内的大图，全部去除 EXIF/GPS，写入 `.private-photos/`（已忽略）。照片 id 取原图哈希，换图即换地址。
2. 命名空间已于 2026-10-05 经用户授权创建（`npx wrangler kv namespace create <名称>`）；重建时须同步更新两个 Wrangler 配置和 `check-production-config` 中的 id。
3. 发布新版 Worker 前，必须先在获得对应环境授权后应用 `0002_photo_manifest.sql`：预览运行 `npx wrangler d1 migrations apply loveuhqq-notebook-preview --remote --config wrangler.preview.jsonc`，生产运行 `npx wrangler d1 migrations apply loveuhqq-notebook --remote --config wrangler.jsonc`。D1 的 `photo_manifest` 表是相册清单的唯一来源，revision 列用于条件更新（CAS）。部署后的首次 GET 会从已有 KV `manifest.json` 初始化 D1，保留照片、精选和版本；该 KV 键此后不再读取或写入，已有照片不会丢失。
4. CLI 上传：`npm run photos:upload:preview` 或 `npm run photos:upload:production`。先批量写入 KV 图片，再写入 D1 清单；CLI 将清单分块暂存后一次性更新，以保持每条 SQL 低于 D1 的 100 KB 语句限制，不再写 KV `manifest.json`；覆盖清单时递增 D1 revision，使旧浏览器提交返回 409。脚本不删除已有图片键，勿用过期的 `.private-photos/` 覆盖站内增量。KV 图片为最终一致，各地生效可能需要约一分钟。生产上传仍须授权并先通过 `check-production-config`。本地测试可运行 `npm run photos:upload:local`，或添加 `--local --persist-to <目录> --source <照片目录>`；`--persist-to` 仅可与 `--local` 一起使用，本地数据库也须先应用两项迁移。
5. 站内上传：解锁后在 `/photos/` 点「贴一张」，客户端压成 thumb/large WebP 后 `POST /api/photos`；成功后墙与张数刷新，首页精选不变。预览只用测试图验收。
6. 核验：未登录访问清单、图片与上传返回 401；登录后首页三张、相册全部可见且可贴一张；构建产物中不出现私密照片标题。

## 私密百日信

正式信件保存在现有 `PHOTOS` 私密 KV 命名空间的独立键 `letters/hundred-day.json`，与照片键互不覆盖；预览与生产仍由各自 Wrangler 配置指向隔离空间，无需新增资源或数据库迁移。正文不进 Git、静态 HTML、浏览器脚本或字体子集。`GET /api/letter` 先验证共同密码会话，再检查北京时间 **2026-10-08 00:00**，最后读取 KV；响应为 `no-store`。访客、失效会话或未到日期均不能读取存储内容。

1. 接收用户提供的原文，将称呼、段落数组和落款写入 `.private-letter/hundred-day.json`（UTF-8，已被 Git 忽略）。结构为 `{"salutation":"称呼","paragraphs":["第一段","第二段"],"closing":"落款"}`；保持原文，不将真实内容写进文档、测试、提交或 PR。阅读器沿用系统字体，不把私密字符加入公开字体子集。
2. 运行 `npm run letter:check`，只检查格式并报告段落数，不上传、不回显正文。预览测试仅使用合成内容，真实信件只上传生产空间。
3. 首次启用云端信件读取逻辑时，按 PR-first 流程发布 Worker。生产合并、部署和信件上传均需本次明确授权。获得授权后运行 `npm run letter:upload:production`（先检查生产绑定）；脚本只覆盖上述信件键，使用 `--path` 传文件，不在命令参数或终端输出中携带正文。后续换信只需上传，无需重新构建或部署。合成预览使用 `npm run letter:upload:preview`。
4. KV 为最终一致，上传后需等待各地读取生效，并在有效会话且到达开放时间后核验正文与原文一致。上线前核验匿名 401、伪造会话 401、日期门槛 403、响应禁止缓存及静态资源无正文；再验收手机长文、关闭与退出清除正文。不能仅凭上传退出码声称正式内容已可读。

正式键不存在时，保持此前已确认的初稿；KV 读取失败或正式内容格式损坏时返回 503，不泄露正文或存储错误。Worker 代码回滚不会回滚 KV 正文，撤回或覆盖正式信件需单独明确授权。

参考：[Cloudflare KV 读取与一致性说明](https://developers.cloudflare.com/kv/api/read-key-value-pairs/)。

## 首次生产启用共同手账

以下步骤均在用户明确授权正式上线后执行。生产配置已绑定独立的 `loveuhqq-notebook` D1；`npm run deploy` 会阻止缺失数据库或误绑预览数据库的发布。

1. 用项目 Wrangler 创建 `loveuhqq-notebook`，把返回的真实 ID 作为 `DB` 绑定加入 `wrangler.jsonc` 的 `d1_databases`，不得填写预览 ID；提交配置并按 PR 流程交付。
2. 执行 `npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc`，核验迁移完成。只操作上述生产数据库。
3. 用户在交互式终端运行 `npm run password:production`，隐藏输入 6–128 个字符的共同密码并确认。助手只把验证值通过 stdin 交给项目 Wrangler；不落盘、不回显密码。该操作会更新生产 Worker secret，必须纳入当次上线授权。
4. 从已批准合并的干净 main 执行 `npm test`、`npm run check:worker`、`npm run deploy`。分别核验 `/api/session`、访客读取 `/api/notebook` 的 401 和登录后的增改、完成、移除、同步。
5. 在各设备登录正式站，核验日记和清单从同一份云端手账读取，并能在另一台设备看到更新。真实记录不得写入预览数据库。

换密码会使所有旧登录状态失效。记住设备的会话最长 30 天，未勾选时 12 小时；退出会撤销该会话。客户端草稿是设备暂存，不等于云端已保存。

升级迁移前先用项目 Wrangler 导出目标 D1 数据库，保存到仓库之外的用户指定安全位置；导出文件包含私密正文，不提交到 Git。回滚 Worker 不会回滚 D1 数据，不能对已有数据的库重复执行破坏性初始化。

## 共同回忆册发布

回忆册通过 `worker/runtime.ts` 导出 HTTP handler 与 `SharedDesktop` Durable Object。`wrangler.jsonc`、原预览配置和本任务隔离预览配置均声明相同的 SQLite 类迁移 `shared-memory-v1`，实际 DO 命名空间按 Worker 隔离。D1 增量迁移为 `0003_shared_memory_book.sql` 和 `0004_optional_place_coordinates.sql`：前者新增独立表，后者完整复制地点记录后移除坐标的非空要求；旧坐标、版本与关联均保留，不改动原日记、愿望、相册和百日信。

本任务验收使用 `wrangler.memory-preview.jsonc`、Worker `loveuhqq-memory-book-preview`、全新 D1/KV，只保存合成内容。部署使用项目 Wrangler：

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.memory-preview.jsonc
npm run build
npx wrangler deploy --config wrangler.memory-preview.jsonc
```

共同门禁通过后，在首页上方选择男生或女生，无需注册或个人口令。沿用现有成员编号与记录；旧密码验证列仅为数据库兼容保留，不参与验证。共同密码继续使用现有安全配置流程，不重置预览门禁。

声音使用既有 `PHOTOS` KV 的 `audio/` 独立前缀，D1 仅存所有者及父内容关系，每次读取均重新鉴权。音频总额度为 300 条/256 MiB，单条字节上限 4 MiB；60 秒录制与浏览器上传时长校验在客户端进行，Worker 额外检查声明时长与容器签名，不进行音频解码。不要将其宣称为服务端证明的实际时长限制。未启用 R2 或新增付费服务。

正式站仍需当前任务明确授权合并、备份生产 D1、应用上述增量迁移及正式部署。部署时保持原生产 D1/KV 绑定，预览 ID 不得复制到生产；新 DO 类由 Wrangler 迁移创建。先执行生产配置检查、完整测试、构建和 dry run，再正式部署，并验证新页、旧入口、匿名 401、个人草稿隔离、未来信日期门槛及两端桌面同步。生产首次成员设置由双方亲自完成。数据库与 DO 存储均不随 Worker 版本回滚，不能用销毁资源恢复旧界面。

## 回滚

经用户明确授权后，先用项目级 `wrangler deployments list` 查找本 Worker 的已知良好版本，再按安装版本的 `wrangler rollback --help` 执行针对该版本的回滚；随后重做域名、HTML 和资源验证。需要源码回退时通过新分支和 PR 恢复已知良好内容，由用户手动合并后重新构建部署；不 reset 或 force push。

## 安全边界

不读取、回显或提交密码、Token、Cookie、API Key。使用现有安全登录机制；不提交 node_modules、dist、.wrangler、.env 或 .dev.vars。不修改 x23.shop 根域、blogtext.x23.shop、x23-personal-site 或其他资源。

未来启用 GitHub 自动部署前核实 Git Integration 权限，只关联本私有仓库，生产分支限定 main，构建 `npm run build`，部署使用项目级 Wrangler。保持用户手动 Merge，更新 README、AGENTS 和本文件，再验证真实触发与部署结果。

## 首次部署证据（2026-09-13，Asia/Shanghai）

- Wrangler 4.131.1 返回 `Deployed loveuhqq-site triggers`，目标为 `loveuhqq.x23.shop (custom domain)`。
- 生产版本：`bbfde3b2-0df1-4c37-a8b0-6e169c1e6c6f`，deployments list 确认流量 100%。
- 权威服务器 arya.ns.cloudflare.com 返回 A：104.21.65.200、172.67.166.139，并返回 AAAA。
- 首页、`/_astro/index.DsI3j6bR.css`、`/favicon.svg` 均为 HTTPS 200。CSS/favicon SHA-256 与 dist 一致。
- Cloudflare 在响应中附加统计及安全脚本；去除这些脚本后 HTML 与 dist/index.html 完全一致，未出现其他项目内容。没有修改账户现有相关设置。
- Cloudflare API 确认本 Worker 无 Builds triggers，自动部署未配置。原 x23-personal-site 的修改时间与操作前相同。
- 浏览器连接失败，手机/桌面视觉验收尚未完成；不能将源码中的响应式规则当成实际截图验证。
- 本机执行环境的 npm 默认脚本子进程未找到 Node；本轮以临时 npm_config_script_shell 指向现场可用 PowerShell 后安装、构建成功。未修改全局 npm 或系统 PATH。其他环境按实际情况诊断，不固定此 workaround。

## 移动布局修复与最终验收（2026-09-13，Asia/Shanghai）

- 真实浏览器截图发现 390px 视口下中文说明可能横向溢出；修复 `src/styles/global.css` 的移动断行为块级换行，并保留长文本溢出保护。
- 重新执行 Astro build，并由 Wrangler 4.131.1 成功部署 `loveuhqq-site`；生产版本：`f13edbea-7582-4975-a765-141655debcc4`，仍绑定 `loveuhqq.x23.shop`。
- 真实浏览器在 1440×900 和 390×844、浅色和深色四种组合下访问线上 URL：均 HTTP 200、标题/viewport/lang 正确、占位正文存在、`document.documentElement.scrollWidth` 与视口宽度相等；手机断行计算样式为 `block`。
- 线上 CSS `/_astro/index.C6OwKbcM.css` 与本地 `dist` 哈希一致，favicon 同样一致；权威 DNS 仍解析到 Cloudflare，Custom Domain 仍指向 `loveuhqq-site`。
- 这次只更新本项目 Worker；`blogtext.x23.shop` 仍指向 `x23-personal-site`，没有改动其他资源。GitHub 自动部署仍未配置。

## 温柔信笺首页发布（2026-09-22，Asia/Shanghai）

- 用户明确授权部署后，从已合并的 PR #4 对应 `main` 提交 `6da5f6e294f57cac1fbd0a4ff28ce3a0756ff894` 发布；构建时工作树干净且与 `origin/main` 一致。
- `npm ci` 成功，依赖审计为 0 个漏洞；8 项日期测试、`npm run build` 与项目 Wrangler 部署预检通过，再执行 `npm run deploy` 完成正式发布。
- Worker 仍为 `loveuhqq-site`，Custom Domain 仍为 `loveuhqq.x23.shop`。生产版本为 `53297c93-5a16-4fdc-b47a-e222d8b4ef87`，部署 ID 为 `80d8696a-ec47-4beb-a087-25b8c4193954`，Cloudflare API 确认流量 100%。
- 正式首页 HTTP 200，标题为“爱你，何青青。 · loveuhqq”，包含确认的文案、纪念日起点与动态天数脚本，旧占位文案已移除。
- 实际 CSS `/_astro/index.DJzkUCiR.css` 和 `/favicon.svg` 均 HTTP 200，SHA-256 与本地 `dist` 文件一致。
- 真实线上 Chrome 在 1440×900 和 390×844 下均 HTTP 200，主标题、实时相恋第 84 天、起始日期和信封正常显示；页面无水平溢出、脚本错误或失败资源。线上检查未模拟时间；其他浏览器及真机尚未验证。
- 权威服务器 `arya.ns.cloudflare.com` 返回 A：`172.67.166.139`、`104.21.65.200`；Custom Domain API 确认目标为本 Worker 的 production 环境，未修改 DNS 或其他站点。

## 全屏纪念册与微动效发布（2026-09-26，Asia/Shanghai）

- 用户明确授权生产部署后，从已合并 PR #7~#15 的干净 `main` 提交 `bd1a87754b5df636eb2c34960309e530965d4b53` 执行发布；发布前已通过 `npm run deploy:preview` 部署至独立预览环境 `loveuhqq-site-preview` 检验。
- 12 项日期与里程碑单元测试全部通过，Astro 静态构建成功。
- 项目级 Wrangler 部署至 `loveuhqq-site`，绑定正式 Custom Domain `loveuhqq.x23.shop`。生产版本 ID：`3a7ec481-b831-42ed-9a4d-6ce62b9f8b5d`，Cloudflare Deployments 确认流量 100%。
- 权威 DNS `arya.ns.cloudflare.com` 解析正常。
- 线上正式站 `https://loveuhqq.x23.shop/`、`/photos/`、`/_astro/global.CAHae9LS.css` 与 `/favicon.svg` 均返回 HTTPS 200。
- 正文包含完整的六屏章节结构（首页、故事、照片、心里话、纪念日、未来）、纸质爱心倾斜与漂浮微交互、实时相恋天数与第 100 天倒计时。

## 柔粉毛玻璃暗号门禁正式上线（2026-09-26，Asia/Shanghai）

- 用户明确授权合并 PR #16 与 PR #17 并执行生产部署。合并提交 `a23bb5f`，构建前验证 18 项单元测试全部通过。
- 采用项目级 Wrangler 部署至 `loveuhqq-site`，绑定正式 Custom Domain `loveuhqq.x23.shop`。生产版本 ID：`0ebd5703-135e-4357-b55e-5f5a55e4e5a3`，Cloudflare Deployments 确认流量 100%。
- 权威 DNS 解析正常，首页 `https://loveuhqq.x23.shop`、`/photos/`、暗号门禁独立 JS 模块 `/_astro/PassphraseGate.astro_astro_type_script_index_0_lang.D1fjZHIY.js` 及样式表 `/_astro/global.aU2QPjIt.css` 均返回 HTTPS 200。
- 线上正式站默认呈现居中柔粉毛玻璃暗号门禁与高斯模糊遮罩；输入双方约定的暗号可平滑解锁；支持“记住这台设备”免密回访；页脚包含“锁定”按钮支持随时重新上锁保护。

## 极简克制风文案正式上线（2026-09-26，Asia/Shanghai）

- 用户明确授权合并 PR #19 并执行生产部署。合并提交 `6f4769c`，18 项单元测试全部通过。
- 采用项目级 Wrangler 部署至 `loveuhqq-site`，绑定正式 Custom Domain `loveuhqq.x23.shop`。生产版本 ID：`ed3f3ef9-b937-4535-998e-211099293a16`，Cloudflare Deployments 确认流量 100%。
- 权威 DNS 解析正常，首页 `https://loveuhqq.x23.shop` 及 `/photos/` 均返回 HTTPS 200。
- 线上正式站全站文案重构为极简克制、备忘录记录风格：门禁更新为“访问验证 / 输入起始日期以继续浏览 / 进入”，心里话更新为“记录生活，慢慢往前走”，去除多余煽情与爱心符号。

## 纸上手账改版正式上线（2026-09-28，Asia/Shanghai）

- 用户明确授权清理过时文件、合并 PR #23 并执行生产部署。合并前 GitHub CI 通过，并在干净检出中复现 `npm ci`、23 项单元测试与构建。合并提交 `3f94245028f000fe1693c537cab033f207fd826f`，构建时工作树干净且与 `origin/main` 一致。
- 部署前线上版本为 `7b4a9754-cb38-47f0-829b-1f68c1a5044a`，可作回滚目标。项目级 Wrangler 部署至 `loveuhqq-site`，绑定正式 Custom Domain `loveuhqq.x23.shop`；生产版本 ID：`d46c6db3-38cf-45a1-b5a1-0283e8069f5e`，Deployments 确认流量 100%。发布前已在 `loveuhqq-site-preview`（版本 `29ba5043-bc44-4f8f-9ad6-f34f7a4d4dbb`）预览验收。
- 本机 DNS 被本地代理以 fake-IP（`198.18.0.0/15`）应答，改用 Cloudflare DNS-over-HTTPS 核对：A `104.21.65.200`、`172.67.166.139`，AAAA 两条，NS 仍为 `arya`/`darl.ns.cloudflare.com`，与此前记录一致，未修改 DNS。
- 正式站首页、`/photos/`、`/favicon.svg`、`/manifest.json`、`/robots.txt` 与图片均为 HTTPS 200；首页 HTML 去除 Cloudflare 注入脚本后与 `dist/index.html` 逐字节一致，CSS、favicon 与抽查的 woff2 字体文件与 `dist` 一致。正文包含“一天，记一格。”“我们，是从哪天开始的？”“写给第 100 天”，旧文案已移除，未出现其他站点内容；`blogtext.x23.shop` 未受影响。
- 真实 Chrome 在 1440×900 与 390×844 下访问正式站：门禁正常显示，思源宋体在站点 CSP 下正常加载，计数正确，无横向溢出。控制台中 Cloudflare 自动注入的 Web Analytics 脚本 `static.cloudflareinsights.com/beacon.min.js` 被站点 CSP 拦截，此为既有情况，页面功能不受影响；如需统计需另行调整 CSP 或关闭注入。
- 同时清理了已失效的优化报告、旧版截图、`public/sitemap.xml` 与无对应文件的 `/sw.js` 响应头规则。

## 纪念日登记与响应头修正上线（2026-09-28，Asia/Shanghai）

- 用户在 GitHub 合并 PR #25 与 PR #26（CI 均通过）后明确授权生产部署。从 `main` 提交 `074d37e70f8f975a214a5bc87c2b9fc8401ca0e3` 发布，工作树干净且与 `origin/main` 一致；`npm ci`、24 项单元测试与构建通过。
- 部署前线上版本为 `d46c6db3-38cf-45a1-b5a1-0283e8069f5e`，可作回滚目标。项目级 Wrangler 部署至 `loveuhqq-site`，Custom Domain `loveuhqq.x23.shop`；生产版本 ID：`aa2d63e8-7d28-4169-be76-36be24358f16`，Deployments 确认流量 100%。
- 首页、`/photos/`、`/favicon.svg`、`/manifest.json`、`/robots.txt` 均为 HTTPS 200；首页 HTML 与 `dist/index.html` 逐字节一致，抽查 CSS 哈希一致；线上脚本包含“通过游戏认识”“抖音火花 100 天”“恋爱 100 天纪念”，日历第 68 天与第 100 天带圆点。
- 响应头：HTML 为 `public, max-age=0, must-revalidate, no-transform`；`/_assets/*` 为 `public, max-age=31536000, immutable`，`/images/*` 为 `public, max-age=2592000, immutable`，`/manifest.json` 为 `public, max-age=604800`，不再与全站值拼接。
- Web Analytics 在 Cloudflare 按整个 `x23.shop` zone 开启，免费套餐无法按主机名排除，因此未修改 Cloudflare 设置，改由 `no-transform` 阻止注入：本站 HTML 已不含 `cloudflareinsights` 脚本，真实浏览器控制台无错误、无失败资源、无横向溢出；`blogtext.x23.shop` 仍 HTTP 200 且照常注入统计。

## 全面优化正式上线（2026-09-29，Asia/Shanghai）

- 用户明确授权合并 PR #28 并执行生产部署。首次发布后发现 PR #28 漏带任务分支的最后一个提交（点选格子后网格保持焦点），补走 PR #30 合并并重新部署；两次均为用户授权的发布流程。最终源码为 `main` 提交 `414787e`（含 #28 squash 合并 `056aac5`），GitHub CI 通过，干净 `main` 上复现 `npm ci`、26 项单元测试与 `npm run build`。发布前已在 `loveuhqq-site-preview`（版本 `dd330a5f`）完成桌面与手机视口预览验收。
- 部署前线上版本为 `df82a3ac-d1ab-47ef-8485-0fb7c9b189c4`，可作回滚目标。项目级 Wrangler 4.131.1 部署至 `loveuhqq-site`，绑定正式 Custom Domain `loveuhqq.x23.shop`；最终生产版本 ID：`1dd6ce15-2448-4c81-a017-baaf40c32d3d`（其前一趟为 `01432fb3-3f03-4dc0-9467-f6e0fe4787fb`）。
- Cloudflare DoH 核对权威 A 记录 `172.67.166.139`、`104.21.65.200`，与既往一致，未修改 DNS。
- 正式站首页、`/photos/`、`/manifest.json`、`/robots.txt` 均为 200，未登记路径正确返回 404；首页 HTML 与 `dist/index.html` 逐字节一致，`no-transform` 阻止注入的效果保持稳定。
- 新 CSS `/_assets/SiteHeader.BzlaFNZg.css`（31,009 字节，原阻塞 CSS 123,941 字节）与单文件字体 `/_assets/noto-serif-sc-400-subset.CmzFHmQv.woff2`（74,976 字节，替代原约 3.5MB 分片）SHA-256 与 `dist` 一致；脚本 `/_assets/index.astro_astro_type_script_index_0_lang.Dkz5szMk.js` 哈希一致；`/images/envelope-620.webp` 200，旧 `envelope.webp` 正确返回 404。
- 响应头符合本轮改动：无 `X-XSS-Protection`、`Permissions-Policy` 不再含 `interest-cohort`、`Cache-Control` 保留 `no-transform`、HSTS 不变。
- 真实 Chrome 1440×900 访问正式站：门禁输码解锁、封面开场（纸心、邮戳、第 91 天）与思源宋体子集渲染正常；`blogtext.x23.shop` 未受影响。

参考：[Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/)。

## 私密照片墙正式上线（2026-10-05，Asia/Shanghai）

- 用户明确授权合并 PR #46 并执行生产部署。源码为 `main` 提交 `8cf0cac`（#46 squash 合并），GitHub CI 通过；在干净 `main` 上复现 `npm ci`、65 项单元测试与 `npm run build`。发布前已在 `loveuhqq-site-preview`（版本 `eefd6249-7040-4f9f-82e0-bddc5f393807`）部署验收。
- 账号未开通 R2，经用户选择改用 Workers KV：创建 `loveuhqq-photos-preview`（`b74bb16196a048cc82b2c1c0feae90e9`）与 `loveuhqq-photos`（`f2758069198e4a90896513225121d661`）。16 张照片（缩略图与大图，均已去除 EXIF）及清单共 33 个键分别写入两个命名空间；原图不进仓库。
- 部署前线上版本为 `6d6814c2-062f-4b69-afda-94781605fe57`，可作回滚目标。生产版本 ID：`a7e596e0-5a8c-4e27-8cc3-0b89146b7fb2`，Deployments 确认流量 100%，绑定 `PHOTOS` KV 与 `loveuhqq-notebook` D1。
- 正式站首页、`/photos/`、`/favicon.svg`、`/manifest.json`、`/robots.txt` 与抽查的 `/_assets/*` 脚本、样式、字体均为 HTTPS 200；未知路径返回 404 且正文为“这一页，好像被撕掉了。”；已删除的示意图 `/images/sea.webp` 为 404。首页与 `/photos/` HTML 与 `dist` 一致，只含“待解锁”空位，不含任何照片标题。未登录时 `/api/photos` 与图片接口均为 401（`no-store`）；`blogtext.x23.shop` 未受影响。登录后的照片显示由用户在正式站验收。


### 当前身份选择方式

共同门禁通过后进入首页，上方只提供「男生」「女生」两项身份选择，不再注册称呼或填写个人口令；选择会沿用到回忆册与共同桌面，可随时切换。两份署名段落、共同揭晓、未来信件的收件人与日期规则保留，已有记录不迁移、不删除。身份只区分署名，不提供双方之间的口令隔离；任何通过共同门禁的人都可以切换查看相应身份的内容。此前独立个人口令的描述由本约定替代。
