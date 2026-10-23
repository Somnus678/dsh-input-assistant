// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type AssistantStatus, type GenerationRequest, type GenerationResult, type StoredDraft, type TokenSpan } from '../src/core/types'
import { InputAssistantController, type BrowserBinding, type BrowserTransport } from '../src/browser/controller'

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const controllers: InputAssistantController[] = []
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); document.body.innerHTML = ''; vi.useRealTimers() })

function fixture(text = '请改善这段说明', automatic = false) {
  document.body.innerHTML = '<div data-composer-card><div contenteditable="true" tabindex="0" data-composer-input></div></div>'
  const editor = document.querySelector<HTMLElement>('[data-composer-input]')!
  editor.textContent = text
  editor.focus()
  let generation: string | null = '1'
  let status: AssistantStatus = { sourceTurnId: 'turn-1', generation: 'mount-1', running: false,
    settings: { ...DEFAULT_CONFIG, nextEnabled: automatic, completionEnabled: automatic }, route: { provider: 'mock', model: 'fast' } }
  let span: TokenSpan = { start: text.length, end: text.length, draftRev: 1 }
  let stored: StoredDraft[] = []
  let saveFailure = false
  let statusFailure = false
  let delayedStatus: ReturnType<typeof deferred<AssistantStatus>> | null = null
  let delayedSave: ReturnType<typeof deferred<StoredDraft>> | null = null
  const pending: { request: GenerationRequest; signal?: AbortSignal; task: ReturnType<typeof deferred<GenerationResult>> }[] = []
  const calls: { method: string; data: unknown }[] = []
  const insertText = vi.fn((value: string, target: TokenSpan) => {
    if (target.draftRev !== binding.input.draftRev) return false
    const next = binding.input.draft.slice(0, target.start) + value + binding.input.draft.slice(target.end)
    queueMicrotask(() => update(next, target.start + value.length))
    return true
  })
  let binding: BrowserBinding = { sessionId: 'session-a', editor, running: false, route: status.route,
    input: { draft: text, draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [] },
    actions: { captureInsertion: () => ({ ...span }), insertText, persistDraft: vi.fn() } }
  const transport: BrowserTransport = {
    generation: () => generation,
    async call<T>(method: string, data: unknown, signal?: AbortSignal): Promise<T> {
      calls.push({ method, data })
      if (method === 'status') { if (statusFailure) { statusFailure = false; throw new Error('status temporarily unavailable') }; return delayedStatus ? delayedStatus.promise as Promise<T> : status as T }
      if (method === 'generate') { const task = deferred<GenerationResult>(); pending.push({ request: data as GenerationRequest, signal, task }); return task.promise as Promise<T> }
      if (method === 'cancel') return {} as T
      if (method === 'drafts/list') return stored as T
      if (method === 'drafts/save') {
        if (saveFailure) throw new Error('保存失败')
        const value = data as { text: string; replaceId?: string }
        const draft = { id: value.replaceId ?? 'draft-1', text: value.text, createdAt: Date.now() }
        if (delayedSave) await delayedSave.promise
        stored = [...stored.filter(item => item.id !== draft.id), draft]
        return draft as T
      }
      if (method === 'drafts/delete') { stored = stored.filter(item => item.id !== (data as { id: string }).id); return {} as T }
      if (method === 'drafts/clear') { stored = []; return {} as T }
      if (method === 'settings/set') { status = { ...status, settings: { ...status.settings, ...data as object } }; return status.settings as T }
      throw new Error(`Unexpected ${method}`)
    },
  }
  const controller = new InputAssistantController('session-a', transport)
  controllers.push(controller)
  function select(start: number, end = start) {
    span = { start, end, draftRev: binding.input.draftRev }
    if (editor.firstChild) {
      const range = document.createRange(); range.setStart(editor.firstChild, Math.min(start, editor.textContent!.length)); range.setEnd(editor.firstChild, Math.min(end, editor.textContent!.length))
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    }
  }
  function update(value: string, caret = value.length) {
    binding = { ...binding, input: { ...binding.input, draft: value, draftRev: binding.input.draftRev + 1 } }
    editor.textContent = value
    select(caret)
    controller.bind(binding)
  }
  select(text.length)
  controller.bind(binding)
  return { controller, pending, calls, insertText, update, select, editor,
    get binding() { return binding },
    setStatus: (change: Partial<AssistantStatus>) => { status = { ...status, ...change } },
    setGeneration: (value: string | null) => { generation = value; controller.bind(binding) },
    setAttachments: () => { binding = { ...binding, input: { ...binding.input, attachmentIds: ['image'] } }; controller.bind(binding) },
    setReferences: () => { binding = { ...binding, input: { ...binding.input, occurrences: [{ offset: 0, length: 4 }] } }; controller.bind(binding) },
    failSave: () => { saveFailure = true }, delaySave: () => { delayedSave = deferred<StoredDraft>(); return delayedSave },
    failStatusOnce: () => { statusFailure = true },
    delayStatus: () => { delayedStatus = deferred<AssistantStatus>(); return delayedStatus },
    resolve: (index: number, result: string | null) => pending[index].task.resolve({ ...pending[index].request, text: result }),
  }
}

