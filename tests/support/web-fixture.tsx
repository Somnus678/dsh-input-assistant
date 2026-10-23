/** Integration fixture only: real Lexical + production React surfaces, local deterministic model. */
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { $getRoot, $createParagraphNode, $createTextNode, createEditor, HISTORY_PUSH_TAG } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { AssistantRight, AssistantOverlay } from '../../src/browser/components'
import { BrowserRuntime } from '../../src/browser/runtime'
import { DEFAULT_CONFIG, type AssistantConfig, type GenerationRequest } from '../../src/core/types'
import { STYLE_TEXT } from '../../src/browser/styles'

const element = document.getElementById('editor')!
const editor = createEditor({ namespace: 'input-assistant-fixture', onError(error) { throw error } })
registerPlainText(editor)
registerHistory(editor, createEmptyHistoryState(), 300)
editor.setRootElement(element)
let input = { draft: '', draftRev: 0, phase: 'plain', occurrences: [], attachmentIds: [] }
const listeners = new Set<() => void>()
editor.registerUpdateListener(({ editorState }) => editorState.read(() => {
  const draft = $getRoot().getTextContent()
  if (input.draft === draft) return
  input = { ...input, draft, draftRev: input.draftRev + 1 }
  listeners.forEach(listener => listener())
}))
const setDraft = (text: string) => editor.update(() => {
  $getRoot().clear().append($createParagraphNode().append($createTextNode(text)))
  $getRoot().selectEnd()
}, { discrete: true, tag: HISTORY_PUSH_TAG })
const captureInsertion = () => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return { start: input.draft.length, end: input.draft.length, draftRev: input.draftRev }
  const range = selection.getRangeAt(0)
  const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  return { start, end: start + range.toString().length, draftRev: input.draftRev }
}
const actions = {
  captureInsertion,
  insertText(text: string, span: { start: number; end: number; draftRev: number }) {
    if (span.draftRev !== input.draftRev) return false
    editor.update(() => {
      const root = $getRoot(), node = root.getAllTextNodes()[0]
      if (!node) root.append($createParagraphNode().append($createTextNode(text)))
      else node.select(span.start, span.end).insertText(text)
      root.selectEnd()
    }, { discrete: true, tag: HISTORY_PUSH_TAG })
    return true
  },
  persistDraft() {},
}
let settings: AssistantConfig = { ...DEFAULT_CONFIG, nextEnabled: false, completionEnabled: false }
let drafts: { id: string; text: string; createdAt: number }[] = []
let requests = 0
const connection = {
  generation: { getSnapshot: () => ({ id: 1 }), subscribe: () => () => {} },
  rpc: { async call(_channel: string, _endpoint: string, envelope: any) {
    const { method, data } = envelope.args.payload
    let value: any
    switch (method) {
      case 'status': value = { sourceTurnId: '1', running: false, settings, generation: 'fixture-host', route: { provider: 'fixture', model: 'local' } }; break
      case 'settings/set': settings = { ...settings, ...data }; value = settings; break
      case 'drafts/list': value = drafts; break
      case 'drafts/save': {
        const item = { id: data.replaceId || String(Date.now()), text: data.text, createdAt: Date.now() }
        drafts = data.replaceId ? drafts.map(d => d.id === data.replaceId ? item : d) : [...drafts, item]
        value = drafts; break
      }
      case 'drafts/delete': drafts = drafts.filter(d => d.id !== data.id); value = drafts; break
      case 'drafts/clear': drafts = []; value = drafts; break
      case 'cancel': value = { cancelled: true }; break
      case 'generate': {
        requests++
        const request = data as GenerationRequest
        await new Promise(resolve => setTimeout(resolve, 40))
        const text = request.operation === 'optimize' ? '请说明缓存机制，保持现有接口不变。' : request.operation === 'complete' ? '复杂度。' : '请补充缓存失效的例子。'
        value = { ...request, text }; break
      }
      default: throw new Error(`Unknown fixture method ${method}`)
    }
    return { ok: true as const, value }
  } },
}
const modelSnapshot = { current: { provider: 'fixture', model: 'local' } }
const runtime = new BrowserRuntime(connection, { directoryFor: () => ({ store: { getSnapshot: () => modelSnapshot, subscribe: () => () => {} }, load: async () => {} }) })
const useInput = (selector: any) => selector(useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => input))
const props: any = { runtime, sessionId: 'web-smoke', useInput, useSession: (selector: any) => selector({ running: false, removed: false }), inputActions: actions }
createRoot(document.getElementById('right')!).render(<AssistantRight {...props} />)
createRoot(document.getElementById('overlay')!).render(<AssistantOverlay {...props} />)
document.getElementById('styles')!.textContent = STYLE_TEXT
Object.assign(window, { fixture: { setDraft, draft: () => input.draft, requests: () => requests, runtime,
  focus() { element.focus(); editor.update(() => $getRoot().selectEnd(), { discrete: true }) },
} })
