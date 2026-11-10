# DSH 输入助手

简体中文 | [English](README.en.md)

当前源码为 **0.1.5**，以用户提供的原始 0.1.4 包为基准：保留原界面、原设置和直接写入交互，仅修复安全和可靠性问题。已发布的 0.1.4 是另一份包含界面调整的构建。

[![CI](https://github.com/Somnus678/dsh-input-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Somnus678/dsh-input-assistant/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Somnus678/dsh-input-assistant)](https://github.com/Somnus678/dsh-input-assistant/releases)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![dsh](https://img.shields.io/badge/DSH-0.2.1--rc.2-purple)](https://github.com/deepseek-ai/deepseek-harness)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的输入框增强插件：**提示词优化**、**下一句预测**、**输入续写**、**草稿暂存**。

![优化界面](docs/images/optimize.png)

## 功能

| 功能 | 说明 |
|---|---|
| **提示词优化** | 把草稿或选中文字改写成更准确、可发送的表达。三档强度（轻/标准/深度），显示逐词差异，一键撤销。 |
| **下一句预测** | 回复完成后预测你接下来可能说的话，以灰字提示，Tab 采纳，不发送。 |
| **输入续写** | 根据当前草稿预测后续内容，停顿时间与最小间隔可调。 |
| **草稿暂存** | 当前会话最多保留 3 份草稿，手动暂存后清空，显式恢复。 |

深色与浅色主题均已适配：

| 浅色 | 深色 |
|---|---|
| ![浅色](docs/images/light.png) | ![深色](docs/images/dark.png) |

### 保护机制

改写时以下内容保持原样，模型无法篡改：

- 代码块（``` 和 ~~~）与行内代码
- URL 与盘符绝对路径（`C:\...`）
- 相对路径与文件名（`src/core/generation.ts`、`package.json`、`README.md`）
- 你显式锁定的片段

占位符被模型篡改、丢失或重复时，插件拒绝该结果并保留你的原稿。

### 失败不丢稿

优化、续写、预测在超时、取消、网络失败、模型空输出时都保留原稿，只给出提示。一次瞬时状态轮询失败不会中断正在进行的手动优化。

## 安装

需要 **Node.js >= 22.19** 和 **DSH `0.2.1-rc.2` 或 `0.2.1-rc.3`**。安装预构建 `.tgz` 不需要在本地编译 TypeScript。

从源码构建后，可安装本地 0.1.5 安装包：

```powershell
dsh --version                                  # 确认 0.2.1-rc.2 或 rc.3
dsh plugin --profile web add (Resolve-Path './dist/dsh-input-assistant-0.1.5.tgz').Path
dsh --profile web --dump-config                # 应看到 dsh-input-assistant 层
dsh --profile web
```

也可从 [Releases](https://github.com/Somnus678/dsh-input-assistant/releases) 下载对应版本后安装：

```powershell
dsh plugin --profile web add ./dsh-input-assistant-0.1.5.tgz
```

官方桌面端使用自己的 `desktop` profile（默认 Windows 安装位置）：

```powershell
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh --version
& $dsh plugin --profile desktop add (Resolve-Path './dist/dsh-input-assistant-0.1.5.tgz').Path
```

安装或升级后**完全退出并重新打开 DSH**，插件才会加载。

### 卸载

```powershell
dsh plugin --profile web remove dsh-input-assistant
```

同样需要重启对应实例。卸载**不会**清除插件保存的草稿与设置（存在宿主私有 storage 中）。

### 从源码构建

```powershell
git clone https://github.com/Somnus678/dsh-input-assistant.git
cd dsh-input-assistant
pnpm install
pnpm build
pnpm pack --pack-destination dist
```

## 快速上手

1. 安装后重启 DSH，输入框右侧出现**「优化」按钮**。
2. 在输入框写入草稿，点「优化」；结果直接写入，可查看改动并还原。
3. 左下角账号菜单 → **设置 → 输入助手**，可分别开关四个模块、调整强度与高级参数。

> **默认会调用模型。** `下一句预测` 和 `输入续写` 默认开启，会在你输入时自动发起请求。若只想手动使用优化功能或控制成本，请先在设置中关闭这两项。

进入或切回已有对话、恢复旧草稿时不会仅因加载状态发起预测；本次会话中实际输入或产生新回复后，自动功能仍按原有开关工作。

## 设置项

| 设置 | 默认 | 范围 | 说明 |
|---|---|---|---|
| 提示词优化 | 开 | — | 是否显示优化入口 |
| 草稿暂存 | 开 | — | 是否启用手动暂存与恢复 |
| 下一句预测 | 开 | — | 回复后是否预测下一句 |
| 输入续写 | 开 | — | 输入时是否预测后续内容 |
| 优化强度 | 标准 | 轻/标准/深度 | 改写幅度 |
| 预测详略度 | 标准 | 简明/标准/详尽 | 详尽模式沿用原版的长度扩展策略 |
| 显示方式 | ghost | ghost/panel | 灰字或面板 |
| 续写停顿 `debounceMs` | 600 | 200–5000 | 停止输入多久后触发 |
| 最小间隔 `minIntervalMs` | 2000 | 500–30000 | 两次续写请求的最小间隔 |
| 固定辅助模型 | 跟随输入框 | — | 可指定 provider/model；留空则跟随输入框所选模型 |

详尽模式保留原版策略：下一句上限不大于 120 时按 400 处理，续写上限不大于 80 时按 200 处理；这是原有行为。

### 各功能怎么用

**优化整稿或选区**：输入草稿后点「优化」。结果直接写入输入框，可在菜单查看改动及还原，或按一次 `Ctrl+Z` 恢复原文。

**下一句预测与输入续写**：预测结果以**灰字**显示在光标后。按 `Tab` 采纳，按 `Esc` 或继续输入忽略。采纳**不会**发送消息。

**暂存长草稿**：在菜单中点击「暂存并清空」，先保存非空草稿再清空（每个会话最多 3 份）。从菜单可查看并显式恢复；切换会话、切换模型、断线重连后暂存仍在该会话下。

## 兼容性

| 项目 | 支持范围 |
|---|---|
| DSH | 声明 `>=0.2.1-rc.2 <0.3.0-0`；本轮依赖测试以 `0.2.1-rc.3` 为基准，完整宿主组合尚未验证 |
| Node.js | `>= 22.19` |
| 操作系统 | Windows x64（已验证）；macOS/Linux 未验证 |
| 浏览器测试 | Microsoft Edge |

## 已知边界

**这个插件没有完成完整的效果评测。** 请据此判断是否适合你的场景：

- 60 条固定合成质量集尚未跑完真实模型评测，也没有独立人工语义标注，状态为 `not_evaluated`。
- 6 次真实模型小样本对照只能说明链路可用（2,807 tokens），**不能证明效果优于同类工具**。
- 中文 IME 候选组合、附件/引用组合、完整官方 Web 组合、其他插件组合、非 Windows x64 平台均未验证。
- 声明允许 `0.2.1-rc.2` 至 `<0.3.0-0`；本版未对范围内每个宿主版本完成实机验证。

详见 [验收记录](docs/validation.md) 与 [低用量真实模型试验](docs/smoke-comparison.md)。

原版浏览器源码的恢复边界与构建方式见[原版源码恢复说明](docs/source-restoration.md)。

## 数据与隐私

- 不收集遥测，不上传使用数据。
- 草稿与设置存在宿主 DSH 的私有 storage。
- 模型调用走宿主已配置的提供商；插件不持有或记录 API key。
- 优化/预测/续写会把当前草稿与相关上下文发给模型提供商 —— 这是功能必需，请按你所用提供商的数据政策评估。

详见 [安全策略](SECURITY.md)。

## 开发

```powershell
pnpm install
pnpm typecheck     # 类型检查
pnpm build         # 构建 lib/
pnpm pack --pack-destination dist
pnpm test          # 工程回归（打包后包含 Loader 测试）
pnpm test:package  # 校验打包产物（需先 pack）
pnpm test:web      # 真实 Edge 回归
pnpm test:package:web # 真实 Edge 加载安装包回归
```

贡献前请阅读 [贡献指南](CONTRIBUTING.md)。技术细节见 [0.1.2 修正记录](docs/CHANGELOG-0.1.2.md)。

### 持续集成

每次 push 和 PR 都会在 GitHub Actions 上自动运行 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)：

| Job | 环境 | 内容 |
|---|---|---|
| `test-windows` | `windows-latest` | 工程测试 + 源码构建及实际安装包的 Edge 回归 + 构建可复现性校验 |
| `test-linux` | `ubuntu-latest` | Node 22.19／24.19 工程测试；Edge 浏览器回归在 Windows 任务运行 |
| `package` | `ubuntu-latest` | 打包内容审计：必需文件齐全，且不含研究资料、缓存或测试夹具 |

`test-windows` 是权威结果：`scripts/smoke-original.mjs` 使用
`chromium.launch({ channel: 'msedge' })` 驱动真实 Microsoft Edge 渲染已发布的 DSH 主题，
Edge 浏览器检查在无 Edge 的 Linux 上不运行，覆盖由 Windows job 提供。

本地想复现 Linux job：

```powershell
pnpm test
```

## 许可证

[MIT](LICENSE)。第三方依赖与参考实现各自适用其原许可证，见 [公开参考与实现边界](docs/references.md)。
