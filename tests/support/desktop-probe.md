这是临时测试插件，既不是正式插件的生产入口，也不调用模型。运行前必须先安装正式 `.tgz`，并在当前桌面 profile 的用户 `cordis.patch.yml` 中设置：

```yaml
- id: input-assistant
  name: dsh-input-assistant
  config:
    nextEnabled: false
    completionEnabled: false
```

用户层在 bundle 层之后应用。官方 `applyEntryPatches` 按 id 定位并替换 `config`；其余设置由插件的 Config 默认补齐。已有私有设置记录会优先，需要在插件自身配置中关闭两项开关。

安装确认后运行 `node tests/support/run-desktop-probe.mjs`。驱动脚本只向确认的 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加一个带 UUID 标记的独立 entry。该 entry 使用此处 `desktop-probe.mjs` 的 file URL，由当前运行中的桌面 Host 热加载。报告含执行该插件的真实 PID、可执行文件路径；不会输出命令行、凭据、用户会话内容或模型配置。

探测通过官方 Gateway 的独立 owner Peer 调用 settings/get、status 和草稿 CRUD。会话由 prepare + enter 创建，不 announce、不创建 Agent，也不写会话事件。完成后删除该会话的草稿记录、移除临时会话并销毁 Peer。驱动脚本 finally 移除自己的完整 UUID patch block，保留并发发生的其他配置修改；原文件备份与报告保留在工作区 `.test-runtime/desktop-probe-UUID/` 供审查。

驱动等待最多 45 秒。若程序被外部强制终止，可根据备份和 UUID 标记移除残留测试 entry；不可覆盖其他人新修改的整份用户配置。测试通过可证明当前桌面 Host 的安装、Gateway 和真实存储工作正常，不能替代真实桌面输入框的编辑、撤销、IME 或 Tab 回归。
