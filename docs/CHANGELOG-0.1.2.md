# 0.1.2 修正记录

记录日期：2026 年 10 月 23 日（Asia/Shanghai）。

`0.1.2` 是 `0.1.1` 的缺陷修正版本，不新增用户可见功能。以下每条都先复现、再修复、再补回归用例。测试总数从 **105** 增至 **121**（12 个测试文件）。

## 修正清单

### 1. 相对路径与裸文件名不受保护（`src/core/protection.ts`）

**问题**：`0.1.1` 的路径保护正则只覆盖代码块、行内代码、URL、盘符绝对路径（`C:\…`、`D:/…`）和以 `./` `../` `/` 开头的路径。编码类草稿里最常见的裸相对路径完全不保护：

```
"修改 package.json 里的 scripts"       =>  []
"看看 src/index.ts 的实现"             =>  []
"不要改 src/a.ts"                      =>  []
```

更严重的是**部分保护**造成静默改写。`src/core/generation.ts` 只匹配到 `/core/generation.ts`，前面的 `src` 裸露在外：

```
原稿  : 更新 src/core/generation.ts 的实现
masked: 更新 src⟪DSH_KEEP_0⟫ 的实现
模型把 src 改成 lib → 恢复成 lib/core/generation.ts   ← 不报错，路径已错
```

**修复**：新增四条规则——带扩展名的相对路径、无扩展名的深层相对路径、带已知扩展名的裸文件名、已知的无扩展名工程文件（`LICENSE`、`Makefile` 等）。扩展名用**闭集**而非形状猜测，避免把 `e.g.` 这类普通缩写误判成文件。

**验证**：`tests/core.test.ts` 新增 3 条用例，覆盖 6 种路径形态、`e.g.`/`i.e.` 不误保护、以及"目录部分不得裸露"的回归。core 用例 25 → 28。

### 2. 一次瞬时 status 轮询失败会静默杀死在途优化（`src/browser/controller.ts`）

**问题**：状态轮询每 900ms 一次。`refresh()` 的 `catch` 分支注释写着"失败的 status 读取不构成草稿/模型/回合变化的证据"，但紧接着调用 `invalidate(false)`，而 `invalidate` 第一行就是 `cancelActive()`。实测：点"优化"→ 一次网络抖动 → 请求被 abort、按钮复位、**没有任何提示**，用户的操作无声消失。

**修复**：`invalidate` 增加 `cancelInFlight` 参数。瞬时 status 失败走 `invalidate(false, false)`：清掉自动建议缓存（灰字便宜且必须随连接失效而消失），但保留在途的手动优化。真正的状态变化路径仍完整取消。

**验证**：`tests/browser-controller.test.ts` 新增 1 条用例，断言失败轮询后 `busy` 仍为 `optimize`、请求 `signal.aborted === false`、随后正常完成并生成改动记录。controller 用例 35 → 36。

### 3. `debounceMs > 900` 时输入续写完全失效（`src/browser/controller.ts`）

**问题**：`driveSuggestions()` 第一行无条件 `clearTimer()`，末尾才重新 `setTimeout`。而它每 900ms 被状态轮询调用一次，于是**任何超过 900ms 的 debounce 定时器每 900ms 被清掉重建，永远等不到触发**。实测阈值是断崖式：

```
debounce=899 → 1 次调用     debounce=901 → 0 次调用
debounce=900 → 1 次调用     debounce=2000/5000 → 0 次调用
```

设置页把"续写停顿"暴露为 **200–5000 ms**，也就是说用户按界面允许的范围调大停顿，续写功能会悄悄消失且没有任何提示。默认 600ms 在安全区，所以既有测试发现不了。

**修复**：记住已武装定时器对应的 cache key（`timerKey`）。`driveSuggestions()` 在各提前返回分支显式 `clearTimer()`；只有 key 变化时才重排定时器，key 未变则保留已武装的那个。

**验证**：新增 2 条用例——`debounceMs` 取 200/600/900/1000/2000/5000 时 20 次轮询后都恰好触发 1 次；以及草稿在定时器触发前变化时会正确重排并携带新草稿。controller 用例 36 → 43。

### 4. 存储中的未知配置键会锁死整个插件（`src/core/config.ts`、`src/host/storage.ts`）

**问题**：`resolveConfig` 对未知键直接抛 `CONFIG`，而设置是整份对象持久化的。版本漂移（新版本写入新键后用户降级，或记录被部分写入）会导致 `settings/get`、`status`、`generate`、`drafts/*` 全部失败，设置页也加载不出来，且**无法通过保存自愈**——`updateSettings` 把含坏键的旧对象再 merge 回去。

**修复**：拆成两个入口。`resolveConfig` 保持严格（插件自身 Cordis 配置与每次 `settings/set` 补丁，调用方写错必须报错）；新增 `resolveStoredConfig` 用于**读取已存记录**——未知键忽略、单字段非法回退默认值、`provider`/`model` 半填对回退为跟随输入框。下一次成功保存会重写成干净记录。

**验证**：`tests/host-storage.test.ts` 新增 5 条用例：未知键不锁死、保存后坏键消失、逐字段回退、半填对丢弃、显式补丁仍严格。storage 用例 4 → 9。

### 5. 中文 diff 粒度过粗（`src/core/diff.ts`）

**问题**：分词正则把不含空格的整段中文当作一个 token，于是 `请解释缓存机制` → `请说明缓存机制` 被渲染成整短语删除 + 整短语插入，中文用户基本看不出改了什么。

**修复**：CJK 按码点切分，保留拉丁词/空白/标点的分组；同时先裁剪相同前后缀再做 DP，并保留超限时的降级路径（先句级，再整段替换），使最大长度草稿也不会卡住。

**验证**：现有 diff 用例（无损重建、emoji 代理对不拆分）继续通过；人工核对 `解释`→`说明`、`不要修改`→`保持现有` 已是词级粒度。

### 6. 无界集合与调度器语义（`src/browser/controller.ts`、`src/core/scheduler.ts`、`src/host/runtime.ts`）

- `exposed` 与 `nextTurns` 两个 Set 只增不减。加入 512 上限，与既有的 `completionCache` 64 上限保持一致。
- `settings/set` 原来调用 `scheduler.dispose()`，语义上是"销毁调度器"却当"取消在途"用。拆出 `cancelAll()` 表达真实意图并补注释说明为何设置变更要取消所有会话的在途请求。

## 未改变的边界

以下与 `0.1.1` 一致，没有因为本次修正而变化：

- 60 条固定合成质量集仍为 `not_evaluated`（0/60）。本次修正**没有**新增任何真实模型调用，也没有做人工语义标注。
- 6 次小样本对照结论不变：只能说明接线可用，不能证明同类领先。
- 未验证项仍是未验证：中文 IME 候选组合、附件/引用组合、完整官方 Web 组合、其他插件组合、非 Windows x64 平台。
- 本次修正未在官方桌面端重新做原生手测；相关证据仍是 `0.1.1` 时期记录，版本号与哈希需以新的 `verification.json` 为准。

## 复现命令

```powershell
# 类型检查与构建
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs

# 全部自动化测试（121 条）
node node_modules/vitest/vitest.mjs run

# 实际打包产物的 Loader 校验
node scripts/verify-package.mjs dist/dsh-input-assistant-0.1.2.tgz

# 真实 Edge 中的编辑器回归
node scripts/smoke-web.mjs

# 评测集结构校验（0 次模型调用）
node scripts/evaluate.mjs validate
```
