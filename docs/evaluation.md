# 离线模型质量评测

本项目提供 60 条由开发助手编写的固定合成案例，三种操作各 20 条。它们没有取自用户真实聊天，也不会被插件当作长期学习数据。

这套固定案例尚未经独立人工语义标注，当前只有结构及工具回归校验。少量真实模型接线试验记录在 [低用量真实模型试验](smoke-comparison.md)，不能代替全套标注和质量验收。

`reference` 是可接受答案示例，**不作精确匹配评分，也不代表真实模型已经生成该结果**。语义上同样合理的其他表达可以通过人工评审。

## 数据与门槛

| 操作 | 样例构成 | 首版门槛 |
|---|---|---|
| `next` | 12 条明确后续、8 条歧义或自然收尾 | 明确组至少 10 条可用，歧义组至少 7 条正确弃权 |
| `complete` | 12 条适合续写、8 条无需继续 | 明确组至少 10 条可用且只补后缀，无需组至少 7 条弃权 |
| `optimize` | 20 条约束、语言及原文保护案例 | 全部完成语义评审；无实质新增任务或授权、重大约束丢失，保护片段不变 |

覆盖中文、英文、日文、韩文、混合语言、emoji、否定条件、最新纠正、路径、URL、命令、代码和材料内的伪指令。集合适合作为首版回归门槛，不能据此宣传普遍超过 Claude 或 Codex。

## 1. 验证并导出真实插件提示词

先构建，使评测使用与运行时相同的 `prepareGeneration`：

```powershell
pnpm build
node scripts/evaluate.mjs validate
node scripts/evaluate.mjs export --out evaluation/requests.jsonl
node scripts/evaluate.mjs template --out evaluation/results.template.jsonl
```

`export` 输出操作、输入快照、实际 `system` 与 `input` 文本及输出预算。它只生成文件，不发网络请求。将这些材料交给你已配置的模型评测环境运行，并记录提供商、精确模型 ID、推理档、运行日期和延迟。不要把凭据写入结果文件。

基线与候选必须使用相同模型及相同上下文、预算。比较现有插件策略时，另行保存所用基线代码版本、提示词和生成设置，避免只比较不同模型的输出。

## 2. 录入实际结果

结果支持 JSON 数组或 JSONL，每个 ID 一条。模板默认 `recorded:false`，即未运行，不能计为正确弃权。只有真实调用完成才改为 `true`。

直接收集插件最终文本时：

```json
{"id":"next-01","recorded":true,"text":"运行测试。","latencyMs":920,"inputTokens":1200,"outputTokens":6}
```

`text:null` 表示真实生成后的正常弃权。没有记录、`recorded:false` 和真实弃权是三种不同状态。

如果收集的是模型原始输出，使用 `raw`，不要同时提供 `text`：

```json
{"id":"optimize-04","recorded":true,"raw":"检查 ⟪DSH_KEEP_0⟫ 中的问题并说明原因。","latencyMs":1300}
```

评分工具会重新构造同一合成案例的保护映射，并通过真实 `finishGeneration` 校验、还原。占位符应以导出的输入为准，不能根据本说明示例猜测。生成失败不是正常弃权；应保留失败原因并重跑该项，不能将未得到结果的调用填作成功的空输出。

## 3. 人工语义评审

每条预期输出文本的案例至少评审这些维度，值为 `true`、`false` 或未评审的 `null`：

| 字段 | 判断标准 |
|---|---|
| `intentAligned` | 符合当前草稿及最新用户意图，没有回答成助手口吻或偏题 |
| `noUnsupportedRequirements` | 没有凭空新增功能、事实、选择、发布或执行授权 |
| `naturalUserVoice` | 对预测与续写，像用户会自然输入的话，并符合语言要求 |
| `constraintsPreserved` | 对优化，保留范围、否定条件、数值及先后顺序 |
| `editCharacters` | 可选：用户将候选改成可发送文本需要修改的字符数量 |
| `comment` | 可选：说明为何失败或需要怎样修改 |

例如在结果中加入：

```json
{"id":"next-01","recorded":true,"text":"运行测试。","human":{"intentAligned":true,"noUnsupportedRequirements":true,"naturalUserVoice":true,"editCharacters":0,"comment":"承接已要求但未完成的测试"}}
```

自动检查覆盖长度、整句前缀重复、必要原文片段及弃权行为。它无法证明语义保真。即使所有机械检查通过，缺少必要人工评价时也只会得到 `incomplete`，不会得到 `passed`。

## 4. 匿名对照

候选与基线结果使用相同 ID。以下命令把实际最终 `text` 输出随机化为稳定的 A/B 标签：

```powershell
node scripts/evaluate.mjs compare --candidate evaluation/candidate.jsonl --baseline evaluation/baseline.jsonl --out evaluation/blind.jsonl
```

它生成：

- `blind.jsonl`：含题目、A/B 输出及空白评审字段，交给评审者。
- `blind.key.json`：候选/基线标签映射，由组织评测者单独保存，不交给评审者。

评审者填写 A、B 内的语义字段，可另填 `preferred` 为 `A`、`B` 或 `equal`。对照导出要求已经规范化的最终 `text`；原始模型占位输出应先经插件处理，不能直接作为读者可用结果比较。

## 5. 生成报告

```powershell
node scripts/evaluate.mjs score --candidate evaluation/candidate.jsonl --baseline evaluation/baseline.jsonl --reviews evaluation/blind.jsonl --key evaluation/blind.key.json --out evaluation/report.json
```

没有基线或匿名评审时，可只提供候选文件。完全没有模型结果时也可生成状态记录：

```powershell
node scripts/evaluate.mjs score --out evaluation/status.json
```

输出 JSON 和同名 Markdown，分别报告记录完成度、人工评审完成度、可用文本、正确弃权、结构失败、无根据新增要求、修改量以及有记录的 P50/P95 延迟。未提供延迟和 token 用量时不会估算或编造。加 `--strict` 会在尚未通过完整验收时返回非零退出码。

评分状态含义：

- `not_evaluated`：没有真实结果。
- `incomplete`：结果或人工语义评价未齐。
- `failed`：完整组未达到首版门槛。
- `passed`：全部案例和必要人工评价齐全，并达到门槛。

不要通过几乎总是不显示建议来抬高采纳率；预测可用率必须与弃权率和曝光覆盖率共同解释。60 条固定合成样例适合回归，不代表统计上覆盖所有真实任务。