describe('browser editor transactions', () => {
  it('rejects an old status reply after disabling stash and does not clear a late saved draft', async () => {
    const f = fixture(); await f.controller.refresh()
    const oldStatus = f.controller.getSnapshot().status!, saved = f.delaySave()
    const stash = f.controller.stash()
    const delayedStatus = f.delayStatus(), refresh = f.controller.refresh()
    await f.controller.updateSettings({ stashEnabled: false })
    delayedStatus.resolve(oldStatus); await refresh
    expect(f.controller.getSnapshot().settings.stashEnabled).toBe(false)
    saved.resolve({ id: 'draft-1', text: '', createdAt: 0 }); await stash
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot().drafts).toHaveLength(1)
  })
  it('preserves the input if a pending stash finishes during settings review', async () => {
    const f = fixture(); await f.controller.refresh(); const saved = f.delaySave()
    const stash = f.controller.stash(); f.controller.beginSettingsUpdate()
    saved.resolve({ id: 'draft-1', text: '', createdAt: 0 }); await stash
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.binding.input.draft).toBe('请改善这段说明')
    f.controller.endSettingsUpdate()
  })
  it('keeps an in-flight manual optimization alive across one failed status poll', async () => {
    const f = fixture(); await f.controller.refresh()
    const task = f.controller.optimize()
    expect(f.pending).toHaveLength(1)
    const signal = f.pending[0].signal
    expect(f.controller.getSnapshot().busy).toBe('optimize')
    f.failStatusOnce(); await f.controller.refresh()
    // The transient error must not abort the manual request the user is waiting on.
    expect(signal?.aborted).toBe(false)
    expect(f.controller.getSnapshot().busy).toBe('optimize')
    f.resolve(0, '请说明这样修改的原因。'); await task
    expect(f.controller.getSnapshot().busy).toBeNull()
    expect(f.controller.getSnapshot().change?.afterTarget).toBe('请说明这样修改的原因。')
  })
  it('enforces independent optimization and stash switches without hiding saved drafts', async () => {
    const f = fixture(); await f.controller.refresh()
    await f.controller.stash(); await flush()
    const saved = f.controller.getSnapshot().drafts[0]
    f.update('继续输入')
    await f.controller.updateSettings({ optimizeEnabled: false, stashEnabled: false })
    await f.controller.optimize(); await f.controller.stash()
    expect(f.pending).toHaveLength(0)
    expect(f.calls.filter(call => call.method === 'drafts/save')).toHaveLength(1)
    expect(f.controller.restoreDraft(saved, 'replace')).toBe(false)
    expect(f.binding.input.draft).toBe('继续输入')
    await f.controller.deleteDraft(saved.id)
    expect(f.controller.getSnapshot().drafts).toHaveLength(0)
  })
  it('keeps UTF-16 insertion offsets while counting emoji budgets as Unicode characters', async () => {
    vi.useFakeTimers(); const text = '😀'.repeat(100), f = fixture(text, true)
    f.setStatus({ settings: { ...DEFAULT_CONFIG, maxDraftChars: 100 } }); await f.controller.refresh()
    await vi.advanceTimersByTimeAsync(600)
    expect(f.pending[0].request.operation).toBe('complete')
    expect(f.pending[0].request.span.end).toBe(200)
    const task = f.controller.optimize(); f.resolve(1, '改进后的表达'); await task; await flush()
    expect(f.insertText).toHaveBeenCalledWith('改进后的表达', { start: 0, end: 200, draftRev: 1 })
  })
  it('keeps the completed diff restorable when optimization is subsequently disabled', async () => {
    const f = fixture(); await f.controller.refresh()
    const task = f.controller.optimize(); f.resolve(0, '优化后的内容'); await task; await flush()
    await f.controller.updateSettings({ optimizeEnabled: false })
    expect(f.controller.canRestore()).toBe(true)
    expect(f.controller.restoreOriginal()).toBe(true)
    await flush(); expect(f.binding.input.draft).toBe('请改善这段说明')
  })
  it('replaces a full plain draft in a versioned edit and restores only the unchanged result', async () => {
    const f = fixture(); await f.controller.refresh()
    const task = f.controller.optimize(); f.resolve(0, '请用简洁的语言改善这段说明'); await task; await flush()
    expect(f.insertText).toHaveBeenCalledWith('请用简洁的语言改善这段说明', { start: 0, end: '请改善这段说明'.length, draftRev: 1 })
    expect(f.controller.canRestore()).toBe(true)
    expect(f.controller.restoreOriginal()).toBe(true); await flush()
    expect(f.binding.input.draft).toBe('请改善这段说明')
    expect(f.controller.getSnapshot().change).toBe(null)
  })
  it('does not overwrite edits made while the model is generating', async () => {
    const f = fixture(); await f.controller.refresh()
    const task = f.controller.optimize(); f.update('用户新写的内容'); f.resolve(0, '迟到的优化'); await task
    expect(f.pending[0].signal?.aborted).toBe(true)
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.binding.input.draft).toBe('用户新写的内容')
  })
  it('does not apply an old result after the source turn advances', async () => {
    const f = fixture(); await f.controller.refresh()
    const task = f.controller.optimize(); f.setStatus({ sourceTurnId: 'turn-2' }); await f.controller.refresh(); f.resolve(0, '旧结果'); await task
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('keeps a newer optimization busy when a cancelled older optimization settles', async () => {
    const f = fixture(); await f.controller.refresh()
    const first = f.controller.optimize(); f.update('第二份草稿'); const second = f.controller.optimize()
    f.resolve(0, '旧结果'); await first
    expect(f.controller.getSnapshot().busy).toBe('optimize')
    expect(f.insertText).not.toHaveBeenCalled()
    f.resolve(1, '第二份优化结果'); await second; await flush()
    expect(f.controller.getSnapshot().busy).toBeNull()
    expect(f.binding.input.draft).toBe('第二份优化结果')
  })
  it('cancels and rejects late results after a physical reconnect', async () => {
    const f = fixture(); await f.controller.refresh()
    const task = f.controller.optimize(); f.setGeneration('2'); f.resolve(0, '旧连接结果'); await task
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('never falls back to a whole-draft setter when insertText rejects', async () => {
    const f = fixture(); await f.controller.refresh(); f.insertText.mockReturnValue(false)
    const task = f.controller.optimize(); f.resolve(0, '优化'); await task
    expect(f.insertText).toHaveBeenCalledTimes(1)
    expect(f.controller.getSnapshot().change).toBeNull()
    expect(f.binding.input.draft).toBe('请改善这段说明')
  })
  it('optimizes the selected text without changing surrounding text', async () => {
    const f = fixture('前面 要优化的句子 后面'); await f.controller.refresh(); f.select(3, 9)
    const task = f.controller.optimize(); expect(f.pending[0].request.targetText).toBe('要优化的句子')
    f.resolve(0, '更清晰的句子'); await task; await flush()
    expect(f.binding.input.draft).toBe('前面 更清晰的句子 后面')
  })
  it('blocks full rewrites of reference-bearing drafts', async () => {
    const f = fixture(); await f.controller.refresh(); f.setReferences(); await f.controller.optimize()
    expect(f.pending).toHaveLength(0)
    expect(f.controller.getSnapshot().notice).toContain('引用标签')
  })
  it('preserves ordinary attachments during a text optimization', async () => {
    const f = fixture(); await f.controller.refresh(); f.setAttachments()
    const task = f.controller.optimize(); f.resolve(0, '请改进说明'); await task; await flush()
    expect(f.binding.input.attachmentIds).toEqual(['image'])
  })
  it('prevents restore from overwriting later user edits', async () => {
    const f = fixture(); await f.controller.refresh(); const task = f.controller.optimize(); f.resolve(0, '优化完成'); await task; await flush()
    f.update('继续写的新内容')
    expect(f.controller.canRestore()).toBe(false)
    expect(f.controller.restoreOriginal()).toBe(false)
    expect(f.binding.input.draft).toBe('继续写的新内容')
  })
  it('does not restore an old optimization across a new turn or reconnect', async () => {
    const f = fixture(); await f.controller.refresh(); const task = f.controller.optimize(); f.resolve(0, '优化完成'); await task; await flush()
    f.setStatus({ sourceTurnId: 'turn-2' }); await f.controller.refresh()
    expect(f.controller.canRestore()).toBe(false)
    f.setGeneration('2')
    expect(f.controller.getSnapshot().status).toBeNull()
    expect(f.controller.restoreOriginal()).toBe(false)
  })
  it('does not send unrelated locked fragments to a different selected range', async () => {
    const f = fixture('保留这句，改写那句'); await f.controller.refresh(); f.select(0, 4); f.controller.lockSelection(); f.select(5, 9)
    const task = f.controller.optimize()
    expect(f.pending[0].request.lockedFragments).toEqual([])
    f.resolve(0, '改善那句'); await task
  })
  it('does not rewrite a selection cutting through a protected fragment', async () => {
    const f = fixture('保留这句，改写那句'); await f.controller.refresh(); f.select(0, 4); f.controller.lockSelection(); f.select(2, 7)
    await f.controller.optimize()
    expect(f.pending).toHaveLength(0)
    expect(f.controller.getSnapshot().notice).toContain('受保护片段')
  })
})

describe('draft persistence transactions', () => {
  it('keeps the original draft on persistence failure', async () => {
    const f = fixture(); await f.controller.refresh(); f.failSave(); await f.controller.stash()
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot().notice).toContain('保存失败')
  })
  it('saves before clearing and restores explicitly as append or replace', async () => {
    const f = fixture(); await f.controller.refresh(); await f.controller.stash(); await flush()
    expect(f.binding.input.draft).toBe('')
    const draft = f.controller.getSnapshot().drafts[0]
    expect(draft.text).toBe('请改善这段说明')
    f.update('临时问题')
    f.controller.restoreDraft(draft, 'append'); await flush()
    expect(f.binding.input.draft).toBe('临时问题\n请改善这段说明')
    f.controller.restoreDraft(draft, 'replace'); await flush()
    expect(f.binding.input.draft).toBe('请改善这段说明')
  })
  it('saves a snapshot without clearing edits made during the save', async () => {
    const f = fixture(); await f.controller.refresh(); const saved = f.delaySave()
    const task = f.controller.stash(); f.update('保存过程中修改的新稿'); saved.resolve({ id: 'draft-1', text: '', createdAt: 0 }); await task
    expect(f.insertText).not.toHaveBeenCalled()
    expect(f.binding.input.draft).toBe('保存过程中修改的新稿')
    expect(f.controller.getSnapshot().drafts[0].text).toBe('请改善这段说明')
  })
  it('refuses to stash or replace a draft containing attachments', async () => {
    const f = fixture(); await f.controller.refresh(); f.setAttachments(); await f.controller.stash()
    expect(f.calls.some(call => call.method === 'drafts/save')).toBe(false)
    expect(f.controller.restoreDraft({ id: 'x', text: 'saved', createdAt: 0 }, 'replace')).toBe(false)
  })
})

describe('shared suggestion scheduling', () => {
  it.each([200, 600, 900, 1000, 2000, 5000])('arms completion once when debounceMs=%i exceeds the 900ms status poll', async debounceMs => {
    vi.useFakeTimers()
    const f = fixture('请解释这段代码的时间', true)
    f.setStatus({ settings: { ...DEFAULT_CONFIG, nextEnabled: false, completionEnabled: true, debounceMs, minIntervalMs: 500 } })
    await f.controller.refresh()
    // Ten status polls would previously re-arm the timer every 900ms, so any
    // debounce above the poll interval could never reach its deadline.
    for (let poll = 0; poll < 20; poll++) { await vi.advanceTimersByTimeAsync(900); await f.controller.refresh() }
    expect(f.pending).toHaveLength(1)
    expect(f.pending[0].request.operation).toBe('complete')
    f.resolve(0, '复杂度。'); await flush()
    expect(f.controller.getSnapshot().suggestion?.text).toBe('复杂度。')
  })
  it('re-arms the completion timer when the draft changes before it fires', async () => {
    vi.useFakeTimers()
    const f = fixture('请解释', true)
    f.setStatus({ settings: { ...DEFAULT_CONFIG, nextEnabled: false, completionEnabled: true, debounceMs: 1000, minIntervalMs: 500 } })
    await f.controller.refresh()
    await vi.advanceTimersByTimeAsync(700)
    f.update('请解释这段')
    for (let poll = 0; poll < 5; poll++) { await vi.advanceTimersByTimeAsync(900); await f.controller.refresh() }
    expect(f.pending).toHaveLength(1)
    expect(f.pending[0].request.draft).toBe('请解释这段')
  })
  it('completes the first draft even before the session has a completed turn', async () => {
    vi.useFakeTimers(); const f = fixture('请帮我', true); f.setStatus({ sourceTurnId: null }); await f.controller.refresh()
    await vi.advanceTimersByTimeAsync(600)
    expect(f.pending).toHaveLength(1)
    expect(f.pending[0].request.sourceTurnId).toBeNull()
    expect(f.pending[0].request.operation).toBe('complete')
    f.resolve(0, '整理需求'); await flush()
    expect(f.controller.getSnapshot().suggestion?.text).toBe('整理需求')
  })
  it('generates once per completed turn and reuses matching prefixes', async () => {
    const f = fixture('', true); await f.controller.refresh(); expect(f.pending).toHaveLength(1)
    f.resolve(0, '请把方案合并进去'); await flush()
    expect(f.controller.getSnapshot().suggestion?.text).toBe('请把方案合并进去')
    await f.controller.refresh(); expect(f.pending).toHaveLength(1)
    f.update('请把')
    expect(f.controller.getSnapshot().suggestion?.text).toBe('方案合并进去')
    expect(f.pending).toHaveLength(1)
  })
  it('does not accept a suggestion after the caret moved without a draft revision', async () => {
    vi.useFakeTimers(); const f = fixture('请把', true); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(600)
    expect(f.pending).toHaveLength(1); f.select(1); f.controller.notifySelectionChange(); f.resolve(0, '方案合并进去'); await flush()
    expect(f.controller.getSnapshot().suggestion).toBeNull()
    expect(f.controller.acceptSuggestion()).toBe(false)
  })
  it('lets manual optimization cancel an in-flight completion', async () => {
    vi.useFakeTimers(); const f = fixture('请把', true); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(600)
    const task = f.controller.optimize(); expect(f.pending[0].signal?.aborted).toBe(true)
    f.resolve(0, '旧续写'); f.resolve(1, '请把方案合并进去'); await task; await flush()
    expect(f.controller.getSnapshot().suggestion).toBeNull()
    expect(f.insertText).toHaveBeenCalledTimes(1)
  })
  it('makes no completion calls while an IME composition is active', async () => {
    vi.useFakeTimers(); const f = fixture('请把', true); f.controller.setComposing(true); await f.controller.refresh()
    await vi.advanceTimersByTimeAsync(4000); expect(f.pending).toHaveLength(0)
    f.controller.setComposing(false); await vi.advanceTimersByTimeAsync(600); expect(f.pending).toHaveLength(1)
  })
  it.each(['辅助模型请求超时', '提供商暂时不可用'])('does not retry the unchanged draft after %s', async message => {
    vi.useFakeTimers(); const f = fixture('请把', true); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(600)
    expect(f.pending).toHaveLength(1)
    f.pending[0].task.reject(new Error(message)); await flush()
    for (let poll = 0; poll < 5; poll++) { await f.controller.refresh(); await vi.advanceTimersByTimeAsync(3000) }
    expect(f.pending).toHaveLength(1)
    expect(f.controller.getSnapshot().suggestion).toBeNull()
    f.update('请把方案')
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.pending).toHaveLength(2)
    f.resolve(1, null); await flush()
  })
  it('allows a new explicit settings change to retry a previously failed draft', async () => {
    vi.useFakeTimers(); const f = fixture('请把', true); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(600)
    f.pending[0].task.reject(new Error('提供商错误')); await flush()
    await f.controller.refresh(); await vi.advanceTimersByTimeAsync(3000)
    expect(f.pending).toHaveLength(1)
    f.setStatus({ settings: { ...DEFAULT_CONFIG, debounceMs: 700 } }); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(2000)
    expect(f.pending).toHaveLength(2)
    f.resolve(1, null); await flush()
  })
  it('does not clear a failed attempt merely because a status poll temporarily failed', async () => {
    vi.useFakeTimers(); const f = fixture('请把', true); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(600)
    f.pending[0].task.reject(new Error('辅助调用超时')); await flush()
    f.failStatusOnce(); await f.controller.refresh(); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(4000)
    expect(f.pending).toHaveLength(1)
  })
  it('does not record a cancelled old attempt as a failure for a new draft or its later return', async () => {
    vi.useFakeTimers(); const f = fixture('请把', true); await f.controller.refresh(); await vi.advanceTimersByTimeAsync(600)
    f.update('请把方案'); f.pending[0].task.reject(new Error('取消后的迟到错误')); await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.pending).toHaveLength(2)
    f.resolve(1, null); await flush()
    f.update('请把'); await vi.advanceTimersByTimeAsync(2000)
    expect(f.pending).toHaveLength(3)
    f.resolve(2, null); await flush()
  })
  it('stops suggestions and cancels all resources on disposal', async () => {
    const f = fixture('', true); await f.controller.refresh(); f.controller.dispose(); f.resolve(0, '迟到'); await flush()
    expect(f.pending[0].signal?.aborted).toBe(true)
    expect(f.insertText).not.toHaveBeenCalled()
  })
  it('dismisses suggestions disabled by a settings update from another window', async () => {
    const f = fixture('', true); await f.controller.refresh(); f.resolve(0, '请继续解释'); await flush()
    expect(f.controller.getSnapshot().suggestion).not.toBeNull()
    f.setStatus({ settings: { ...DEFAULT_CONFIG, nextEnabled: false } }); await f.controller.refresh()
    expect(f.controller.getSnapshot().suggestion).toBeNull()
    expect(f.controller.acceptSuggestion()).toBe(false)
  })
  it('counts actual presentations once and does not mistake a sent clear for edits', async () => {
    const f = fixture('', true); await f.controller.refresh(); f.resolve(0, '请继续解释'); await flush()
    expect(f.controller.getSnapshot().metrics.exposures).toBe(0)
    const id = f.controller.getSnapshot().suggestion!.snapshot.requestId
    f.controller.markExposed(id); f.controller.markExposed(id)
    expect(f.controller.getSnapshot().metrics.exposures).toBe(1)
    expect(f.controller.acceptSuggestion()).toBe(true); await flush()
    expect(f.controller.getSnapshot().metrics.accepted).toBe(1)
    f.update('请继续详细解释')
    expect(f.controller.getSnapshot().metrics.editedAcceptances).toBe(1)
    expect(f.controller.getSnapshot().metrics.editedCharacters).toBeGreaterThan(0)
    const edits = f.controller.getSnapshot().metrics.editedCharacters
    f.update('')
    expect(f.controller.getSnapshot().metrics.editedCharacters).toBe(edits)
    expect(f.calls.some(call => /metrics|telemetry/.test(call.method))).toBe(false)
  })
})
