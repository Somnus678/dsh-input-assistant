// @vitest-environment jsdom
import { useSyncExternalStore, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantOverlay, AssistantRight } from '../src/browser/components'
import { BrowserRuntime, type ConnectionFace } from '../src/browser/runtime'
import { DEFAULT_CONFIG, type AssistantStatus, type GenerationRequest, type StoredDraft, type TokenSpan } from '../src/core/types'
import type { BrowserInput } from '../src/browser/controller'

const runtimes: BrowserRuntime[] = []
afterEach(() => { cleanup(); runtimes.splice(0).forEach(runtime => runtime.dispose()); document.body.innerHTML = '' })

function store<T>(value: T) {
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; listeners.forEach(listener => listener()) } }
}
function uiFixture(text: string, mode: 'ghost' | 'panel' = 'panel', suggestions = false, delayGeneration = false, saved: StoredDraft[] = []) {
  const inputStore = store<BrowserInput>({ draft: text, draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [] })
  const sessionStore = store({ running: false, removed: false })
  let span: TokenSpan = { start: text.length, end: text.length, draftRev: 1 }
  const generated: GenerationRequest[] = []
  let finishGeneration: (() => void) | undefined
  let finishSave: (() => void) | undefined
  let savingDelayed = false
  let mutationDelayed = false
  let finishMutation: (() => void) | undefined
  let suggested = '请继续解释'
  let generationFailures = 0
  let restoreFailure = false
  let drafts = [...saved]
  const generation = { id: 1 }
  const status: AssistantStatus = { sourceTurnId: 'turn-1', running: false, generation: 'mount-1',
    route: { provider: 'test', model: 'fast' }, settings: { ...DEFAULT_CONFIG, nextEnabled: suggestions, completionEnabled: suggestions, displayMode: mode } }
  const connection: ConnectionFace = {
    generation: { getSnapshot: () => generation, subscribe: () => () => {} },
    rpc: { call: vi.fn(async (_channel, _endpoint, envelope) => {
      const request = (envelope as { args: { payload: { method: string; data: unknown } } }).args.payload
      if (request.method === 'status') return { ok: true as const, value: status }
      if (request.method === 'drafts/list') return { ok: true as const, value: drafts }
      if (request.method === 'drafts/save') {
        if (savingDelayed) await new Promise<void>(resolve => { finishSave = resolve })
        const text = (request.data as { text: string }).text
        drafts = [...drafts, { id: 'new-save', text, createdAt: 1 }]
        return { ok: true as const, value: drafts }
      }
      if (request.method === 'drafts/delete') {
        if (mutationDelayed) await new Promise<void>(resolve => { finishMutation = resolve })
        const id = (request.data as { id: string }).id
        const removed = drafts.filter(draft => draft.id === id)
        drafts = drafts.filter(draft => draft.id !== id)
        return { ok: true as const, value: { drafts, removed } }
      }
      if (request.method === 'drafts/restore') {
        if (mutationDelayed) await new Promise<void>(resolve => { finishMutation = resolve })
        if (restoreFailure) return { ok: false as const, error: { message: '当前会话暂存空间不足，请删除一条后再撤销' } }
        drafts = [...drafts, ...(request.data as { drafts: StoredDraft[] }).drafts]
        return { ok: true as const, value: drafts }
      }
      if (request.method === 'generate') {
        const payload = request.data as GenerationRequest; generated.push(payload)
        if (generationFailures > 0) { generationFailures--; return { ok: false as const, error: { message: '提供商暂时不可用' } } }
        if (delayGeneration) await new Promise<void>(resolve => { finishGeneration = resolve })
        return { ok: true as const, value: { ...payload, text: payload.operation === 'optimize' ? '请改善表达，并保留原意' : suggested } }
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
  return { ...result, runtime, inputStore, generated, insertText, editor, finishGeneration: () => finishGeneration?.(),
    failNextGeneration: () => { generationFailures++ }, failRestore: () => { restoreFailure = true },
    delaySave: () => { savingDelayed = true }, finishSave: () => finishSave?.(),
    delayMutation: () => { mutationDelayed = true }, finishMutation: () => finishMutation?.(),
    setSuggestion: (text: string) => { suggested = text },
    updateDraft: (draft: string) => {
      const next = { ...inputStore.getSnapshot(), draft, draftRev: inputStore.getSnapshot().draftRev + 1 }
      span = { start: draft.length, end: draft.length, draftRev: next.draftRev }; editor.textContent = draft; inputStore.set(next)
    },
  }
}

describe('composed browser surfaces', () => {
  it('uses the independent prediction button without changing the draft before acceptance', async () => {
    const f = uiFixture('预测原稿', 'panel', false, true)
    const predict = screen.getByRole('button', { name: '预测' })
    await waitFor(() => expect((predict as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(predict)
    expect(f.generated).toHaveLength(1)
    expect(f.generated[0].manual).toBe(true)
    expect(f.inputStore.getSnapshot().draft).toBe('预测原稿')
    expect(screen.getByRole('button', { name: '取消预测' })).toBeTruthy()
    act(() => f.updateDraft('用户继续编辑'))
    await waitFor(() => expect((predict as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { f.finishGeneration(); await Promise.resolve() })
    expect(screen.queryByRole('button', { name: '采纳' })).toBeNull()
    expect(f.inputStore.getSnapshot().draft).toBe('用户继续编辑')
  })
  it('blocks the independent prediction entry during IME composition', async () => {
    const f = uiFixture('候选组合', 'panel', false)
    const predict = screen.getByRole('button', { name: '预测' })
    await waitFor(() => expect((predict as HTMLButtonElement).disabled).toBe(false))
    fireEvent.compositionStart(f.editor)
    expect((predict as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(predict)
    expect(f.generated).toHaveLength(0)
    fireEvent.compositionEnd(f.editor)
    expect((predict as HTMLButtonElement).disabled).toBe(false)
  })
  it('cancels only the pending clear while the durable stash finishes', async () => {
    const f = uiFixture('取消后保留这份草稿')
    f.delaySave()
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    fireEvent.click(await screen.findByRole('button', { name: '暂存并清空' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消清空' }))
    expect(f.inputStore.getSnapshot().draft).toBe('取消后保留这份草稿')
    expect((screen.getByRole('button', { name: '预测' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { f.finishSave(); await Promise.resolve() })
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().busy).toBeNull())
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.runtime.controllerFor('session-ui').getSnapshot().drafts[0].text).toBe('取消后保留这份草稿')
  })
  it('uses a full candidate panel for detailed multiline predictions and applies it only after acceptance', async () => {
    const f = uiFixture('解释方案', 'ghost', false)
    f.setSuggestion('：\n1. 说明原因\n2. 给出例子')
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().connected).toBe(true))
    act(() => f.runtime.applySettings({ ...f.runtime.controllerFor('session-ui').getSnapshot().settings, predictionDetail: 'detailed' }))
    fireEvent.click(screen.getByRole('button', { name: '预测' }))
    await screen.findByRole('button', { name: '采纳' })
    expect(document.querySelector('.dsh-ia-candidate')?.textContent).toContain('1. 说明原因')
    expect(document.querySelector('.dsh-ia-ghost')).toBeNull()
    expect(f.inputStore.getSnapshot().draft).toBe('解释方案')
    fireEvent.click(screen.getByRole('button', { name: '采纳' }))
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('解释方案：\n1. 说明原因\n2. 给出例子'))
  })
  it('does not advertise cancel-clear during a delete or undo mutation', async () => {
    const saved = { id: 'mutation-1', text: '存储操作中的草稿', createdAt: 1 }
    const f = uiFixture('当前输入', 'panel', false, false, [saved]); f.delayMutation()
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    fireEvent.click(await screen.findByText(saved.text, { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().busy).toBe('stash'))
    expect(screen.queryByRole('button', { name: '取消清空' })).toBeNull()
    await act(async () => { f.finishMutation(); await Promise.resolve() })
    fireEvent.click(await screen.findByRole('button', { name: '撤销删除' }))
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().busy).toBe('stash'))
    expect(screen.queryByRole('button', { name: '取消清空' })).toBeNull()
    await act(async () => { f.finishMutation(); await Promise.resolve() })
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().busy).toBeNull())
    expect(f.inputStore.getSnapshot().draft).toBe('当前输入')
  })
  it('generates one suggestion manually with automatic features disabled and retries a failed attempt explicitly', async () => {
    const f = uiFixture('解释时间', 'panel', false)
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().connected).toBe(true))
    f.failNextGeneration()
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    expect(screen.getByText('辅助模型：test / fast（跟随输入框）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }))
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().suggestionStatus).toBe('failed'))
    expect(screen.getByRole('button', { name: '重试建议' })).toBeTruthy()
    expect(screen.getByText('建议未完成')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    expect(screen.getByText(/建议请求未完成/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试本次建议' }))
    await screen.findByRole('button', { name: /^采纳$/ }, { timeout: 4000 })
    expect(f.generated).toHaveLength(2)
    expect(f.inputStore.getSnapshot().draft).toBe('解释时间')
    expect(f.insertText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^采纳$/ }))
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('解释时间请继续解释'))
  })
  it('copies a saved draft even when attachments prevent restoring it', async () => {
    const draft = { id: 'copy-1', text: '可直接取回的草稿', createdAt: 1 }, writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const f = uiFixture('保留当前输入', 'panel', false, false, [draft])
    act(() => f.inputStore.set({ ...f.inputStore.getSnapshot(), attachmentIds: ['attachment'] }))
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    fireEvent.click(await screen.findByText(draft.text, { selector: 'summary' }))
    expect((screen.getByRole('button', { name: '替换' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '复制草稿' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(draft.text))
    expect(f.inputStore.getSnapshot().draft).toBe('保留当前输入')
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('keeps failed undo text available for copying independently of newer deletions', async () => {
    const a = { id: 'a', text: '尚未恢复的原稿', createdAt: 1 }, b = { id: 'b', text: '用于释放空间的草稿', createdAt: 2 }
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const f = uiFixture('当前输入', 'panel', false, false, [a, b]); f.failRestore()
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    const summary = await screen.findByText(a.text, { selector: 'summary' })
    fireEvent.click(summary)
    fireEvent.click(within(summary.parentElement!).getByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '撤销删除' }))
    await screen.findByRole('button', { name: '复制待恢复草稿' })
    const second = await screen.findByText(b.text, { selector: 'summary' })
    fireEvent.click(second)
    fireEvent.click(within(second.parentElement!).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().deletedDrafts).toEqual([b]))
    fireEvent.click(screen.getByRole('button', { name: '复制待恢复草稿' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(a.text))
    expect(f.runtime.controllerFor('session-ui').getSnapshot().pendingUndoDrafts).toEqual([a])
    expect(f.inputStore.getSnapshot().draft).toBe('当前输入')
  })
  it('returns focus when a preview is invalidated but does not steal focus moved outside', async () => {
    const f = uiFixture('待优化草稿')
    const optimize = screen.getByRole('button', { name: '优化' })
    await waitFor(() => expect((optimize as HTMLButtonElement).disabled).toBe(false))
    optimize.focus(); fireEvent.click(optimize, { detail: 0 })
    const accept = await screen.findByRole('button', { name: '采纳优化' })
    await waitFor(() => expect(document.activeElement).toBe(accept))
    act(() => f.runtime.applySettings({ ...f.runtime.controllerFor('session-ui').getSnapshot().settings, optimizationStrength: 'deep' }))
    await waitFor(() => expect(document.activeElement).toBe(f.editor))
    optimize.focus(); fireEvent.click(optimize, { detail: 0 })
    await screen.findByRole('button', { name: '采纳优化' })
    const outside = document.createElement('button'); document.body.append(outside); outside.focus()
    act(() => f.runtime.applySettings({ ...f.runtime.controllerFor('session-ui').getSnapshot().settings, optimizationStrength: 'light' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '优化预览' })).toBeNull())
    expect(document.activeElement).toBe(outside)
  })
  it('previews without changing the draft and only writes after explicit acceptance', async () => {
    const f = uiFixture('请优化表达')
    await waitFor(() => expect((screen.getByRole('button', { name: '优化' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '优化' }))
    await screen.findByRole('dialog', { name: '优化预览' })
    expect(f.inputStore.getSnapshot().draft).toBe('请优化表达')
    expect(f.insertText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '采纳优化' }))
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('请改善表达，并保留原意'))
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    expect(screen.getByText('查看改动')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    await waitFor(() => expect(f.inputStore.getSnapshot().draft).toBe('请优化表达'))
    expect(f.generated).toHaveLength(1)
    expect(f.insertText).toHaveBeenCalledTimes(2)
  })
  it('dismisses a preview with Escape and preserves the original text', async () => {
    const f = uiFixture('保留原稿')
    await waitFor(() => expect((screen.getByRole('button', { name: '优化' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '优化' }))
    await screen.findByRole('dialog', { name: '优化预览' })
    fireEvent.keyDown(f.editor, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '优化预览' })).toBeNull()
    expect(f.inputStore.getSnapshot().draft).toBe('保留原稿')
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('offers cancellation and ignores the late result of a cancelled optimization', async () => {
    const f = uiFixture('取消后保留原稿', 'panel', false, true)
    await waitFor(() => expect((screen.getByRole('button', { name: '优化' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '优化' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消优化' }))
    await act(async () => { f.finishGeneration(); await Promise.resolve() })
    expect(screen.queryByRole('dialog', { name: '优化预览' })).toBeNull()
    expect(f.inputStore.getSnapshot().draft).toBe('取消后保留原稿')
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('moves keyboard focus into the menu and returns it to the trigger on Escape', async () => {
    uiFixture('草稿')
    const trigger = screen.getByRole('button', { name: '输入助手菜单' })
    trigger.focus()
    fireEvent.click(trigger, { detail: 0 })
    const dialog = await screen.findByRole('dialog', { name: '输入助手' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id)
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '输入助手' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('dismisses suggestions with Escape while respecting composition, native menus and consumed events', async () => {
    const f = uiFixture('', 'panel', true)
    await screen.findByRole('button', { name: '采纳' })
    const controller = f.runtime.controllerFor('session-ui')
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); consumed.preventDefault()
    fireEvent(f.editor, consumed)
    expect(controller.getSnapshot().suggestion).not.toBeNull()
    fireEvent.keyDown(f.editor, { key: 'Escape', isComposing: true })
    expect(controller.getSnapshot().suggestion).not.toBeNull()
    const native = document.createElement('div'); native.setAttribute('role', 'listbox'); f.editor.parentElement!.append(native)
    fireEvent.keyDown(f.editor, { key: 'Escape' })
    expect(controller.getSnapshot().suggestion).not.toBeNull()
    native.remove()
    fireEvent.keyDown(f.editor, { key: 'Escape' })
    expect(controller.getSnapshot().suggestion).toBeNull()
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('keeps deleted draft undo available after the quick menu closes', async () => {
    const draft = { id: 'saved-1', text: '保存的长草稿', createdAt: 1 }
    const f = uiFixture('当前输入', 'panel', false, false, [draft])
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    fireEvent.click(await screen.findByText(draft.text, { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await screen.findByRole('button', { name: '撤销删除' })
    fireEvent.click(screen.getByRole('button', { name: '输入助手菜单' }))
    expect(screen.queryByRole('dialog', { name: '输入助手' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '撤销删除' }))
    await waitFor(() => expect(f.runtime.controllerFor('session-ui').getSnapshot().drafts).toEqual([draft]))
    expect(screen.queryByRole('button', { name: '撤销删除' })).toBeNull()
    expect(f.inputStore.getSnapshot().draft).toBe('当前输入')
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
