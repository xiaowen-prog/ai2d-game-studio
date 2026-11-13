# 造境 · AI 游戏制作台

> 把脑海里的世界，做成能玩的游戏。

造境是一个本地优先的 2D 游戏制作台：你用自然语言描述想法，和 AI 一起完成角色、场景、玩法、试玩、历史恢复和导出。

## 现在能做什么

- 2D 横版闯关与俯视冒险
- Codex Agent 驱动的规划、制作、审查和有限修复
- Godot 4 工程与网页游戏导出
- 项目、成果、确认记录和历史版本保存在本机
- macOS / Windows x64 测试包
- 私有在线界面：网页连接本机制作桥接，不上传项目和凭据

## 本地运行

```bash
npm ci
npm run dev
```

需要 Node.js 22+、Codex 登录状态和 Godot 4（制作 Godot 游戏时）。

## 私有在线真实制作台

```bash
npm run online:bridge
```

然后打开 [造境私有在线制作台](https://zaojing-game-studio-preview.dear-vale-4884.chatgpt.site)，点击「打开实时制作台」。真实生成、修改、历史恢复和导出仍由本机现有运行时完成。

## 工程检查

```bash
npm run typecheck
npm test
npm run build
```

## 代码归属与上游说明

本仓库是基于 [Innate-Labs/Noobi.ai](https://github.com/Innate-Labs/Noobi.ai) 的个人二次开发版本。造境品牌、产品文档和本项目新增代码由 `xiaowen-prog` 维护；上游代码、第三方依赖及其许可证边界不被重新声明为原创，详见 [`docs/UPSTREAM_ATTRIBUTION.md`](docs/UPSTREAM_ATTRIBUTION.md) 和 [`build/NOTICE.md`](build/NOTICE.md)。

上游仓库没有发布统一项目许可证，因此本仓库目前是公开可见的个人衍生项目，不能把未授权的上游部分重新许可成新的开源许可证。
