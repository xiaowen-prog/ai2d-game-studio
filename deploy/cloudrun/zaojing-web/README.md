# 造境 CloudRun 前端预览服务

这个目录是 CloudBase 云托管的最小静态容器包装层。它只托管已构建的 `dist/client`，不包含 Codex 登录态、本机项目或任何邀请码密钥。

部署前先运行：

```sh
npm run build:renderer
node scripts/prepare-online-preview.mjs
node scripts/prepare-cloudrun-preview.mjs
```

再用工作区里的 `deploy_cloudrun.py` 部署本目录。邀请码通过 CloudRun 环境变量 `ZAOJING_ACCESS_SECRET`、`ZAOJING_OWNER_CODE` 和 `ZAOJING_INVITE_CODES` 注入，不要写进仓库。
