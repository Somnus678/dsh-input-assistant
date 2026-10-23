// @vitest-environment jsdom
import { useSyncExternalStore, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantOverlay, AssistantRight } from '../src/browser/components'
import { BrowserRuntime, type ConnectionFace } from '../src/browser/runtime'
import { DEFAULT_CONFIG, type AssistantStatus, type GenerationRequest, type TokenSpan } from '../src/core/types'
import type { BrowserInput } from '../src/browser/controller'

const runtimes: BrowserRuntime[] = []
afterEach(() => { cleanup(); runtimes.splice(0).forEach(runtime => runtime.dispose()); document.body.innerHTML = '' })

function store<T>(value: T) {
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; listeners.forEach(listener => listener()) } }
}
function uiFixture(text: string, mode: 'ghost' | 'panel' = 'panel', suggestions = false) {
  const inputStore = store<BrowserInput>({ draft: text, draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [] })
  const sessionStore = store({ running: false, removed: false })
  let span: TokenSpan = { start: text.length, end: text.length, draftRev: 1 }
  const generated: GenerationRequest[] = []
  const generation = { id: 1 }
  const status: AssistantStatus = { sourceTurnId: 'turn-1', running: false, generation: 'mount-1',
    route: { provider: 'test', model: 'fast' }, settings: { ...DEFAULT_CONFIG, nextEnabled: suggestions, completionEnabled: suggestions, displayMode: mode } }
  const connection: ConnectionFace = {
    generation: { getSnapshot: () => generation, subscribe: () => () => {} },
    rpc: { call: vi.fn(async (_channel, _endpoint, envelope) => {
      const request = (envelope as { args: { payload: { method: string; data: unknown } } }).args.payload
      if (request.method === 'status') return { ok: true as const, value: status }
      if (request.method === 'drafts/list') return { ok: true as const, value: [] }
      if (request.method === 'generate') {
        const payload = request.data as GenerationRequest; generated.push(payload)
        return { ok: true as const, value: { ...payload, text: payload.operation === 'optimize' ? '请改善表达，并保留原意' : '请继续解释' } }
      }
      return { ok: true as const, value: {} }
    }) },
  }
  const runtime = new BrowserRuntime(connection); runtimes.push(runtime)
  const insertText = vi.fn((value: string, target: TokenSpan) => {
    const current = inputStore.getSnapshot()
    if (target.draftRev !== current.draftRev) return false
    const draft = current.draft.slice(0, target.start) + value + current.draft.slice(target.end)
    span = { start: target.start + value.length, end: target.start + value.length, draftRev: current.draftRev + 1 }
    const editor = document.querySelector<HTMLElement>('[data-composer-input]')!
    editor.textContent = draft
    inputStore.set({ ...current, draft, draftRev: current.draftRev + 1 })
    return true
  })
  const useInput = <T,>(selector: (value: BrowserInput) => T) => selector(useSyncExternalStore(inputStore.subscribe, inputStore.getSnapshot))
  const useSession = <T,>(selector: (value: { running: boolean; removed: boolean }) => T) => selector(useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot))
  const props = { runtime, sessionId: 'session-ui', useInput, useSession,
    inputActions: { captureInsertion: () => ({ ...span }), insertText, persistDraft: vi.fn() } } as unknown as ComponentProps<typeof AssistantRight>
  const result = render(<div data-composer-card=""><div data-composer-input="" contentEditable suppressContentEditableWarning tabIndex={0}>{text}</div>
    <AssistantRight {...props} /><AssistantOverlay {...props as unknown as ComponentProps<typeof AssistantOverlay>} /></div>)
  const editor = result.container.querySelector<HTMLElement>('[data-composer-input]')!
  act(() => { editor.focus(); fireEvent.focus(editor) })
  return { ...result, runtime, inputStore, generated, insertText, editor }
}

describe('composed browser surfaces', () => {
  it('optimizes through the real shared runtime and exposes changes and guarded restore', async () => {
    const f = uiFixture('请优化表达')
    await waitFor(() => expect((screen.getByRole('button', { name: '优化' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '优化' }))
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('请改善表达，并保留原意'))
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    expect(screen.getByText('查看改动')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('请优化表达'))
    expect(f.generated).toHaveLength(1)
    expect(f.insertText).toHaveBeenCalledTimes(2)
  })
  it('shares one generation between the toolbar and overlay and respects consumed Tab', async () => {
    const f = uiFixture('', 'panel', true)
    await screen.findByRole('button', { name: '采纳' })
    expect(f.generated).toHaveLength(1)
    const consumed = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); consumed.preventDefault()
    fireEvent(f.editor, consumed)
    expect(f.insertText).not.toHaveBeenCalled()
    const plain = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    fireEvent(f.editor, plain)
    expect(plain.defaultPrevented).toBe(true)
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('请继续解释'))
    expect(f.runtime.controllerFor('session-ui').getSnapshot().metrics.exposures).toBe(1)
  })
  it('does not capture Tab for a ghost hidden because layout could not be measured', async () => {
    const f = uiFixture('', 'ghost', true)
    await waitFor(() => expect(f.generated).toHaveLength(1))
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().suggestion).not.toBeNull())
    expect(document.querySelector('[data-dsh-ia-visible-suggestion]')).toBeNull()
    const key = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    fireEvent(f.editor, key)
    expect(key.defaultPrevented).toBe(false)
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.runtime.controllerFor('session-ui').getSnapshot().metrics.exposures).toBe(0)
  })
})
