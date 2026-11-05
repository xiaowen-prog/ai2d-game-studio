# AI 2D Game Studio

基于 [Innate-Labs/Noobi.ai](https://github.com/Innate-Labs/Noobi.ai) 二次开发。支持 **2D 横版闯关和俯视打怪，题材不限**，让不会编程的人通过逐步确认和自然语言修改，制作自己的小游戏。

## 当前交付：节点 2-5

方向卡 → 人物候选 → 人物动作 → 场景 → 横版核心试玩。

AI 生成实际 Godot 工程，沿用已确认的人物和背景；支持跑跳、碰撞、收集、目标、重来，并能根据“加入落地恢复的二段跳”修改真实逻辑。每步可确认、修改和恢复历史版本。

- 用户于 2026-11-06 明确验收通过 2-5。
- 此节点版本尚未开放俯视核心试玩、完整小局和最终交付。
- [在线单跳 / 二段跳样例](https://linjian-core-play-25.dear-vale-4884.chatgpt.site)（所有者私有页面；不提供在线 AI 制作服务）。
- [需求文档](docs/product/PRD/PRD.md)
- [已确认开发计划](docs/product/阶段文档/技术适配声明.md)
- [2-5 验收标准与结果](docs/product/evidence/阶段2-5/验收报告.md)

## 本地启动

使用 Node.js 22 或以上版本及 npm。安装依赖后启动桌面开发环境：

```sh
npm ci
npm run dev
```

制作游戏沿用 Noobi.ai 的 Codex 登录、素材能力以及 Godot 4 和 Web 导出模板。通过应用中的设置配置。源码未包含任何账户或密钥。

只查看本机已有项目、不调用模型：

```sh
npm run build
env -u ELECTRON_RUN_AS_NODE NOOBI_DISABLE_GENERATION=1 node_modules/.bin/electron .
```

本机生成项目、登录状态、引擎安装包和依赖不上传。重新克隆后，旧样例不会自动出现在项目列表中；可通过上方在线页面查看已发布样例。

## 验证与范围

`npm run typecheck`、`npm test`、`npm run build` 是工程检查入口。`scripts/*-review/real-check.mjs` 会调用模型，不能作为普通启动命令反复运行。按用户最新要求，后续业务试玩由用户验收；保留历史失败与未验证范围，不以代码存在冒充效果通过。

本仓库保留 Noobi.ai 的原始提交历史；[原项目说明](docs/Noobi原项目说明.md) 保留供追溯。`docs/product/` 是本次需求与节点交接文档快照，本地维护源仍在同级 `开发工作区`。
