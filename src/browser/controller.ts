import {
  DEFAULT_CONFIG, type AssistantConfig, type AssistantStatus, type GenerationRequest,
  type DraftMutationResult, type GenerationResult, type InputSnapshot, type ModelRoute, type StoredDraft, type TokenSpan,
} from '../core/types.js'
import { focusedIn, nativeMenuOpen, selectedPlainText, type ReferenceOccurrence } from './dom.js'
import { snapshotMatches } from '../core/snapshot.js'
import { charCount } from '../core/context.js'

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
export interface Suggestion { text: string; snapshot: GenerationRequest; kind: 'next' | 'complete' }
export interface OptimizationPreview {
  request: GenerationRequest; text: string; beforeTarget: string
  clipboardStart: number; clipboardEnd: number; clientGeneration: string | null
}
export interface UndoSnapshot {
  recent: readonly StoredDraft[]; expiresAt: number; pending: readonly StoredDraft[]; generation: string | null
}
export type SuggestionStatus = 'idle' | 'waiting' | 'generating' | 'ready' | 'throttled' | 'abstained' | 'failed' | 'paused'
export interface ChangeRecord {
  before: string; after: string; beforeTarget: string; afterTarget: string
  span: TokenSpan; sourceTurnId: string | null; connectionGeneration: string; routeKey: string
  clientGeneration: string | null
}
export interface BrowserState {
  status: AssistantStatus | null
  settings: AssistantConfig
  busy: 'optimize' | 'stash' | null
  stashClearCancelled: boolean
  stashClearPending: boolean
  notice: string
  suggestion: Suggestion | null
  suggestionStatus: SuggestionStatus
  suggestionMessage: string
  preview: OptimizationPreview | null
  change: ChangeRecord | null
  drafts: readonly StoredDraft[]
  deletedDrafts: readonly StoredDraft[]
  pendingUndoDrafts: readonly StoredDraft[]
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
const initial = (): BrowserState => ({ status: null, settings: { ...DEFAULT_CONFIG }, busy: null, stashClearCancelled: false, stashClearPending: false,
  notice: '', suggestion: null, suggestionStatus: 'idle', suggestionMessage: '', preview: null, change: null, drafts: [], deletedDrafts: [], pendingUndoDrafts: [], locked: [], connected: false, settingsSaving: false, metrics: emptyMetrics() })

/** One controller per mounted composer. Right/overlay surfaces consume this same store. */
export class InputAssistantController {
  private state = initial()
  private listeners = new Set<() => void>()
  private binding: BrowserBinding | null = null
  private active: ActiveRequest | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Cache key the armed completion timer was scheduled for; null when no timer is armed. */
  private timerKey: string | null = null
  private manualTimerKey: string | null = null
  private poll: ReturnType<typeof setInterval> | undefined
  private undoTimer: ReturnType<typeof setTimeout> | undefined
  private undoExpiresAt = 0
  private readonly requestPrefix = Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(36)).join('-')
  private completionRetryAt = 0
  private polling = false
  private lifecycle = new AbortController()
  private disposed = false
  private composing = false
  private settingsPending = false
  private settingsEpoch = 0
  private draftsEpoch = 0
  private stashEpoch = 0
  private nextTurns = new Set<string>()
  private failedNextKey: string | null = null
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
    private readonly saveSettings?: (update: Partial<AssistantConfig>) => Promise<AssistantConfig>, undo?: UndoSnapshot) {
    if (metrics) this.state.metrics = { ...metrics }
    if (undo && undo.generation === transport.generation()) {
      this.clientGeneration = undo.generation
      this.state.pendingUndoDrafts = undo.pending.map(draft => ({ ...draft }))
      if (undo.expiresAt > Date.now()) {
        this.state.deletedDrafts = undo.recent.map(draft => ({ ...draft }))
        this.undoExpiresAt = undo.expiresAt; this.armUndoExpiry()
      }
    }
  }
  getUndoSnapshot(): UndoSnapshot {
    return { recent: this.undoExpiresAt > Date.now() ? this.state.deletedDrafts.map(draft => ({ ...draft })) : [],
      expiresAt: this.undoExpiresAt, pending: this.state.pendingUndoDrafts.map(draft => ({ ...draft })), generation: this.clientGeneration }
  }
  private armUndoExpiry(): void {
    clearTimeout(this.undoTimer)
    if (!Number.isFinite(this.undoExpiresAt)) return
    this.undoTimer = setTimeout(() => {
      this.undoExpiresAt = 0
      this.patch({ deletedDrafts: [], notice: this.state.notice === '已删除暂存，10 秒内可撤销' ? '' : this.state.notice })
    }, Math.max(0, this.undoExpiresAt - Date.now()))
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
    this.schedulePoll()
    document.addEventListener('visibilitychange', this.visibilityChanged)
  }
  private visibilityChanged = (): void => {
    clearTimeout(this.poll)
    if (document.visibilityState === 'hidden') {
      if (this.active?.snapshot.operation !== 'optimize' && !this.active?.snapshot.manual) this.cancelActive()
      this.clearTimer(); this.patch({ suggestion: null, suggestionStatus: 'paused', suggestionMessage: '页面已隐藏，自动建议已暂停' })
    } else { void this.refresh(); this.driveSuggestions() }
    this.schedulePoll()
  }
  private schedulePoll(): void {
    const delay = document.visibilityState === 'hidden' ? 10000 : this.binding?.running || this.state.busy ? 900 : 3000
    this.poll = setTimeout(() => { void this.refresh(); this.schedulePoll() }, delay)
  }
  dispose(): void {
    if (this.disposed) return
    this.cancelActive()
    this.clearTimer()
    clearTimeout(this.poll)
    clearTimeout(this.undoTimer)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
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
      clearTimeout(this.undoTimer)
      this.undoExpiresAt = 0
      this.patch({ connected: false, status: null, drafts: [], deletedDrafts: [], pendingUndoDrafts: [] })
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
      this.patch({ suggestion: null, suggestionStatus: 'idle', suggestionMessage: '', preview: null, ...(previous.input.draft !== binding.input.draft ? { locked: [] } : {}) })
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
  dismissSuggestion(): void { this.clearTimer(); this.cancelActive(); this.patch({ suggestion: null, suggestionStatus: 'paused', suggestionMessage: '已暂停至下次编辑' }); this.suppressUntilEdit = this.binding?.input.draft ?? '' }
  dismissOptimization(): void {
    this.suppressUntilEdit = this.binding?.input.draft ?? ''
    this.patch({ preview: null, notice: '已保留原文' })
  }
  cancelOperation(): void {
    if (this.state.busy === 'stash' && this.state.stashClearPending) {
      this.stashEpoch++
      this.patch({ stashClearCancelled: true, notice: '已取消清空；保存完成后仍保留当前输入' })
      return
    }
    if (this.state.busy === 'stash') { this.patch({ notice: '存储操作正在完成，请稍后再操作' }); return }
    this.cancelActive(); this.clearTimer()
    this.suppressUntilEdit = this.binding?.input.draft ?? ''
    this.patch({ preview: null, suggestion: null, notice: '已取消，原稿已保留' })
  }
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
      if (!previous || changed || !this.state.connected) this.patch({ status, settings: status.settings, connected: true })
      this.driveSuggestions()
    } catch {
      // A failed status read is not evidence that the draft/model/turn changed.
      // Preserve completed/failed attempts across a transient transport error,
      // and keep a manual optimization in flight: aborting it here would drop
      // the user's request with no visible error.
      if (!this.disposed && this.transport.generation() === generation && settingsEpoch === this.settingsEpoch) {
        this.invalidate(false, false); this.patch({ connected: false })
      }
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
    this.patch({ suggestion: null, preview: null, busy: 'optimize', notice: '' })
    const snapshot = this.snapshot('optimize', target.span, target.text)
    if (!snapshot) { this.patch({ busy: null, notice: '连接或模型尚未就绪，请稍后重试' }); return }
    const active = this.begin(snapshot)
    try {
      const result = await this.transport.call<GenerationResult>('generate', snapshot, active.controller.signal)
      if (this.active !== active || !this.isCurrent(snapshot, false) || !this.validResult(result, snapshot)) return
      if (result.text === null || !result.text.trim()) { this.patch({ notice: '没有可应用的优化结果，原文已保留' }); return }
      this.patch({ preview: { request: snapshot, text: result.text, beforeTarget: target.text,
        clipboardStart: target.clipboardStart, clipboardEnd: target.clipboardEnd,
        clientGeneration: active.clientGeneration }, notice: '' })
    } catch (error) {
      if (!active.controller.signal.aborted) this.patch({ notice: this.errorMessage(error) })
    } finally {
      this.recordLatency(active)
      if (this.active === active) { this.active = null; this.patch({ busy: null }) }
    }
  }

  applyOptimization(): boolean {
    const preview = this.state.preview, binding = this.binding
    if (!preview || !binding || !this.state.connected || this.state.busy || this.settingsPending || this.composing
      || !this.state.settings.optimizeEnabled || !this.isCurrent(preview.request, false)
      || preview.clientGeneration !== this.transport.generation()) {
      this.patch({ preview: null, notice: '草稿或会话已变化，原文已保留' }); return false
    }
    const { request, text, beforeTarget, clipboardStart, clipboardEnd, clientGeneration } = preview
    const before = binding.input.draft
    const after = before.slice(0, clipboardStart) + text + before.slice(clipboardEnd)
    if (!binding.actions.insertText(text, request.span)) {
      this.patch({ preview: null, notice: '草稿已变化，已放弃本次结果' }); return false
    }
    binding.actions.persistDraft?.()
    this.suppressUntilEdit = after
    this.patch({ preview: null, change: { before, after, beforeTarget, afterTarget: text,
      span: { ...request.span, end: request.span.start + text.length }, sourceTurnId: request.sourceTurnId,
      connectionGeneration: request.connectionGeneration, routeKey: request.routeKey, clientGeneration },
      notice: '已采纳优化，可查看改动或还原' })
    return true
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
      || (!suggestion.snapshot.manual && (suggestion.kind === 'next' ? !this.state.settings.nextEnabled : !this.state.settings.completionEnabled))) {
      this.patch({ suggestion: null }); return false
    }
    const applied = binding.actions.insertText(suggestion.text, suggestion.snapshot.span)
    this.patch({ suggestion: null, suggestionStatus: applied ? 'paused' : 'idle', suggestionMessage: applied ? '已采纳，继续编辑后恢复自动建议' : '' })
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
    const generation = this.transport.generation(), epoch = this.draftsEpoch
    if (generation === null) return
    try { const drafts = await this.transport.call<StoredDraft[]>('drafts/list', { sessionId: this.sessionId }, this.lifecycle.signal)
      if (generation === this.transport.generation() && epoch === this.draftsEpoch) this.patch({ drafts }) }
    catch (error) {
      if (!this.lifecycle.signal.aborted && generation === this.transport.generation() && epoch === this.draftsEpoch) this.patch({ notice: this.errorMessage(error) })
    }
  }
  async stash(replaceId?: string): Promise<void> {
    if (this.settingsPending) return
    if (!this.state.settings.stashEnabled) { this.patch({ notice: '草稿暂存已关闭，已保存的草稿仍可查看和删除' }); return }
    const binding = this.binding
    if (!binding || this.state.busy) return
    if (!this.pureText() || !binding.input.draft.trim()) { this.patch({ notice: '暂存仅支持无引用、无附件的非空纯文本草稿' }); return }
    if (this.state.drafts.length >= 3 && !replaceId) { this.patch({ notice: '已暂存三条，请删除一条或选择替换' }); return }
    const original = binding.input.draft, rev = binding.input.draftRev, clientGeneration = this.transport.generation()
    const stashEpoch = ++this.stashEpoch
    const settingsEpoch = this.settingsEpoch, routeKey = this.routeKey(binding.route ?? this.state.status?.route)
    this.draftsEpoch++
    this.cancelActive(); this.clearTimer(); this.patch({ busy: 'stash', stashClearPending: true, stashClearCancelled: false, suggestion: null, notice: '' })
    try {
      await this.transport.call('drafts/save', { sessionId: this.sessionId, text: original, ...(replaceId ? { replaceId } : {}) }, this.lifecycle.signal)
      await this.refreshDrafts()
      const live = this.binding
      if (stashEpoch !== this.stashEpoch) {
        this.patch({ notice: '草稿已保存；已按取消要求保留当前输入' }); return
      }
      if (!this.settingsPending && settingsEpoch === this.settingsEpoch && this.state.settings.stashEnabled
        && this.routeKey(live?.route ?? this.state.status?.route) === routeKey && live?.input.draftRev === rev && live.input.draft === original && live.input.phase === 'plain'
        && clientGeneration === this.transport.generation() && this.pureText()) {
        if (live.actions.insertText('', { start: 0, end: original.length, draftRev: rev })) {
          live.actions.persistDraft?.(); this.suppressUntilEdit = ''; this.patch({ notice: '草稿已暂存并清空；可撤销清空' }); return
        }
      }
      this.patch({ notice: '已保存快照；当前状态已变化，保留当前输入' })
    } catch (error) { this.patch({ notice: this.errorMessage(error) }) }
    finally { this.patch({ busy: null, stashClearCancelled: false, stashClearPending: false }) }
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
    if (this.state.busy || this.transport.generation() === null) return
    if (this.undoExpiresAt === Infinity && this.state.deletedDrafts.length && this.state.pendingUndoDrafts.length) {
      this.patch({ notice: '两批待恢复备份尚未处理，请先复制或放弃一批，再删除新的暂存' }); return
    }
    const generation = this.transport.generation()
    this.draftsEpoch++
    this.patch({ busy: 'stash' })
    try {
      const result = await this.transport.call<DraftMutationResult>(method, data, this.lifecycle.signal)
      if (generation !== this.transport.generation()) return
      if (result.removed.length) {
        clearTimeout(this.undoTimer)
        this.patch({ drafts: result.drafts, deletedDrafts: result.removed, notice: '已删除暂存，10 秒内可撤销' })
        this.undoExpiresAt = Date.now() + 10000; this.armUndoExpiry()
      } else this.patch({ drafts: result.drafts })
    }
    catch (error) { this.patch({ notice: this.errorMessage(error) }) }
    finally { this.patch({ busy: null }) }
  }
  async undoDeleteDrafts(target: 'recent' | 'pending' = 'recent'): Promise<void> {
    const deleted = target === 'pending' ? this.state.pendingUndoDrafts : this.state.deletedDrafts
    if (!deleted.length || this.state.busy || this.transport.generation() === null) return
    const generation = this.transport.generation()
    this.draftsEpoch++
    if (target === 'recent') clearTimeout(this.undoTimer)
    this.patch({ busy: 'stash' })
    try {
      const drafts = await this.transport.call<StoredDraft[]>('drafts/restore', { sessionId: this.sessionId, drafts: deleted }, this.lifecycle.signal)
      if (generation === this.transport.generation()) {
        if (target === 'recent') this.undoExpiresAt = 0
        this.patch({ drafts, ...(target === 'recent' ? { deletedDrafts: [] } : { pendingUndoDrafts: [] }), notice: '已撤销删除' })
      }
    } catch (error) {
      if (generation === this.transport.generation()) {
        if (target === 'recent' && !this.state.pendingUndoDrafts.length) {
          this.undoExpiresAt = 0
          this.patch({ pendingUndoDrafts: deleted, deletedDrafts: [] })
        } else if (target === 'recent') this.undoExpiresAt = Infinity
        this.patch({ notice: `${this.errorMessage(error)}；待恢复文字已保留，可重试或复制` })
      }
    }
    finally { this.patch({ busy: null }) }
  }
  discardPendingUndo(): void {
    if (this.undoExpiresAt === Infinity) {
      this.undoExpiresAt = 0
      this.patch({ pendingUndoDrafts: this.state.deletedDrafts, deletedDrafts: [], notice: '已放弃选定恢复备份，其余备份仍保留' })
    } else this.patch({ pendingUndoDrafts: [], notice: '已放弃选定恢复备份' })
  }
  retrySuggestion(): void {
    if (!this.eligibleForManual()) {
      this.patch({ notice: '请在可见、已连接且空闲的纯文本输入框中，将光标移到末尾后生成建议' }); return
    }
    const binding = this.binding!, span = binding.actions.captureInsertion()
    if (span.start !== span.end || span.end !== binding.input.draft.length || !focusedIn(binding.editor)) {
      this.patch({ notice: '请将光标移至草稿末尾后生成建议' }); return
    }
    const operation = binding.input.draft.length ? 'complete' : 'next'
    if (operation === 'next' && !this.state.status?.sourceTurnId || operation === 'complete' && !binding.input.draft.trim()) {
      this.patch({ notice: '请先输入草稿，或等待一轮回复完成后再预测下一句' }); return
    }
    this.clearTimer(); this.cancelActive(); this.suppressUntilEdit = null
    this.failedCompletionKey = null; this.failedNextKey = null
    this.completionCache.delete(this.completionKey()); this.nextTurns.delete(this.nextKey())
    this.patch({ suggestion: null, notice: '' })
    void this.requestSuggestion(operation, true)
  }
  private eligibleForManual(): boolean {
    return this.pureText() && document.visibilityState !== 'hidden' && !this.composing && !this.settingsPending
      && !this.binding?.running && !this.state.status?.running && !this.state.busy && !this.state.preview && this.state.connected
      && charCount(this.binding?.input.draft ?? '') <= this.state.settings.maxDraftChars
      && !nativeMenuOpen(this.binding?.editor ?? null)
  }
  private suggestionStatus(status: SuggestionStatus, message: string): void {
    if (this.state.suggestionStatus !== status || this.state.suggestionMessage !== message) this.patch({ suggestionStatus: status, suggestionMessage: message })
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
    return this.pureText() && document.visibilityState !== 'hidden' && !this.composing && !this.settingsPending && !this.binding?.running && !this.state.status?.running
      && !this.state.busy && !this.state.preview && this.state.connected && this.suppressUntilEdit === null
  }
  private driveSuggestions(): void {
    const binding = this.binding, status = this.state.status
    if (!binding || !status || !this.eligible() || this.active) { this.clearTimer(); return }
    if (nativeMenuOpen(binding.editor)) { this.clearTimer(); return }
    const span = binding.actions.captureInsertion()
    if (span.start !== span.end || span.end !== binding.input.draft.length || !focusedIn(binding.editor)) { this.clearTimer(); return }
    if (this.manualTimerKey === this.completionKey() && this.timer !== undefined) return
    if (this.state.suggestion?.snapshot.manual && this.isCurrent(this.state.suggestion.snapshot, true)) return
    const turn = status.sourceTurnId
    const route = this.routeKey(binding.route ?? status.route)
    if (binding.input.draft === '') {
      this.clearTimer()
      if (!turn) return
      const key = this.nextKey()
      if (!this.state.settings.nextEnabled) {
        if (['idle', 'waiting', 'paused'].includes(this.state.suggestionStatus)) this.suggestionStatus('paused', '自动预测已关闭，可手动生成')
        return
      }
      if (this.nextTurns.has(key) || key === this.failedNextKey) return
      void this.requestSuggestion('next')
      return
    }
    if (!this.state.settings.completionEnabled || charCount(binding.input.draft) > this.state.settings.maxDraftChars) {
      this.clearTimer()
      if (!this.state.settings.completionEnabled && !this.state.suggestion && ['idle', 'waiting', 'paused'].includes(this.state.suggestionStatus)) this.suggestionStatus('paused', '自动续写已关闭，可手动生成')
      return
    }
    if (this.nextCache && this.nextCache.turn === turn && this.nextCache.route === route && this.nextCache.generation === status.generation
      && this.nextCache.text.startsWith(binding.input.draft)) {
      this.clearTimer()
      const suffix = this.nextCache.text.slice(binding.input.draft.length)
      const existing = this.state.suggestion
      if (existing && existing.text === suffix && existing.kind === 'complete' && this.isCurrent(existing.snapshot, true)) return
      const snapshot = this.snapshot('complete', span)
      if (suffix && charCount(suffix) <= this.state.settings.maxCompletionChars && snapshot) this.patch({ suggestion: { text: suffix, snapshot, kind: 'complete' } })
      return
    }
    const cacheKey = this.completionKey()
    if (cacheKey === this.failedCompletionKey) { this.clearTimer(); return }
    if (this.completionCache.has(cacheKey)) {
      this.clearTimer()
      const text = this.completionCache.get(cacheKey)
      if (!text) { this.suggestionStatus('abstained', '模型本次未给出建议，可手动重试'); return }
      const existing = this.state.suggestion
      if (existing && existing.text === text && existing.kind === 'complete' && this.isCurrent(existing.snapshot, true)) return
      const snapshot = this.snapshot('complete', span)
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
    const delay = Math.max(this.state.settings.debounceMs, this.lastCompletionStart + this.state.settings.minIntervalMs - Date.now(), this.completionRetryAt - Date.now())
    this.timerKey = cacheKey
    this.suggestionStatus(this.completionRetryAt > Date.now() ? 'throttled' : 'waiting', this.completionRetryAt > Date.now() ? '等待最小请求间隔结束' : '等待输入停顿')
    this.timer = setTimeout(() => { this.timer = undefined; this.timerKey = null; void this.requestSuggestion('complete') }, delay)
  }
  private async requestSuggestion(operation: 'next' | 'complete', manual = false, deferOnce = true): Promise<void> {
    const binding = this.binding
    if (!binding || !this.eligible()) return
    if (!manual && !(operation === 'next' ? this.state.settings.nextEnabled : this.state.settings.completionEnabled)) return
    const span = binding.actions.captureInsertion(), snapshot = this.snapshot(operation, span)
    if (!snapshot || span.start !== span.end || span.end !== binding.input.draft.length) return
    if (manual) snapshot.manual = true
    if (operation === 'complete') this.lastCompletionStart = Date.now()
    const active = this.begin(snapshot), cacheKey = this.completionKey(), nextKey = this.nextKey()
    this.suggestionStatus('generating', manual ? '正在生成本次建议' : '正在生成建议')
    let retry = false
    try {
      const result = await this.transport.call<GenerationResult>('generate', snapshot, active.controller.signal)
      if (this.active !== active || !this.isCurrent(snapshot, true)) return
      if (!this.validResult(result, snapshot)) {
        if (operation === 'complete') this.failedCompletionKey = cacheKey
        else this.failedNextKey = nextKey
        this.suggestionStatus('failed', '建议返回格式无效，可手动重试')
        return
      }
      if (result.outcome === 'throttled') {
        if (operation === 'complete') {
          this.completionRetryAt = Date.now() + result.retryAfterMs!
          retry = !manual || deferOnce
          this.suggestionStatus('throttled', '等待最小请求间隔结束，可稍后重试')
        }
        return
      }
      if (operation === 'complete') {
        this.completionCache.set(cacheKey, result.text)
        if (this.completionCache.size > 64) this.completionCache.delete(this.completionCache.keys().next().value!)
      } else {
        if (this.nextTurns.size >= 512) this.nextTurns.clear()
        this.nextTurns.add(nextKey)
      }
      if (operation === 'next' && result.text) this.nextCache = { text: result.text, turn: snapshot.sourceTurnId!, route: snapshot.routeKey, generation: snapshot.connectionGeneration }
      if (result.text) this.patch({ suggestion: { text: result.text, snapshot, kind: operation }, suggestionStatus: 'ready', suggestionMessage: 'Tab 采纳，Esc 忽略' })
      else this.suggestionStatus('abstained', '模型本次未给出建议，可手动重试')
    } catch {
      // A provider error or host deadline must not turn the status poll into a retry loop.
      // Explicit cancellation belongs to an obsolete attempt and must not poison a newer draft.
      if (operation === 'complete' && !active.controller.signal.aborted && this.active === active && this.isCurrent(snapshot, false)) {
        this.failedCompletionKey = cacheKey
      }
      if (operation === 'next' && !active.controller.signal.aborted && this.active === active && this.isCurrent(snapshot, false)) this.failedNextKey = nextKey
      if (!active.controller.signal.aborted && this.active === active && this.isCurrent(snapshot, false)) this.suggestionStatus('failed', '建议请求未完成，可手动重试')
    }
    finally {
      this.recordLatency(active)
      if (this.active === active) {
        this.active = null
        if (retry && manual) {
          this.timerKey = cacheKey
          this.manualTimerKey = cacheKey
          this.timer = setTimeout(() => { this.timer = undefined; this.timerKey = null; this.manualTimerKey = null; void this.requestSuggestion(operation, true, false) }, Math.max(1, this.completionRetryAt - Date.now()))
        } else if (retry) this.driveSuggestions()
      }
    }
  }
  private snapshot(operation: GenerationRequest['operation'], span: TokenSpan, targetText?: string): GenerationRequest | null {
    const binding = this.binding, status = this.state.status
    if (!binding || !status || !this.state.connected) return null
    const route = binding.route ?? status.route
    return { operation, sessionId: this.sessionId, requestId: `${this.requestPrefix}-${++this.sequence}`,
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
      && (result.outcome === undefined || result.outcome === 'suggestion' && typeof result.text === 'string'
        || result.outcome === 'abstained' && result.text === null
        || result.outcome === 'throttled' && result.text === null && Number.isFinite(result.retryAfterMs) && result.retryAfterMs! > 0 && result.retryAfterMs! <= 30000)
  }
  private sameCaret(span: TokenSpan): boolean {
    const current = this.binding?.actions.captureInsertion()
    return Boolean(current && current.start === span.start && current.end === span.end && current.draftRev === span.draftRev)
  }
  private routeKey(route?: ModelRoute): string { return route ? JSON.stringify([route.provider, route.model]) : '' }
  private nextKey(): string {
    const settings = this.state.settings
    const route = settings.provider && settings.model ? { provider: settings.provider, model: settings.model } : this.binding?.route ?? this.state.status?.route
    return JSON.stringify([this.state.status?.generation, this.state.status?.sourceTurnId, this.routeKey(route)])
  }
  private completionKey(): string { return JSON.stringify([this.state.status?.generation, this.state.status?.sourceTurnId, this.routeKey(this.binding?.route ?? this.state.status?.route), this.binding?.input.draft]) }
  private invalidate(dropCache: boolean, cancelInFlight = true): void {
    // A transient status read failure is not evidence that the draft, turn or
    // model changed, so it must not destroy a manual optimization the user is
    // waiting on. Automatic suggestions are still cleared: they are cheap to
    // regenerate, and a stale ghost must never outlive a lost connection.
    if (cancelInFlight) this.cancelActive()
    else if (this.active?.snapshot.operation !== 'optimize') this.cancelActive()
    this.clearTimer()
    if (dropCache) { this.nextCache = null; this.completionCache.clear(); this.failedCompletionKey = null; this.failedNextKey = null; this.completionRetryAt = 0 }
    this.patch({ suggestion: null, ...(cancelInFlight ? { preview: null } : {}) })
  }
  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined; this.timerKey = null; this.manualTimerKey = null }
  private cancelActive(): void {
    const active = this.active
    if (!active) return
    this.active = null
    this.recordLatency(active)
    active.controller.abort()
    void this.transport.call('cancel', { sessionId: this.sessionId, requestId: active.snapshot.requestId }).catch(() => {})
    if (active.snapshot.operation === 'optimize') this.patch({ busy: null })
    else this.suggestionStatus('idle', '')
  }
  private recordLatency(active: ActiveRequest): void {
    if (active.latencyRecorded) return
    active.latencyRecorded = true
    this.patch({ metrics: { ...this.state.metrics, totalLatencyMs: this.state.metrics.totalLatencyMs + Math.max(0, Date.now() - active.startedAt) } })
  }
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作失败，原稿已保留，请稍后重试' }
}
