/** Loads plugin code only from the served tarball. No source runtime/component imports. */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as JSX from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { $getRoot, $createParagraphNode, $createTextNode, createEditor, HISTORY_PUSH_TAG } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'

const element = document.getElementById('editor')!
const editor = createEditor({ namespace: 'packaged-input-assistant', onError(error) { throw error } })
registerPlainText(editor); registerHistory(editor, createEmptyHistoryState(), 300); editor.setRootElement(element)
let input = { draft: '', draftRev: 0, phase: 'plain', occurrences: [], attachmentIds: [] }
const listeners = new Set<() => void>()
editor.registerUpdateListener(({ editorState }) => editorState.read(() => {
  const draft = $getRoot().getTextContent()
  if (input.draft === draft) return
  input = { ...input, draft, draftRev: input.draftRev + 1 }; listeners.forEach(fn => fn())
}))
const setDraft = (text: string) => editor.update(() => {
  $getRoot().clear().append($createParagraphNode().append($createTextNode(text))); $getRoot().selectEnd()
}, { discrete: true, tag: HISTORY_PUSH_TAG })
const captureInsertion = () => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
    return { start: input.draft.length, end: input.draft.length, draftRev: input.draftRev }
  }
  const range = selection.getRangeAt(0), prefix = range.cloneRange()
  prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  return { start, end: start + range.toString().length, draftRev: input.draftRev }
}
const actions = { captureInsertion, persistDraft() {}, insertText(text: string, span: { start: number; end: number; draftRev: number }) {
  if (span.draftRev !== input.draftRev) return false
  editor.update(() => {
    const root = $getRoot(), node = root.getAllTextNodes()[0]
    if (!node) root.append($createParagraphNode().append($createTextNode(text)))
    else node.select(span.start, span.end).insertText(text)
    root.selectEnd()
  }, { discrete: true, tag: HISTORY_PUSH_TAG })
  return true
} }
let core: any, plugin: any, runtime: any, settings: any, settingsRoot: ReturnType<typeof createRoot> | undefined
let turnId: string | null = '1'
let drafts: { id: string; text: string; createdAt: number }[] = []
const requests: any[] = []
const requestTimes: number[] = []
let delay = 30, rawOutput: string | null = null, echoTarget = false, failOnce = false, throttleMs = 0
let saveGate: Promise<void> | undefined, releaseSave: (() => void) | undefined
let statusGate: Promise<void> | undefined, releaseStatus: (() => void) | undefined, failStatus = false
const connection = {
  generation: { getSnapshot: () => ({ id: 1 }), subscribe: () => () => {} },
  rpc: { async call(_channel: string, _endpoint: string, envelope: any) {
    const { method, data } = envelope.args.payload
    let value: any
    try {
      switch (method) {
        case 'status':
          if (statusGate) await statusGate
          if (failStatus) { failStatus = false; throw new Error('delayed status failure') }
          value = { sourceTurnId: turnId, running: false, generation: 'packaged-host', settings: core.resolveStoredConfig(settings), route: { provider: 'fixture', model: 'main' } }; break
        case 'settings/get': value = core.resolveStoredConfig(settings); break
        case 'settings/set': settings = core.resolveConfig({ ...core.resolveStoredConfig(settings), ...data }); value = settings; break
        case 'models/list': value = { groups: [{ provider: 'fixture', name: 'Fixture', models: [{ id: 'main', name: 'Main' }, { id: 'auxiliary', name: 'Auxiliary' }] }], failures: [] }; break
        case 'drafts/list': value = drafts; break
        case 'drafts/save': {
          if (saveGate) await saveGate
          const item = { id: data.replaceId ?? String(Date.now()), text: data.text, createdAt: Date.now() }
          drafts = [...drafts.filter(draft => draft.id !== item.id), item]; value = drafts; break
        }
        case 'drafts/delete': case 'drafts/clear': {
          const removed = drafts.filter(draft => method === 'drafts/clear' || draft.id === data.id)
          drafts = drafts.filter(draft => !removed.includes(draft)); value = { drafts, removed }; break
        }
        case 'drafts/restore': {
          const combined = [...drafts, ...data.drafts.filter((draft: any) => !drafts.some(current => current.id === draft.id))]
          if (combined.length > 3) throw new Error('暂存空间不足')
          drafts = combined; value = drafts; break
        }
        case 'cancel': value = { cancelled: true }; break
        case 'generate': {
          requests.push(data)
          requestTimes.push(Date.now())
          if (failOnce) { failOnce = false; throw new Error('本地模拟提供商错误') }
          if (throttleMs) { const retryAfterMs = throttleMs; throttleMs = 0; return { ok: true, value: { ...data, text: null, outcome: 'throttled', retryAfterMs } } }
          const prepared = core.prepareGeneration(data, [], core.resolveStoredConfig(settings))
          // Capture configuration before the provider starts, as the host does.
          // Deliberately finish cancelled requests to exercise late-result isolation.
          await new Promise(resolve => setTimeout(resolve, delay))
          const raw = echoTarget ? JSON.parse(prepared.input).targetText : rawOutput ?? (data.operation === 'optimize' ? '请说明缓存机制，保持现有接口不变。' : data.operation === 'next' ? '请补充缓存失效的例子。' : '复杂度。')
          const text = core.finishGeneration(raw, prepared)
          value = { ...data, text, outcome: text === null ? 'abstained' : 'suggestion' }; break
        }
        default: throw new Error(`Unknown fixture method ${method}`)
      }
      return { ok: true, value }
    } catch (error) { return { ok: false, error: { message: error instanceof Error ? error.message : '本地夹具错误' } } }
  } },
}
const current = { current: { provider: 'fixture', model: 'main' } }
const models = { directoryFor: () => ({ store: { getSnapshot: () => current, subscribe: () => () => {} }, load: async () => {} }) }
const registered = new Map<string, { options: any; Component: any }>()
const useInput = (selector: any) => selector(React.useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => input))
const useSession = (selector: any) => selector({ running: false, removed: false })
const ctx = { get: (name: string) => {
    if (name === 'connection') return connection
    if (name === 'modelDirectories') return models
    throw new Error(`Unexpected service ${name}`)
  }, effect: (effect: any) => effect(),
  slots: { inject: (_name: string, effect: any) => effect(), register: (options: any, Component: any) => registered.set(options.name, { options, Component }) },
}
Object.assign(window, { __ModuleLoader__: { load(module: any) {
  if (module.id !== 'dsh-input-assistant') throw new Error('Unexpected packaged module')
  plugin = module.factory((id: string) => {
    if (id === 'react') return React
    if (id === 'react-dom') return ReactDOM
    if (id === 'react/jsx-runtime') return JSX
    throw new Error(`Unexpected shared dependency ${id}`)
  })
} } })
const fixture = {
  mount(actualCore: any) {
    const params = new URLSearchParams(location.search)
    if (params.has('noTurn')) turnId = null
    core = actualCore; settings = { ...core.DEFAULT_CONFIG, nextEnabled: params.has('auto'), completionEnabled: params.has('auto'), debounceMs: 200, minIntervalMs: 500 }
    if (params.has('draft')) { setDraft('已有草稿'); element.focus() }
    plugin.apply(ctx)
    for (const [slot, id] of [['conversation.input.right', 'right'], ['conversation.input.overlay', 'overlay']]) {
      const { options, Component } = registered.get(slot)!, injection = options.inject(); runtime = injection.runtime
      createRoot(document.getElementById(id)!).render(React.createElement(Component, { ...injection, sessionId: 'package-smoke', useInput, useSession, inputActions: actions }))
    }
  },
  setDraft, draft: () => input.draft, requests: () => requests, requestTimes: () => requestTimes,
  controller: () => runtime.controllerFor('package-smoke'),
  async config(update: any) { await runtime.saveSettings(update); await runtime.controllerFor('package-smoke').refresh() },
  focus() { element.focus(); editor.update(() => $getRoot().selectEnd(), { discrete: true }) },
  setDelay(ms: number) { delay = ms }, output(text: string) { rawOutput = text }, echoTarget() { echoTarget = true },
  async setTurn(id: string | null) { turnId = id; await runtime.controllerFor('package-smoke').refresh() },
  deferStatusFailure() { failStatus = true; statusGate = new Promise(resolve => { releaseStatus = resolve }) },
  releaseStatus() { releaseStatus?.(); statusGate = undefined },
  failNext() { failOnce = true }, throttleOnce(ms: number) { throttleMs = ms },
  deferSave() { saveGate = new Promise(resolve => { releaseSave = resolve }) }, releaseSave() { releaseSave?.(); saveGate = undefined },
  drafts: () => drafts, mainRoute: () => current.current,
  showSettings() {
    document.getElementById('clipper')!.style.display = 'none'
    const { options, Component } = registered.get('settings.section')!
    settingsRoot ??= createRoot(document.getElementById('settings')!)
    settingsRoot.render(React.createElement(Component, { ...options.inject(), close() {} }))
  },
}
Object.assign(window, { fixture })
