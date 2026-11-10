# 原版源码恢复说明

此工程以用户提供的 0.1.4 归档为基准，原包 SHA256 为 `fc89fb5bd8508c08c1d2c68f8bf66ebc5a43d6d3d03e62cec2ebd0edbb6983f8`。

宿主和核心 TypeScript 从原包 sourcemap 恢复，再进行定向修复。原包没有浏览器端 TypeScript 或 sourcemap，因此 `src/browser/original-client.js` 是原始、未压缩的浏览器 bundle，修复直接应用在这个文件中，构建时原样复制。该文件是浏览器端实际运行的源码；不能把它误认为完整还原的 TypeScript 工程。

`tests/fixtures/original-client.js` 保存原包的原始浏览器 bundle，浏览器测试逐段对照原始控件布局、设置页面和样式，再运行真实 Edge、Lexical 和本地 RPC/模型替身。控制器修补不改变原有直接写入优化、手动预测、详尽模式的提示与长度策略；按用户要求，进入或切回已有对话与加载旧草稿不会单独触发自动预测。

测试：先构建并打包，再运行 `pnpm test`、`pnpm test:package`、`pnpm test:web` 与 `pnpm test:package:web`。测试不能替代真实模型效果、原生操作系统 IME 或完整桌面插件组合验收。
