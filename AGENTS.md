# loveuhqq

这是 `loveuhqq.x23.shop` 的独立项目，唯一正式源码仓库为 `liangjie78/loveuhqq-site`。

- 技术栈：Astro、TypeScript、普通 CSS，静态生成至 `dist`，使用项目级 Wrangler 部署到 Cloudflare Workers Static Assets。
- 执行前识别当前环境、依赖和有效规范；不写死本机绝对路径、Shell、旧版本或历史工具状态。Codex 使用原生工具；AgentDock 仅用于 Chat 聊天模式。
- UI 变更先读取 `docs/DESIGN.md`。当前只有占位页，不自行增加正式恋爱内容或私人信息。
- 生产部署、Cloudflare 和 DNS 等外部修改必须有当前任务明确授权；只操作本项目，不影响其他站点。
- 不读取、输出或提交秘密；凭据使用工具现有的安全登录机制。
- 正常开发采用 `feature/`、`fix/` 或 `chore/` 分支，push 后创建 PR；不直接 push 默认分支，不自动 merge。最终 PR 由用户在 GitHub 网页或 App 手动 Merge。
- 第一次创建仓库允许建立并 push 一次初始生产基线，之后进入 PR-first 流程。
- 当前采用手动 Wrangler 部署；未来改变自动部署方式时同步更新本文件、README 和 DEPLOYMENT。
- 完成前必须实际 `npm run build`，检查产物和受影响路径；部署后核验域名、HTTP、正文和实际资源，不能仅凭退出码声称成功。
