import {
  DEFAULT_CONFIG, type AssistantConfig, type AssistantStatus, type GenerationRequest,
  type GenerationResult, type InputSnapshot, type ModelRoute, type StoredDraft, type TokenSpan,
} from '../core/types'
import { focusedIn, nativeMenuOpen, selectedPlainText, type ReferenceOccurrence } from './dom'
import { snapshotMatches } from '../core/snapshot'
import { charCount } from '../core/context'

export interface BrowserInput {
  draft: string; draftRev: number; phase: string
  attachmentIds: readonly unknown[]; occurrences: readonly ReferenceOccurrence[]
}
export interface BrowserActions {
  captureInsertion(): TokenSpan
  insertText(text: string, span: TokenSpan): boolean
  persistDraft?(): void
}
export interface BrowserBinding {
  sessionId: string; input: BrowserInput; actions: BrowserActions; editor: HTMLElement | null
  running: boolean; route?: ModelRoute
}
export interface BrowserTransport {
  call<T>(method: string, data: unknown, signal?: AbortSignal): Promise<T>
  generation(): string | null
}
export interface Suggestion { text: string; snapshot: InputSnapshot; kind: 'next' | 'complete' }
export interface ChangeRecord {
  before: string; after: string; beforeTarget: string; afterTarget: string
  span: TokenSpan; sourceTurnId: string | null; connectionGeneration: string; routeKey: string
  clientGeneration: string | null
}
export interface BrowserState {
  status: AssistantStatus | null
  settings: AssistantConfig
  busy: 'optimize' | 'stash' | null
  notice: string
  suggestion: Suggestion | null
  change: ChangeRecord | null
  drafts: readonly StoredDraft[]
  locked: readonly string[]
  connected: boolean
  settingsSaving: boolean
  metrics: UsageMetrics
}
export interface UsageMetrics { exposures: number; accepted: number; editedAcceptances: number; editedCharacters: number; calls: number; totalLatencyMs: number }
const emptyMetrics = (): UsageMetrics => ({ exposures: 0, accepted: 0, editedAcceptances: 0, editedCharacters: 0, calls: 0, totalLatencyMs: 0 })
interface ActiveRequest {
  snapshot: GenerationRequest; controller: AbortController; clientGeneration: string | null
  caret: TokenSpan
  startedAt: number
  latencyRecorded: boolean
}
const initial = (): BrowserState => ({ status: null, settings: { ...DEFAULT_CONFIG }, busy: null,
  notice: '', suggestion: null, change: null, drafts: [], locked: [], connected: false, settingsSaving: false, metrics: emptyMetrics() })

/** One controller per mounted composer. Right/overlay surfaces consume this same store. */
export class InputAssistantController {
  private state = initial()
  private listeners = new Set<() => void>()
  private binding: BrowserBinding | null = null
  private active: ActiveRequest | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Cache key the armed completion timer was scheduled for; null when no timer is armed. */
  private timerKey: string | null = null
  private poll: ReturnType<typeof setInterval> | undefined
  private polling = false
  private lifecycle = new AbortController()
  private disposed = false
  private composing = false
  private settingsPending = false
  private settingsEpoch = 0
  private nextTurns = new Set<string>()
  private nextCache: { text: string; turn: string; route: string; generation: string } | null = null
  private completionCache = new Map<string, string | null>()
  private failedCompletionKey: string | null = null
  private lastCompletionStart = -Infinity
  private suppressUntilEdit: string | null = null
  private sequence = 0
  private clientGeneration: string | null = null
  private lockedRanges: { text: string; span: TokenSpan }[] = []
  private exposed = new Set<string>()
  private acceptance: { expected: string; edits: number; counted: boolean } | null = null

