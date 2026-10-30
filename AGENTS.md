# AGENTS.md

本仓库是轻作独立 `official.ai-image` 插件，提供批量图像编辑业务界面。AI 连接、服务商密钥、文本与图像模型目录由轻作底座统一管理；插件只调用底座共享 AI 能力，不内置对话 AI，也不保存服务商密钥。它依赖插件 API 1.2；桌面底座和市场目录在其他仓库维护。

## 项目边界

- `ui/` 只包含批次业务界面；`tests/` 包含状态、能力边界、固定响应 host 和公开市场测试；`scripts/pack-plugin.mjs` 生成平台制品和目录片段；`scripts/verify-release-inputs.mjs` 校验固定底座与 SDK Release。
- manifest 的权限必须保持最小：`files`、`ai: ['image-edit']`。插件不得声明服务商凭据、图像服务网络来源或独立设置页。
- SDK 1.2.0 tarball 随项目固定保存，并在发布时对照 `sdk-v1.2.0` Release 校验；不要改用浮动版本或运行时下载。

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:market
```

普通 host 测试使用固定响应验证批次和助手契约；market 测试安装已签名公开制品并检查底座 `app.asar` 未被修改。完整发布流程在 `.github/workflows/release.yml`，需要固定的 `QINGZUO_HOST_RUN_ID`。

## 实现与安全约定

- 文本与图像连接、凭据和网络调用属于底座公共能力。插件只通过宿主 SDK 读取可用图像模型和调用图像批次，不得读取共享密钥、OAuth token、服务地址或文件路径。
- 共享连接和共享官方服务都由底座完成调用。插件不得声明 Google/OpenAI origin 或凭据，不得新增插件侧密钥表单；来源、型号、提示词和参数必须在批次创建时冻结。
- 保持用户确认、输出目录授权、后台批处理、取消、保存失败、未知状态和恢复语义；未知请求不自动重发，失败只在用户明确操作时重试。
- 模型目录缺少型号时不能伪造 fallback；模型可见不代表账户有权限。不要为 CI 或市场验收发起真实图像生成、额度消耗或 OAuth 登录。
- 不要把图片、凭据、访问令牌、代理响应或 `.env*` 写入仓库；`release/`、`output/` 和测试 profile 是生成物。

## 发布与市场边界

- 发布输入必须由 `scripts/verify-release-inputs.mjs` 核对成功的轻作 0.3.0 host run、正式 `v0.3.0` 和固定 `sdk-v1.2.0` Release；tag 必须匹配 `package.json`。
- 发布生成 macOS arm64 / Windows x64 `.ecplugin` 和目录片段。市场负责检查原始字节、Ed25519 签名和 catalog PR；本仓库不保存市场私钥、不直接修改线上目录。
- `validation: market` 只验证签名安装、插件启动和底座摘要保持不变，使用 fixture，不等同于真实账户图像质量、费用/额度或 OAuth 验收。

## 变更流程

1. 先阅读受影响的状态/批次模块、`tests/state.test.mjs`、`tests/host.mjs`、`tests/market.mjs` 和发布 workflow。
2. API 权限、批次状态、来源/模型选择或助手工具变化要同步 manifest、SDK 调用、测试和 README。
3. 先运行 `npm test`，再运行 `npm run pack` 和固定 host 测试；涉及公开安装时补充 `npm run test:market`。
4. 检查 `git diff --check`、`git status` 和生成物，报告固定 host/SDK 版本、平台和未完成的真实服务验收。
