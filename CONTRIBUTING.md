# 贡献指南

感谢你考虑为 DSH 输入助手贡献代码。

## 开始之前

本项目是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件，兼容声明范围为 `>=0.2.1-rc.2 <0.3.0-0`（当前以 `0.2.1-rc.3` 为测试基准）。开始前请确认：

- Node.js `>= 22.19`（开发验证使用 24.x）
- pnpm 11
- 如需运行浏览器测试：Windows 上的 Microsoft Edge

## 开发环境

```powershell
git clone https://github.com/Somnus678/dsh-input-assistant.git
cd dsh-input-assistant
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` 一次跑完 typecheck、测试和构建。

## 提交前必须通过

```powershell
pnpm typecheck      # 必须无输出
pnpm test           # 121 条测试全部通过
pnpm build          # 构建成功
pnpm test:package   # 需要先 pnpm pack
```

改动涉及界面或样式时，还应运行 `pnpm test:web`（需要 Edge）。

## 持续集成

PR 会自动触发 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。三个 job 都要绿：

- `test-windows`：全量 121 条测试 + Edge 冒烟 + 构建可复现性。**这是权威结果。**
- `test-linux`：排除 Edge 专属测试（116 条），检查跨平台假设。
- `package`：审计打包内容，确保不泄漏研究资料与测试夹具。

只在 Linux 上绿的 PR 不算通过 —— 涉及浏览器渲染、样式或主题的改动必须在
`test-windows` 上确认。提交前请先在本地跑一遍上面的命令，减少 CI 往返。

若你的改动确实无法在 Windows 上验证（例如仅修改文档），在 PR 描述里说明即可。

## 代码约定

- **TypeScript 严格模式**。不要用 `any` 绕过类型，确需宽泛类型时用 `unknown` 并收窄。
- **不引入新的运行时依赖**，除非有充分理由并同步更新 `pnpm-lock.yaml`。DSH SDK、React、Cordis 必须保持 peer 依赖，不能打进宿主包。
- **用户可见文案用中文**，与现有界面一致。注释和标识符用英文。
- **错误处理保留原稿**。优化、续写、预测失败时不得清空或破坏用户输入，这是本项目的核心约束。
- **保护逻辑不可弱化**。`src/core/protection.ts` 负责在改写中锁定代码、路径、URL 和用户指定片段；任何修改都要有对应测试。

## 测试约定

- 每个缺陷修复都应有能复现该缺陷的测试，且该测试在修复前应当失败。
- 浏览器/控制器逻辑用 `jsdom` 环境测试，真实渲染用 Playwright + Edge。
- 测试不得发起真实付费模型调用。需要模型响应时使用本地 fixture 或 mock transport。
- 新增测试文件时，在文件头声明 `// @vitest-environment jsdom`（如适用）。

## 提交信息

使用简短祈使句，说明做了什么：

```
修复 debounceMs 大于轮询间隔时续写失效
补充相对路径保护的正则分支
```

## 报告问题

提交 issue 时请包含：

- DSH 版本（`dsh --version`）与操作系统
- 插件版本
- 复现步骤与预期/实际行为
- 相关日志（**不要包含 API key、token 或完整对话内容**）

## 安全

请勿在公开 issue 中披露安全漏洞。见 [SECURITY.md](../SECURITY.md)。

## 许可证

提交贡献即表示你同意以 [MIT](../LICENSE) 许可发布你的贡献。
