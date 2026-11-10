# DSH Input Assistant

[简体中文](README.md) | English

Version 0.1.5 is based on the user-supplied original 0.1.4 package. Its original interface, settings, and direct-write interactions are retained; targeted reliability fixes have been applied. The separately published 0.1.4 was a different build that changed the interface.

## Features

- **Optimize:** rewrite the current draft or selection and insert the result immediately. Inspect changes or restore the original from the menu.
- **Predict:** the manual button inserts the prediction immediately. Automatic predictions can be shown as ghost text or in a panel and accepted with Tab.
- **Save drafts:** choose the save-and-clear action in the menu; each session stores up to three drafts for explicit restoration.
- **Settings:** choose detail level, presets, display mode, and a fixed auxiliary provider/model. Settings are global; the auxiliary route does not switch the conversation model.

Automatic suggestions are enabled by default and use the configured model. Drafts and settings are stored by the host. Model providers receive the relevant draft and conversation context. Review model output before sending it.

Entering or returning to a conversation, or loading an existing draft, does not by itself start a prediction. Automatic suggestions remain controlled by the original settings after real user input or a new response.

The package declares Node.js 22.19+ and DSH `>=0.2.1-rc.2 <0.3.0-0`. The local checks use simulated model outputs and do not establish real-model quality, native operating-system IME behavior, or complete desktop/plugin compatibility. The original archive lacked browser TypeScript source; see [source restoration](docs/source-restoration.md).

## Install

Build the current source with Node.js 22.19+ and pnpm:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination dist
dsh plugin --profile web add (Resolve-Path './dist/dsh-input-assistant-0.1.5.tgz').Path
```

For Windows desktop, use the CLI bundled with the desktop application and its `desktop` profile:

```powershell
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add (Resolve-Path './dist/dsh-input-assistant-0.1.5.tgz').Path
```

Completely quit and restart the relevant DSH instance after installation or upgrade. Published artifacts are available from [GitHub Releases](https://github.com/Somnus678/dsh-input-assistant/releases).

## Settings and original behavior

The switches, optimization strength, prediction detail, display mode, and auxiliary model settings apply globally. Presets modify the settings form and take effect on save. Automatic next-message prediction and completion are enabled by default. Manual prediction inserts its result directly, even when automatic suggestions are disabled.

Detailed mode retains the original length expansion: a next-message limit of 120 or less is treated as 400, and a completion limit of 80 or less is treated as 200. Character budgets are measured in Unicode code points. During a save-and-clear operation, cancellation preserves the editor contents even if the save completes.

## Validation and development

```powershell
pnpm typecheck
pnpm build
pnpm pack --pack-destination dist
pnpm test
pnpm test:package
pnpm test:web
pnpm test:package:web
```

The last two commands require Microsoft Edge. They exercise the original interface and its actual archive with a local RPC and simulated model output; Loader and Gateway tests cover host integration separately. The fixed 60-case real-model quality set remains unevaluated.

See [README.md](README.md), [validation](docs/validation.md), and [LICENSE](LICENSE).
