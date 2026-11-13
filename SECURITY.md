# 造境安全策略

这是一个个人开发预览项目。安全问题不要公开发 Issue、讨论或 Pull Request。

请通过 GitHub 私密漏洞报告入口提交：

<https://github.com/xiaowen-prog/ai2d-game-studio/security/advisories/new>

报告中请说明受影响提交、系统、复现步骤、影响范围，以及是否可能导致密钥、项目文件或生成素材跨越信任边界。不要提交真实 API Key、账户令牌或私人项目文件。

造境把 Electron 主进程视为受信任宿主，把 Renderer、Agent 输出、清单和生成工程视为不受信任输入；详细边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