  constructor(readonly sessionId: string, private readonly transport: BrowserTransport, metrics?: UsageMetrics,
    private readonly saveSettings?: (update: Partial<AssistantConfig>) => Promise<AssistantConfig>) {
    if (metrics) this.state.metrics = { ...metrics }
  }
  getSnapshot = (): BrowserState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private patch(update: Partial<BrowserState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) listener()
  }

  start(): void {
    if (this.poll || this.disposed) return
    void this.refresh()
    void this.refreshDrafts()
    this.poll = setInterval(() => { void this.refresh() }, 900)
  }
  dispose(): void {
    if (this.disposed) return
    this.cancelActive()
    this.clearTimer()
    clearInterval(this.poll)
    this.lifecycle.abort()
    this.disposed = true
    this.listeners.clear()
    this.binding = null
  }
  bind(binding: BrowserBinding): void {
    if (this.disposed || binding.sessionId !== this.sessionId) return
    const previous = this.binding
    this.binding = binding
    const generation = this.transport.generation()
    if (generation !== this.clientGeneration) {
      this.clientGeneration = generation
      this.invalidate(true)
      this.patch({ connected: false, status: null, drafts: [] })
      if (generation !== null && this.poll) { void this.refresh(); void this.refreshDrafts() }
    }
    const changed = previous && (previous.input.draftRev !== binding.input.draftRev || previous.input.draft !== binding.input.draft
      || this.routeKey(previous.route) !== this.routeKey(binding.route) || previous.running !== binding.running
      || previous.input.phase !== binding.input.phase || previous.input.attachmentIds.length !== binding.input.attachmentIds.length
      || previous.input.occurrences.length !== binding.input.occurrences.length)
    if (changed) {
      this.cancelActive()
      if (previous.input.draft !== binding.input.draft) this.observeAcceptedEdit(binding.input.draft)
      if (previous.input.draft !== binding.input.draft) this.lockedRanges = []
      if (previous.input.draft !== binding.input.draft) this.failedCompletionKey = null
      this.patch({ suggestion: null, ...(previous.input.draft !== binding.input.draft ? { locked: [] } : {}) })
      if (this.suppressUntilEdit !== null && binding.input.draft !== this.suppressUntilEdit) this.suppressUntilEdit = null
    }
    this.driveSuggestions()
  }
  notifySelectionChange(): void {
    if (nativeMenuOpen(this.binding?.editor ?? null)) {
      if (this.active?.snapshot.operation !== 'optimize') this.cancelActive()
      this.clearTimer(); this.patch({ suggestion: null }); return
    }
    if (this.active && this.active.snapshot.operation !== 'optimize' && !this.sameCaret(this.active.caret)) this.cancelActive()
    if (this.state.suggestion && !this.isCurrent(this.state.suggestion.snapshot, true)) this.patch({ suggestion: null })
    this.driveSuggestions()
  }
  setComposing(value: boolean): void {
    this.composing = value
    if (value) { this.cancelActive(); this.clearTimer(); this.patch({ suggestion: null }) }
    else this.driveSuggestions()
  }
  dismissSuggestion(): void { this.clearTimer(); this.cancelActive(); this.patch({ suggestion: null }); this.suppressUntilEdit = this.binding?.input.draft ?? '' }
  clearNotice(): void { this.patch({ notice: '' }) }
  notice(text: string): void { this.patch({ notice: text }) }

  async refresh(): Promise<void> {
    if (this.disposed || this.polling || this.transport.generation() === null) return
    const generation = this.transport.generation()
    const settingsEpoch = this.settingsEpoch
    this.polling = true
    try {
      const status = await this.transport.call<AssistantStatus>('status', { sessionId: this.sessionId }, this.lifecycle.signal)
      if (this.disposed || this.transport.generation() !== generation || settingsEpoch !== this.settingsEpoch) return
      const previous = this.state.status
      const changed = previous && (status.sourceTurnId !== previous.sourceTurnId || status.generation !== previous.generation
        || this.routeKey(status.route) !== this.routeKey(previous.route) || status.running !== previous.running
        || JSON.stringify(status.settings) !== JSON.stringify(previous.settings))
      if (changed) this.invalidate(true)
      this.patch({ status, settings: status.settings, connected: this.transport.generation() !== null })
      this.driveSuggestions()
    } catch {
      // A failed status read is not evidence that the draft/model/turn changed.
      // Preserve completed/failed attempts across a transient transport error,
      // and keep a manual optimization in flight: aborting it here would drop
      // the user's request with no visible error.
      if (!this.disposed) { this.invalidate(false, false); this.patch({ connected: false }) }
    } finally { this.polling = false }
  }

  async updateSettings(update: Partial<AssistantConfig>): Promise<void> {
    if (this.settingsPending) return
    if (this.saveSettings) {
      try { await this.saveSettings(update); this.patch({ notice: '设置已保存' }) }
      catch (error) { this.patch({ notice: this.errorMessage(error) }) }
      return
    }
    this.beginSettingsUpdate()
    try {
      const settings = await this.transport.call<AssistantConfig>('settings/set', update, this.lifecycle.signal)
      this.applySettings(settings)
      this.patch({ notice: '设置已保存' })
    } catch (error) { this.patch({ notice: this.errorMessage(error) }) }
    finally { this.endSettingsUpdate() }
  }
  beginSettingsUpdate(): void { this.settingsEpoch++; this.settingsPending = true; this.invalidate(false); this.patch({ settingsSaving: true }) }
  endSettingsUpdate(): void { this.settingsPending = false; this.patch({ settingsSaving: false }); this.driveSuggestions() }
  /** A settings page can update every mounted composer without waiting for its status poll. */
  applySettings(settings: AssistantConfig): void {
    this.settingsEpoch++
    this.invalidate(true)
    this.patch({ settings, ...(this.state.status ? { status: { ...this.state.status, settings } } : {}) })
    this.driveSuggestions()
  }
  lockSelection(): void {
    const captured = this.captureTarget(true)
    if (!captured) return
    if (this.state.locked.includes(captured.text)) return
    this.lockedRanges.push({ text: captured.text, span: captured.span })
    this.patch({ locked: [...this.state.locked, captured.text], notice: '已保护选中原文；编辑草稿后需重新锁定' })
  }
  clearLocks(): void { this.lockedRanges = []; this.patch({ locked: [], notice: '已清除手动保护片段' }) }

  async optimize(): Promise<void> {
    if (this.settingsPending) return
    if (!this.state.settings.optimizeEnabled) { this.patch({ notice: '提示词优化已关闭，可在输入助手设置中启用' }); return }
    const binding = this.binding
    if (!binding || this.state.busy) return
    const target = this.captureTarget(false)
    if (!target || !target.text.trim()) return
    if (this.lockedRanges.some(lock => target.span.start < lock.span.end && target.span.end > lock.span.start
      && !(target.span.start <= lock.span.start && target.span.end >= lock.span.end))) {
      this.patch({ notice: '选区跨越了受保护片段的边界，请完整包含或避开该片段' }); return
    }
    if (charCount(target.text) > this.state.settings.maxDraftChars) {
      this.patch({ notice: `待优化内容超过 ${this.state.settings.maxDraftChars} 字符，请选择较短片段` }); return
    }
    this.clearTimer()
    this.cancelActive()
    this.patch({ suggestion: null, busy: 'optimize', notice: '' })
    const snapshot = this.snapshot('optimize', target.span, target.text)
    if (!snapshot) { this.patch({ busy: null, notice: '连接或模型尚未就绪，请稍后重试' }); return }
    const active = this.begin(snapshot)
    try {
      const result = await this.transport.call<GenerationResult>('generate', snapshot, active.controller.signal)
      if (this.active !== active || !this.isCurrent(snapshot, false) || !this.validResult(result, snapshot)) return
      if (result.text === null || !result.text.trim()) { this.patch({ notice: '没有可应用的优化结果，原文已保留' }); return }
      const after = binding.input.draft.slice(0, target.clipboardStart) + result.text + binding.input.draft.slice(target.clipboardEnd)
      if (!binding.actions.insertText(result.text, target.span)) { this.patch({ notice: '草稿已变化，已放弃本次结果' }); return }
      binding.actions.persistDraft?.()
      this.suppressUntilEdit = after
      this.patch({ change: { before: binding.input.draft, after, beforeTarget: target.text, afterTarget: result.text,
        span: { ...target.span, end: target.span.start + result.text.length }, sourceTurnId: snapshot.sourceTurnId,
        connectionGeneration: snapshot.connectionGeneration, routeKey: snapshot.routeKey,
        clientGeneration: active.clientGeneration }, notice: '已优化，可查看改动或撤销' })
    } catch (error) {
      if (!active.controller.signal.aborted) this.patch({ notice: this.errorMessage(error) })
    } finally {
      this.recordLatency(active)
      if (this.active === active) { this.active = null; this.patch({ busy: null }) }
    }
  }

  canRestore(): boolean {
    const change = this.state.change, binding = this.binding, status = this.state.status
    return Boolean(change && binding && status && this.state.connected && binding.input.draft === change.after && binding.input.phase === 'plain'
      && status.sourceTurnId === change.sourceTurnId && status.generation === change.connectionGeneration
      && this.routeKey(binding.route ?? status.route) === change.routeKey && this.transport.generation() === change.clientGeneration)
  }
  restoreOriginal(): boolean {
    const binding = this.binding, change = this.state.change
    if (!binding || !change || !this.canRestore()) { this.patch({ notice: '草稿已有新编辑，可在改动面板复制原文' }); return false }
    this.cancelActive()
    const applied = binding.actions.insertText(change.beforeTarget, { ...change.span, draftRev: binding.input.draftRev })
    if (applied) { binding.actions.persistDraft?.(); this.suppressUntilEdit = change.before; this.patch({ change: null, suggestion: null, notice: '已还原优化前的内容' }) }
    return applied
  }

  acceptSuggestion(): boolean {
    const suggestion = this.state.suggestion, binding = this.binding
    if (!suggestion || !binding || !this.isCurrent(suggestion.snapshot, true) || !this.eligible()
      || (suggestion.kind === 'next' ? !this.state.settings.nextEnabled : !this.state.settings.completionEnabled)) {
      this.patch({ suggestion: null }); return false
    }
    const applied = binding.actions.insertText(suggestion.text, suggestion.snapshot.span)
    this.patch({ suggestion: null })
    if (applied) {
      binding.actions.persistDraft?.(); this.suppressUntilEdit = binding.input.draft + suggestion.text
      this.acceptance = { expected: this.suppressUntilEdit, edits: 0, counted: false }
      this.patch({ metrics: { ...this.state.metrics, accepted: this.state.metrics.accepted + 1 } })
    }
    return applied
  }

  /** Called only after the overlay has actually rendered a candidate. */
  markExposed(requestId: string): void {
    const suggestion = this.state.suggestion
    if (!suggestion || suggestion.snapshot.requestId !== requestId) return
    const key = JSON.stringify([suggestion.snapshot.sourceTurnId, suggestion.snapshot.routeKey, suggestion.snapshot.draft, suggestion.text, suggestion.kind])
    if (this.exposed.has(key)) return
    // Bounded like the completion cache: long sessions must not grow without limit.
    if (this.exposed.size >= 512) this.exposed.clear()
    this.exposed.add(key)
    this.patch({ metrics: { ...this.state.metrics, exposures: this.state.metrics.exposures + 1 } })
  }

  async refreshDrafts(): Promise<void> {
    const generation = this.transport.generation()
    if (generation === null) return
    try { const drafts = await this.transport.call<StoredDraft[]>('drafts/list', { sessionId: this.sessionId }, this.lifecycle.signal)
      if (generation === this.transport.generation()) this.patch({ drafts }) }
    catch (error) { if (!this.lifecycle.signal.aborted) this.patch({ notice: this.errorMessage(error) }) }
  }
  async stash(replaceId?: string): Promise<void> {
    if (this.settingsPending) return
    if (!this.state.settings.stashEnabled) { this.patch({ notice: '草稿暂存已关闭，已保存的草稿仍可查看和删除' }); return }
    const binding = this.binding
    if (!binding || this.state.busy) return
    if (!this.pureText() || !binding.input.draft.trim()) { this.patch({ notice: '暂存仅支持无引用、无附件的非空纯文本草稿' }); return }
    if (this.state.drafts.length >= 3 && !replaceId) { this.patch({ notice: '已暂存三条，请删除一条或选择替换' }); return }
    const original = binding.input.draft, rev = binding.input.draftRev, clientGeneration = this.transport.generation()
    this.cancelActive(); this.clearTimer(); this.patch({ busy: 'stash', suggestion: null, notice: '' })
    try {
      await this.transport.call('drafts/save', { sessionId: this.sessionId, text: original, ...(replaceId ? { replaceId } : {}) }, this.lifecycle.signal)
      await this.refreshDrafts()
      const live = this.binding
      if (!this.settingsPending && this.state.settings.stashEnabled && live?.input.draftRev === rev && live.input.draft === original && live.input.phase === 'plain'
        && clientGeneration === this.transport.generation() && this.pureText()) {
        if (live.actions.insertText('', { start: 0, end: original.length, draftRev: rev })) {
          live.actions.persistDraft?.(); this.suppressUntilEdit = ''; this.patch({ notice: '草稿已暂存并清空；可撤销清空' }); return
        }
      }
      this.patch({ notice: '已保存快照；当前状态已变化，保留当前输入' })
    } catch (error) { this.patch({ notice: this.errorMessage(error) }) }
    finally { this.patch({ busy: null }) }
  }
  restoreDraft(draft: StoredDraft, mode: 'append' | 'replace'): boolean {
    if (this.settingsPending) return false
    const binding = this.binding
    if (!this.state.settings.stashEnabled) { this.patch({ notice: '草稿暂存已关闭，请重新启用后恢复' }); return false }
    if (!this.state.connected || !this.state.status) { this.patch({ notice: '连接尚未就绪，已保留当前输入' }); return false }
    if (!binding || !this.pureText()) { this.patch({ notice: '请先移除引用和附件，再恢复纯文本草稿' }); return false }
    this.cancelActive(); this.clearTimer()
    const span = { start: mode === 'replace' ? 0 : binding.input.draft.length, end: binding.input.draft.length, draftRev: binding.input.draftRev }
    const text = mode === 'append' && binding.input.draft ? `\n${draft.text}` : draft.text
    const applied = binding.actions.insertText(text, span)
    if (applied) { binding.actions.persistDraft?.(); this.suppressUntilEdit = mode === 'replace' ? text : binding.input.draft + text; this.patch({ suggestion: null, notice: '草稿已恢复，尚未发送' }) }
    return applied
  }
  async deleteDraft(id: string): Promise<void> { await this.mutateDraft('drafts/delete', { sessionId: this.sessionId, id }) }
  async clearDrafts(): Promise<void> { await this.mutateDraft('drafts/clear', { sessionId: this.sessionId }) }
  private async mutateDraft(method: string, data: unknown): Promise<void> {
    try { await this.transport.call(method, data, this.lifecycle.signal); await this.refreshDrafts() }
    catch (error) { this.patch({ notice: this.errorMessage(error) }) }
  }

  private captureTarget(requireSelection: boolean): { text: string; span: TokenSpan; clipboardStart: number; clipboardEnd: number } | null {
    const binding = this.binding
    if (!binding || binding.input.phase !== 'plain') { this.patch({ notice: '当前输入框暂时不可编辑' }); return null }
    const span = binding.actions.captureInsertion()
    if (span.start !== span.end) {
      const selected = selectedPlainText(binding.editor, binding.input.draft, span, binding.input.occurrences)
      if (!selected) { this.patch({ notice: '请选择完全位于普通文字中的片段，避免跨越引用标签' }); return null }
      return { ...selected, span }
    }
    if (requireSelection) { this.patch({ notice: '请先在输入框选中要保护的文字' }); return null }
    if (binding.input.occurrences.length) { this.patch({ notice: '含引用标签时，请选择不跨标签的纯文字片段优化' }); return null }
    return { text: binding.input.draft, span: { start: 0, end: binding.input.draft.length, draftRev: binding.input.draftRev }, clipboardStart: 0, clipboardEnd: binding.input.draft.length }
  }
  private pureText(): boolean {
    const input = this.binding?.input
    return Boolean(input && input.phase === 'plain' && !input.occurrences.length && !input.attachmentIds.length)
  }
  private eligible(): boolean {
    return this.pureText() && !this.composing && !this.settingsPending && !this.binding?.running && !this.state.status?.running
      && !this.state.busy && this.state.connected && this.suppressUntilEdit === null
  }
  private driveSuggestions(): void {
    const binding = this.binding, status = this.state.status
    if (!binding || !status || !this.eligible() || this.active) { this.clearTimer(); return }
    if (nativeMenuOpen(binding.editor)) { this.clearTimer(); return }
    const span = binding.actions.captureInsertion()
    if (span.start !== span.end || span.end !== binding.input.draft.length || !focusedIn(binding.editor)) { this.clearTimer(); return }
    const turn = status.sourceTurnId
    const route = this.routeKey(binding.route ?? status.route)
    if (binding.input.draft === '') {
      this.clearTimer()
      if (!turn) return
      if (!this.state.settings.nextEnabled || this.nextTurns.has(`${status.generation}:${turn}:${route}`)) return
      // Bounded like the other caches: one entry per completed turn is tiny, but a
      // long-lived tab must not accumulate them forever.
      if (this.nextTurns.size >= 512) this.nextTurns.clear()
      this.nextTurns.add(`${status.generation}:${turn}:${route}`)
      void this.requestSuggestion('next')
      return
    }
    if (!this.state.settings.completionEnabled || charCount(binding.input.draft) > this.state.settings.maxDraftChars) { this.clearTimer(); return }
    if (this.nextCache && this.nextCache.turn === turn && this.nextCache.route === route && this.nextCache.generation === status.generation
      && this.nextCache.text.startsWith(binding.input.draft)) {
      this.clearTimer()
      const suffix = this.nextCache.text.slice(binding.input.draft.length)
      const snapshot = this.snapshot('complete', span)
      if (suffix && charCount(suffix) <= this.state.settings.maxCompletionChars && snapshot) this.patch({ suggestion: { text: suffix, snapshot, kind: 'complete' } })
      return
    }
    const cacheKey = this.completionKey()
    if (cacheKey === this.failedCompletionKey) { this.clearTimer(); return }
    if (this.completionCache.has(cacheKey)) {
      this.clearTimer()
      const text = this.completionCache.get(cacheKey), snapshot = this.snapshot('complete', span)
      if (text && snapshot) this.patch({ suggestion: { text, snapshot, kind: 'complete' } })
      return
    }
    // The status poll calls this method every 900ms. Re-arming an already
    // pending timer for the same draft would reset its deadline forever once
    // debounceMs exceeds the poll interval, silently disabling completion for
    // every configured value above 900ms. Keep the armed timer when nothing
    // that feeds the cache key changed.
    if (this.timer !== undefined && this.timerKey === cacheKey) return
    this.clearTimer()
    const delay = Math.max(this.state.settings.debounceMs, this.lastCompletionStart + this.state.settings.minIntervalMs - Date.now())
    this.timerKey = cacheKey
    this.timer = setTimeout(() => { this.timer = undefined; this.timerKey = null; void this.requestSuggestion('complete') }, delay)
  }
  private async requestSuggestion(operation: 'next' | 'complete'): Promise<void> {
    const binding = this.binding
    if (!binding || !this.eligible()) return
    const span = binding.actions.captureInsertion(), snapshot = this.snapshot(operation, span)
    if (!snapshot || span.start !== span.end || span.end !== binding.input.draft.length) return
    if (operation === 'complete') this.lastCompletionStart = Date.now()
    const active = this.begin(snapshot), cacheKey = this.completionKey()
    try {
      const result = await this.transport.call<GenerationResult>('generate', snapshot, active.controller.signal)
      if (this.active !== active || !this.isCurrent(snapshot, true)) return
      if (!this.validResult(result, snapshot)) {
        if (operation === 'complete') this.failedCompletionKey = cacheKey
        return
      }
      if (operation === 'complete') {
        this.completionCache.set(cacheKey, result.text)
        if (this.completionCache.size > 64) this.completionCache.delete(this.completionCache.keys().next().value!)
      }
      if (operation === 'next' && result.text) this.nextCache = { text: result.text, turn: snapshot.sourceTurnId!, route: snapshot.routeKey, generation: snapshot.connectionGeneration }
      if (result.text) this.patch({ suggestion: { text: result.text, snapshot, kind: operation } })
    } catch {
      // A provider error or host deadline must not turn the status poll into a retry loop.
      // Explicit cancellation belongs to an obsolete attempt and must not poison a newer draft.
      if (operation === 'complete' && !active.controller.signal.aborted && this.active === active && this.isCurrent(snapshot, false)) {
        this.failedCompletionKey = cacheKey
      }
    }
    finally { this.recordLatency(active); if (this.active === active) this.active = null }
  }
  private snapshot(operation: GenerationRequest['operation'], span: TokenSpan, targetText?: string): GenerationRequest | null {
    const binding = this.binding, status = this.state.status
    if (!binding || !status || !this.state.connected) return null
    const route = binding.route ?? status.route
    return { operation, sessionId: this.sessionId, requestId: `${Date.now().toString(36)}-${++this.sequence}`,
      sourceTurnId: status.sourceTurnId, draft: binding.input.draft, draftRev: binding.input.draftRev,
      span: { ...span }, connectionGeneration: status.generation, routeKey: this.routeKey(route),
      ...(targetText === undefined ? {} : { targetText }),
      ...(this.state.locked.length ? { lockedFragments: this.state.locked.filter(text => (targetText ?? binding.input.draft).includes(text)) } : {}),
      ...(route ? { provider: route.provider, model: route.model } : {}) }
  }
  private begin(snapshot: GenerationRequest): ActiveRequest {
    this.cancelActive()
    const active = { snapshot, controller: new AbortController(), clientGeneration: this.transport.generation(),
      caret: this.binding!.actions.captureInsertion(), startedAt: Date.now(), latencyRecorded: false }
    this.active = active
    this.patch({ metrics: { ...this.state.metrics, calls: this.state.metrics.calls + 1 } })
    return active
  }
  private observeAcceptedEdit(draft: string): void {
    const acceptance = this.acceptance
    if (!acceptance) return
    // Optimistic sends clear the composer; do not count that as deleting the accepted suggestion.
    if (!draft) { this.acceptance = null; return }
    if (draft === acceptance.expected && !acceptance.counted) return
    let start = 0, end = 0
    while (start < draft.length && start < acceptance.expected.length && draft[start] === acceptance.expected[start]) start++
    while (end < draft.length - start && end < acceptance.expected.length - start
      && draft[draft.length - end - 1] === acceptance.expected[acceptance.expected.length - end - 1]) end++
    const edits = draft.length + acceptance.expected.length - 2 * start - 2 * end
    this.patch({ metrics: { ...this.state.metrics,
      editedAcceptances: this.state.metrics.editedAcceptances + (acceptance.counted ? 0 : 1),
      editedCharacters: this.state.metrics.editedCharacters + edits - acceptance.edits } })
    acceptance.counted = true; acceptance.edits = edits
  }
  private isCurrent(snapshot: InputSnapshot, checkCaret: boolean): boolean {
    const binding = this.binding, status = this.state.status
    return Boolean(binding && status && !this.disposed && this.transport.generation() === this.clientGeneration
      && this.transport.generation() !== null && binding.sessionId === snapshot.sessionId
      && binding.input.phase === 'plain' && snapshotMatches(snapshot, {
        sessionId: binding.sessionId, sourceTurnId: status.sourceTurnId, draft: binding.input.draft,
        draftRev: binding.input.draftRev, span: binding.actions.captureInsertion(), connectionGeneration: status.generation,
        routeKey: this.routeKey(binding.route ?? status.route),
      }, checkCaret))
  }
  private validResult(result: GenerationResult, request: InputSnapshot): boolean {
    return result.requestId === request.requestId && result.sessionId === request.sessionId
      && result.sourceTurnId === request.sourceTurnId && result.draftRev === request.draftRev
      && result.connectionGeneration === request.connectionGeneration && result.routeKey === request.routeKey
      && result.span.start === request.span.start && result.span.end === request.span.end
      && (result.text === null || typeof result.text === 'string')
  }
  private sameCaret(span: TokenSpan): boolean {
    const current = this.binding?.actions.captureInsertion()
    return Boolean(current && current.start === span.start && current.end === span.end && current.draftRev === span.draftRev)
  }
  private routeKey(route?: ModelRoute): string { return route ? JSON.stringify([route.provider, route.model]) : '' }
  private completionKey(): string { return JSON.stringify([this.state.status?.generation, this.state.status?.sourceTurnId, this.routeKey(this.binding?.route ?? this.state.status?.route), this.binding?.input.draft]) }
  private invalidate(dropCache: boolean, cancelInFlight = true): void {
    // A transient status read failure is not evidence that the draft, turn or
    // model changed, so it must not destroy a manual optimization the user is
    // waiting on. Automatic suggestions are still cleared: they are cheap to
    // regenerate, and a stale ghost must never outlive a lost connection.
    if (cancelInFlight) this.cancelActive()
    else if (this.active?.snapshot.operation !== 'optimize') this.cancelActive()
    this.clearTimer()
    if (dropCache) { this.nextCache = null; this.completionCache.clear(); this.failedCompletionKey = null }
    this.patch({ suggestion: null })
  }
  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined; this.timerKey = null }
  private cancelActive(): void {
    const active = this.active
    if (!active) return
    this.active = null
    this.recordLatency(active)
    active.controller.abort()
    void this.transport.call('cancel', { sessionId: this.sessionId, requestId: active.snapshot.requestId }).catch(() => {})
    if (active.snapshot.operation === 'optimize') this.patch({ busy: null })
  }
  private recordLatency(active: ActiveRequest): void {
    if (active.latencyRecorded) return
    active.latencyRecorded = true
    this.patch({ metrics: { ...this.state.metrics, totalLatencyMs: this.state.metrics.totalLatencyMs + Math.max(0, Date.now() - active.startedAt) } })
  }
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作失败，原稿已保留，请稍后重试' }
}
