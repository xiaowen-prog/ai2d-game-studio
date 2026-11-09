# Windows 测试版

3-2 新增 Windows 10/11 x64 免安装包（Intel / AMD），沿用同一套 Electron / Codex / Godot 代码与数据格式。解压后打开 `造境.exe`，不需要开服务器或安装 Node.js。Windows ARM、32 位系统和 Windows 7/8 不在本次范围。

## 使用与验收

把 `release/windows/Zaojing-0.1.0-preview.3.2-win-x64.zip` 复制到 Windows，右键“全部解压”，打开目录内的 `造境.exe`。不能只复制这一个 EXE，必须保留同目录的资源与 DLL。应用为未签名测试版；系统拦截时保留提示反馈，不关闭防护。

| 顺序 | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 双击造境，打开首页与设置 | 窗口正常显示，无缺少 DLL 或运行程序错误 |
| 2 | 在 Codex 账户登录；环境设置中选择解压后的 Godot 标准版 .exe，安装同版本导出模板后刷新 | AI 运行程序可识别；账户已连接；Godot 与 Web 导出模板显示就绪 |
| 3 | 新建项目，输入想法并发送；确认当前成果后再往后做 | 生成真实成果，每步停下来等你确认；中文和有空格的路径可用 |
| 4 | 修改一次，打开历史并恢复以前的成果 | 修改后的成果可见；恢复后画面、内容和确认状态对应旧版本 |
| 5 | 退出造境，再从同一个 EXE 打开 | 项目、步骤、历史仍在，可继续制作 |
| 6 | 确认完整游戏后导出；完整解压 game-package.zip | Godot 工程、网页、清单、Mac/Windows 启动脚本齐全 |
| 7 | Windows 安装 Python 3.8+ 后双击“打开网页游戏.cmd” | 浏览器打开本机游戏，内容对应最后确认的版本，具体玩法由你验收 |

Godot 下载时选择 Windows 标准版，不选 .NET 版；已有兼容 Godot 4 也可直接选择。游戏开发继续使用原有六步工作流。`refined` 仍是独立设计预览，没有据此替换正式制作台或假装执行 AI。

设置与版本数据在 `%APPDATA%\AI-2D-Studio`，默认项目在用户目录的 `Noobi Games`。更新程序时保留这些目录。两个系统之间没有自动同步；已有 Mac 项目和账户不会被装进 Windows 包，也不会被这次适配改写。

## 开发者打包

Windows x64 安装 Node.js 22+ 与 npm 10+，在源码根目录执行：

```powershell
npm ci --include=optional
npm run package:win
```

产物在 `release/windows/`：ZIP、`package-check.json`、`SHA256SUMS.txt`。程序、Windows Codex 运行程序、前后端与压缩库都在包内；Godot、导出模板和账号需要用户自己准备。不连接签名服务、不自动上传。

Mac 交叉打包时，须先把 lockfile 中 `@openai/codex-win32-x64` 对应的官方 npm 压缩包下载并通过同一条 SHA512 校验，再放入同名 `node_modules` 目录；不能用 Mac 的 Codex 或 Electron 替代。`prepare-windows.mjs` 会核对版本、PE 文件格式与 x64 架构；Electron 由 electron-builder 按目标平台下载。Mac 的 `package:mac` 仍沿用本机 Electron 和原来的签名/打包方式。

`check-windows.mjs` 只读包结构、二进制架构、私有文件排除情况，并逐文件比较 ZIP 解压内容的 SHA256；不启动应用、不登录、不调用模型、不试玩。Windows 安装启动与产品效果始终待用户实机验收。

依据：[Electron 的 Windows 系统支持边界](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice)、[electron-builder 多平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)、[Windows 打包配置](https://www.electron.build/v26/docs/win/)。本项目具体依赖版本以 package-lock.json 为准。
