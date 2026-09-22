# 部署说明

## 唯一来源与拓扑

`GitHub liangjie78/loveuhqq-site 的 main → 同提交本地构建 → dist → Cloudflare Worker Static Assets loveuhqq-site → loveuhqq.x23.shop`

当前为手动 Wrangler 部署，Cloudflare 没有配置 Git 自动构建来源。没有第二个源码仓库。GitHub 自动部署尚未配置，当前 GitHub CLI 登录读取 App installations 返回 403；不绕过权限。

## 目标

- Worker：`loveuhqq-site`
- Custom Domain：`loveuhqq.x23.shop`
- Zone：`x23.shop`
- 账户：由 `wrangler.jsonc` 中 account_id 明确指定，部署前用项目级 `wrangler whoami` 核对。
- 静态产物：`dist/`，无需 Worker 后端入口或 Astro 服务端 adapter。
- DNS 与 HTTPS 由 Cloudflare Custom Domain 管理；不手工替换其他 DNS 记录。

## 正常发布

1. 开发按仓库流程使用 feature/fix/chore 分支或 worktree；完成必要验证后，可自主 commit、push 和创建/更新 PR。默认分支保持 PR-first，不直接 push main；PR 合并、历史改写、tag、force push 与生产部署需明确授权。
2. 取得本次生产部署授权，核验干净 main 与 origin/main 的提交一致。确认账号、目标 Worker、Custom Domain 无异常；已有其他资源占用目标时停止报告。
3. 根据当前环境满足依赖的 Node.js 引擎要求，运行 `npm ci`、`npm run build`，检查 dist 中 HTML、CSS 和 favicon。
4. 运行项目级 `npm run deploy`（重新 build 后 wrangler deploy），记录返回的版本 ID。只发布这个 Worker。
5. 核验 Custom Domain 指向正确 Worker，查询 Cloudflare 权威 DNS，并访问 HTTPS：首页须为 200 且正文与本次发布的源码一致，实际 CSS/favicon 必须为 200；不可出现 work1 或 x23-personal-site 页面。

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

参考：[Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/)。
