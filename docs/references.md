# 公开实现对照与来源

记录日期：2026 年 10 月 22 日。这里比较的是所列公开文档和指定插件版本，不是对所有产品功能的穷尽盘点。

## 能力与本插件的定位

| 公开参考 | 本次核实的能力 | 本插件采用的方向与区别 |
|---|---|---|
| PI 的 `pi-prompt-enhancement` | 独立模型请求改写草稿，一键回填，强调保留意图、语言和标识符 | 保留一键操作，另加当前会话上下文、选区处理、原文保护和差异还原；不复制其源代码或提示词 |
| Claude Code Prompt suggestions | 回复后根据会话，用相同模型作后台请求，建议可采纳为草稿 | 参考下一句建议的交互；本插件通过 DSH 已配置的模型独立生成 |
| Codex Composer Predictions | 根据当前会话建议下一条消息，Tab 采纳为可编辑草稿 | 参考采纳后可编辑、由用户发送的流程；不依赖 Codex 内部预测服务 |
| `studyzy/dsh-suggest-prompt` | DSH 回合后生成一句用户口吻建议，宿主存储及输入框灰字 | 参考公开接口使用方式；本插件把下一句和输入中续写纳入一个调度器，并允许有依据的追问和纠偏 |
| `fishcg/dsh-input-prediction` | DSH 输入续写及回复后候选建议 | 参考两种模式的使用场景；本插件采纳只写草稿，并共用优化、保护和版本守卫 |
| 本插件 | 优化、下一句、续写、当前会话草稿暂存 | 以同一输入流程解决组织表达、检查改动和保存长草稿的问题；质量仍需独立评测 |

这些差异是可检查的功能或策略差异，不等于准确率排名。比如更长历史和允许追问能覆盖更多场景，也可能引入额外噪声；必须把可用率、弃权率、错误新增要求和延迟一起评估。

## 公开源码与许可

- **本项目**：独立实现的源代码按 MIT 发布，见根目录 `LICENSE`。
- **PI 参考插件**：已核对 [`f04349ae...` 的 LICENSE](https://github.com/vastsa/pi-prompt-enhancement/blob/f04349ae6902d0d6be880cc19b20e68942d78721/LICENSE)，使用 LGPL-3.0。其代码、原始提示词和构建产物未拷入本发行包，也不作为运行依赖。我们参考的是用户操作流程，实际提示词和实现另行编写。
- **DSH SDK**：通过官方已发布 SDK 的扩展接口集成，目标为 `0.2.1-rc.2`；运行时共享的 SDK、Cordis、React 保持外部引用。依赖仍适用其各自许可证，不能把本项目的 MIT 解释为替依赖重新授权。
- **社区参考插件**：`studyzy/dsh-suggest-prompt` 和 `fishcg/dsh-input-prediction` 的许可证均已核对为 MIT。它们是调研参考，不是本包依赖；本包不包含其插件构建产物。
- **Claude Code**：公开仓库的 [LICENSE.md](https://github.com/anthropics/claude-code/blob/main/LICENSE.md) 使用商业条款。仓库可访问不等于完整实现可按开源许可证移植。本项目没有复制其内部实现。
- **Codex**：公开 CLI、app-server 等组件的许可与桌面端预测功能的公开范围应分开判断。本项目不连接或复制其内部预测服务。

Claude Code 文档公开了后台请求、会话缓存及采纳行为；Codex 文档公开了基于当前会话的预测与 Tab 采纳行为。**本项目未取得这两款产品的完整内部预测提示词或生成链路。** 自行编写的提示词不应标注为官方原版，也不能承诺复现或超越其预测效果。

## 精确参考

- [DSH bundle 打包与安装说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/develop/basic/publish.md)
- [DSH `0.2.1-rc.2` conversation 发布包元数据](https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-ui-conversation/0.2.1-rc.2)
- [DSH 输入动作契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/contract/input.ts)
- [DSH 原生键盘仲裁](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-conversation/src/client/input/editor/keymap.ts)
- [PI 提示词增强参考实现](https://github.com/vastsa/pi-prompt-enhancement/blob/f04349ae6902d0d6be880cc19b20e68942d78721/main.js)
- [Claude Code Prompt suggestions](https://code.claude.com/docs/en/interactive-mode#prompt-suggestions)
- [Codex Composer Predictions](https://learn.chatgpt.com/docs/features/composer-predictions)
- [studyzy 建议生成参考实现](https://github.com/studyzy/dsh-suggest-prompt/blob/b02261d6a51bad0cd8c832b13d9def9e1e7b149e/src/generate.ts)及其 [MIT 许可](https://github.com/studyzy/dsh-suggest-prompt/blob/b02261d6a51bad0cd8c832b13d9def9e1e7b149e/LICENSE)
- [fishcg 输入预测参考实现](https://github.com/fishcg/dsh-input-prediction)及其 [MIT 许可](https://github.com/fishcg/dsh-input-prediction/blob/main/LICENSE)
