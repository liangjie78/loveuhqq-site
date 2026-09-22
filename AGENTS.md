# loveuhqq

这是 `loveuhqq.x23.shop` 的独立项目，唯一正式源码仓库为 `liangjie78/loveuhqq-site`。

- 技术栈：Astro、TypeScript、普通 CSS，静态生成至 `dist`，使用项目级 Wrangler 部署到 Cloudflare Workers Static Assets。
- 执行前识别当前环境、依赖和有效规范；不写死本机绝对路径、Shell、旧版本或历史工具状态。Codex 使用原生工具；AgentDock 仅用于 Chat 聊天模式。
- UI 变更先读取 `docs/DESIGN.md`。当前为温柔信笺纪念首页，只使用用户已确认的称呼、文案与纪念日期；不自行增加其他恋爱经历或私人信息。
- 生产部署、Cloudflare 和 DNS 等外部修改必须有当前任务明确授权；只操作本项目，不影响其他站点。
- 不读取、输出或提交秘密；凭据使用工具现有的安全登录机制。
- Git 协作按当前仓库流程和任务目标自主判断 commit、常规 push、branch/worktree 与 PR；本项目默认分支保持 PR-first，不直接 push 默认分支，已有相关 PR 时优先更新，无法确定时使用独立任务分支和 PR。
- PR 合并、amend、rebase、reset、tag、force push 和生产部署仍需明确授权；对 `reset --hard`、`clean`、force push 等难恢复操作还要核实目标与影响。用户要求仅本地、不提交或不推送时优先服从。
- 当前采用手动 Wrangler 部署；未来改变自动部署方式时同步更新本文件、README 和 DEPLOYMENT。
- 完成前必须实际 `npm run build`，检查产物和受影响路径；部署后核验域名、HTTP、正文和实际资源，不能仅凭退出码声称成功。
