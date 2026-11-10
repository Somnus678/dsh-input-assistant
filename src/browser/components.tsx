import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { diffText } from '../core/diff.js'
import type { StoredDraft } from '../core/types.js'
import { canUseTab, findEditor, focusedIn, measureGhost, nativeMenuOpen, type GhostGeometry } from './dom.js'
import type { BrowserRuntime } from './runtime.js'
import type { InputAssistantController } from './controller.js'
import { placeFloating, type FloatingPlacement } from './floating.js'

type RuntimeProps = { runtime: BrowserRuntime }
type RightProps = PropsRuntime<'conversation.input.right'> & RuntimeProps
type OverlayProps = PropsRuntime<'conversation.input.overlay'> & RuntimeProps
const EMPTY_MODEL = { current: null }
const noopSubscribe = (): (() => void) => () => {}

function useFloatingPlacement(anchor: RefObject<HTMLElement>, surface: RefObject<HTMLElement>, visible: boolean, card = false): FloatingPlacement | null {
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null)
  useLayoutEffect(() => {
    if (!visible) { setPlacement(null); return }
    const update = () => {
      const trigger = card ? findEditor(anchor.current)?.closest<HTMLElement>('[data-composer-card]') : anchor.current
      const element = surface.current
      if (!trigger || !element) return
      const viewport = window.visualViewport
      const bounds = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight }
      const rect = trigger.getBoundingClientRect()
      const next = placeFloating(rect, element.scrollHeight || element.getBoundingClientRect().height || 160, bounds,
        card ? Math.min(640, rect.width || 480) : 480)
      setPlacement(previous => previous && Object.keys(next).every(key => previous[key as keyof FloatingPlacement] === next[key as keyof FloatingPlacement]) ? previous : next)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    if (surface.current) observer?.observe(surface.current)
    if (anchor.current) observer?.observe(anchor.current)
    return () => {
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [anchor, surface, visible, card])
  return placement
}

function useController(runtime: BrowserRuntime, sessionId: string) {
  const controller = useMemo(() => runtime.controllerFor(sessionId), [runtime, sessionId])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => runtime.retain(sessionId), [runtime, sessionId])
  return { controller, state }
}

/** The right slot owns input observation; the overlay only paints the same controller's state. */
export function AssistantRight({ runtime, sessionId, useInput, useSession, inputActions }: RightProps) {
  const { controller, state } = useController(runtime, sessionId)
  const input = useInput(value => value)
  const running = useSession(value => value.running)
  const removed = useSession(value => value.removed)
  const generation = useSyncExternalStore(runtime.connection.generation.subscribe.bind(runtime.connection.generation),
    () => runtime.transport.generation(), () => null)
  const directory = useMemo(() => runtime.models?.directoryFor(sessionId), [runtime, sessionId])
  const model = useSyncExternalStore(directory?.store.subscribe.bind(directory.store) ?? noopSubscribe,
    directory?.store.getSnapshot.bind(directory.store) ?? (() => EMPTY_MODEL), () => EMPTY_MODEL)
  const anchor = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const previewFocused = useRef(false)
  const setPreviewRef = useCallback((node: HTMLDivElement | null) => {
    const previous = previewRef.current
    if (!node && previous && (previewFocused.current || previous.contains(document.activeElement))) {
      queueMicrotask(() => {
        if (!previous.isConnected && document.activeElement === document.body && anchor.current?.isConnected) findEditor(anchor.current)?.focus()
      })
    }
    previewRef.current = node
    previewFocused.current = Boolean(node?.contains(document.activeElement))
  }, [])
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const keyboardOpen = useRef(false)
  const keyboardOptimize = useRef(false)
  const composing = useRef(false)
  const [isComposing, setIsComposing] = useState(false)
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const menuPlacement = useFloatingPlacement(anchor, menuRef, open)
  const previewPlacement = useFloatingPlacement(anchor, previewRef, Boolean(state.preview), true)
  const noticePlacement = useFloatingPlacement(anchor, noticeRef, !open && !state.preview && Boolean(state.notice || state.deletedDrafts.length || state.pendingUndoDrafts.length))
  useEffect(() => {
    const focusChanged = (event: FocusEvent) => { previewFocused.current = event.target instanceof Node && Boolean(previewRef.current?.contains(event.target)) }
    const pointerChanged = (event: PointerEvent) => { if (event.target instanceof Node && !previewRef.current?.contains(event.target)) previewFocused.current = false }
    document.addEventListener('focusin', focusChanged)
    document.addEventListener('pointerdown', pointerChanged)
    return () => { document.removeEventListener('focusin', focusChanged); document.removeEventListener('pointerdown', pointerChanged) }
  }, [])
  useEffect(() => { void directory?.load().catch(() => {}) }, [directory])
  useLayoutEffect(() => {
    if (removed) { controller.dispose(); return }
    controller.bind({ sessionId, input, actions: inputActions, running, editor: findEditor(anchor.current), route: model.current ?? undefined })
  }, [controller, sessionId, input, inputActions, running, model.current, removed, generation])
  useEffect(() => {
    const editor = findEditor(anchor.current)
    if (!editor) return
    const selectionChanged = () => controller.notifySelectionChange()
    const compositionStart = () => { composing.current = true; setIsComposing(true); controller.setComposing(true) }
    const compositionEnd = () => { composing.current = false; setIsComposing(false); controller.setComposing(false) }
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || composing.current || event.isComposing || event.keyCode === 229 || editor.hasAttribute('data-composer-composing') || nativeMenuOpen(editor)) return
      const current = controller.getSnapshot()
      if (event.key === 'Escape') {
        const target = document.activeElement
        const inside = focusedIn(editor) || anchor.current?.contains(target) || menuRef.current?.contains(target) || previewRef.current?.contains(target)
        if (!inside) return
        if (current.preview) { controller.dismissOptimization(); editor.focus() }
        else if (open) { setOpen(false); menuTrigger.current?.focus() }
        else if (current.suggestion) controller.dismissSuggestion()
        else return
        event.preventDefault()
        return
      }
      if (!current.suggestion || !canUseTab(event, editor, false)) return
      if (![...document.querySelectorAll('[data-dsh-ia-visible-suggestion]')].some(node => node.getAttribute('data-dsh-ia-session') === sessionId)) return
      if (controller.acceptSuggestion()) event.preventDefault()
    }
    document.addEventListener('selectionchange', selectionChanged)
    editor.addEventListener('focus', selectionChanged)
    editor.addEventListener('blur', selectionChanged)
    editor.addEventListener('compositionstart', compositionStart)
    editor.addEventListener('compositionend', compositionEnd)
    window.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('selectionchange', selectionChanged)
      editor.removeEventListener('focus', selectionChanged)
      editor.removeEventListener('blur', selectionChanged)
      editor.removeEventListener('compositionstart', compositionStart)
      editor.removeEventListener('compositionend', compositionEnd)
      window.removeEventListener('keydown', keyDown)
    }
  }, [controller, sessionId, open])
  useLayoutEffect(() => {
    if (open && menuPlacement && keyboardOpen.current) {
      (menuRef.current?.querySelector<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? menuRef.current)?.focus()
      keyboardOpen.current = false
    }
  }, [open, menuPlacement])
  useLayoutEffect(() => {
    if (state.preview && previewPlacement && (keyboardOptimize.current || anchor.current?.contains(document.activeElement))) {
      previewRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      keyboardOptimize.current = false
    }
  }, [state.preview, previewPlacement])
  useEffect(() => { if (state.preview) setOpen(false) }, [state.preview])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [open])
  const preserveSelection = (event: React.PointerEvent) => { event.preventDefault() }
  const canEdit = input.phase === 'plain' && !state.busy && !state.settingsSaving
  const canOptimize = canEdit && !state.preview && state.settings.optimizeEnabled
  const pure = !input.occurrences.length && !input.attachmentIds.length
  const auxiliaryRoute = state.settings.provider && state.settings.model
    ? { provider: state.settings.provider, model: state.settings.model } : model.current ?? state.status?.route
  const requestingSuggestion = state.suggestionStatus === 'generating'
  const canRequestSuggestion = canEdit && pure && !isComposing && !state.preview && state.connected && !running && !state.status?.running && !requestingSuggestion
  const retryLabel = state.suggestionStatus === 'failed' || state.suggestionStatus === 'abstained' ? '重试本次建议' : '生成建议'
  const predict = () => { findEditor(anchor.current)?.focus(); controller.retrySuggestion() }
  return <div className="dsh-ia dsh-ia-root" ref={anchor} data-dsh-input-assistant="">
    <button className="dsh-ia-trigger" type="button" disabled={!canOptimize || !input.draft.trim() || !state.connected}
      onPointerDown={preserveSelection} onClick={event => { keyboardOptimize.current = event.detail === 0; void controller.optimize() }} title="有选区时优化选区，否则优化整稿">{state.busy === 'optimize' ? '优化中…' : '优化'}</button>
    <button className="dsh-ia-trigger dsh-ia-predict-btn" type="button" aria-label="预测" disabled={!canRequestSuggestion}
      onPointerDown={preserveSelection} onClick={predict} title="生成一次预测，查看候选后由你采纳；不会直接改写或发送">{requestingSuggestion ? '预测中…' : '预测'}</button>
    {state.busy === 'optimize' && <button className="dsh-ia-cancel-btn" type="button" onClick={() => { controller.cancelOperation(); findEditor(anchor.current)?.focus() }}>取消优化</button>}
    {!state.busy && requestingSuggestion && <button className="dsh-ia-cancel-btn" type="button" onClick={() => { controller.cancelOperation(); findEditor(anchor.current)?.focus() }}>取消预测</button>}
    {state.busy === 'stash' && state.stashClearPending && !state.stashClearCancelled && <button className="dsh-ia-cancel-btn" type="button" onClick={() => controller.cancelOperation()}>取消清空</button>}
    {!open && !state.preview && state.suggestionStatus === 'failed' && <span className="dsh-ia-inline-status">
      <span role="status">建议未完成</span><button type="button" aria-label="重试建议" title={state.suggestionMessage} disabled={!canRequestSuggestion}
        onPointerDown={preserveSelection} onClick={predict}>重试</button>
    </span>}
    <button ref={menuTrigger} className="dsh-ia-menu-btn" type="button" aria-label="输入助手菜单" aria-expanded={open} aria-haspopup="dialog" aria-controls={menuId}
      title={auxiliaryRoute ? `辅助模型：${auxiliaryRoute.provider} / ${auxiliaryRoute.model}` : '输入助手菜单'}
      onPointerDown={preserveSelection} onClick={event => { keyboardOpen.current = event.detail === 0; setOpen(value => !value) }}>▾</button>
    {!open && !state.preview && (state.notice || state.deletedDrafts.length > 0 || state.pendingUndoDrafts.length > 0) && createPortal(<div ref={noticeRef} role="status" className="dsh-ia dsh-ia-notice"
      style={noticePlacement ?? { visibility: 'hidden' }}><span>{state.notice}</span>
      {state.deletedDrafts.length > 0 && <button type="button" disabled={Boolean(state.busy)} onClick={() => { void controller.undoDeleteDrafts() }}>撤销删除</button>}
      {state.deletedDrafts.length > 0 && <button type="button" onClick={() => { void copyText(state.deletedDrafts.map(draft => draft.text).join('\n\n'), controller, '备份已复制') }}>复制删除备份</button>}
      <PendingUndo drafts={state.pendingUndoDrafts} controller={controller} busy={Boolean(state.busy)} />
      {state.notice && <button type="button" aria-label="关闭提示" onClick={() => controller.clearNotice()}>×</button>}</div>, document.body)}
    {state.preview && createPortal(<div ref={setPreviewRef} className="dsh-ia dsh-ia-menu dsh-ia-preview" role="dialog" aria-label="优化预览"
      style={previewPlacement ?? { visibility: 'hidden' }}>
      <strong>优化预览</strong><p className="dsh-ia-muted">原稿尚未修改。查看增删内容后决定是否采纳；采纳后仍由你发送。</p>
      <DiffView before={state.preview.beforeTarget} after={state.preview.text} />
      <div className="dsh-ia-row"><button type="button" disabled={!state.connected || state.settingsSaving || Boolean(state.busy)} onPointerDown={preserveSelection}
        onClick={() => { if (controller.applyOptimization()) findEditor(anchor.current)?.focus() }}>采纳优化</button>
        <button type="button" onClick={() => { controller.dismissOptimization(); findEditor(anchor.current)?.focus() }}>保留原文</button></div>
    </div>, document.body)}
    {open && createPortal(<div id={menuId} ref={menuRef} role="dialog" tabIndex={-1} className="dsh-ia dsh-ia-menu" aria-label="输入助手" style={menuPlacement ?? { visibility: 'hidden' }}>
      <strong>输入助手</strong><div className="dsh-ia-muted">当前会话草稿与快捷操作 · 采纳后由你发送</div>
      {state.settingsSaving && <div role="status">设置保存中…</div>}
      <label>优化强度 <select aria-label="优化强度" value={state.settings.optimizationStrength} disabled={state.settingsSaving || !state.settings.optimizeEnabled}
        onChange={event => { void controller.updateSettings({ optimizationStrength: event.target.value as 'light' | 'standard' | 'deep' }) }}>
        <option value="light">轻度润色</option><option value="standard">标准优化</option><option value="deep">深度梳理</option></select></label>
      <div className="dsh-ia-muted">优化强度为全局设置，对所有会话生效。</div>
      <label>预测详略度 <select aria-label="预测详略度" value={state.settings.predictionDetail} disabled={state.settingsSaving}
        onChange={event => { void controller.updateSettings({ predictionDetail: event.target.value as 'concise' | 'standard' | 'detailed' }) }}>
        <option value="concise">简明</option><option value="standard">标准</option><option value="detailed">详尽</option></select></label>
      <div className="dsh-ia-muted">预测详略度为全局设置；详尽模式可提供多行结构，仍遵守长度上限。</div>
      {(state.notice || state.deletedDrafts.length > 0 || state.pendingUndoDrafts.length > 0) && <div className="dsh-ia-notice" role="status">{state.notice}
        {state.deletedDrafts.length > 0 && <button type="button" disabled={Boolean(state.busy)} onClick={() => { void controller.undoDeleteDrafts() }}>撤销删除</button>}
        {state.deletedDrafts.length > 0 && <button type="button" onClick={() => { void copyText(state.deletedDrafts.map(draft => draft.text).join('\n\n'), controller, '备份已复制') }}>复制删除备份</button>}
        <PendingUndo drafts={state.pendingUndoDrafts} controller={controller} busy={Boolean(state.busy)} /></div>}
      <div className="dsh-ia-row">
        <button type="button" disabled={!canOptimize} onPointerDown={preserveSelection} onClick={() => controller.lockSelection()}>保护选中原文{state.locked.length ? ` (${state.locked.length})` : ''}</button>
        {state.locked.length > 0 && <button type="button" onClick={() => controller.clearLocks()}>清除保护</button>}
      </div>
      <div className="dsh-ia-muted">代码、路径和网址自动保护；手动保护在编辑草稿后清除。</div>
      {state.change && <details className="dsh-ia-section">
        <summary>查看改动</summary>
        <DiffView before={state.change.beforeTarget} after={state.change.afterTarget} />
        <div className="dsh-ia-row">
          <button type="button" disabled={!controller.canRestore()} onPointerDown={preserveSelection} onClick={() => controller.restoreOriginal()}>还原</button>
          <button type="button" onClick={() => { void copyText(state.change!.beforeTarget, controller) }}>复制原文</button>
        </div>
        {!controller.canRestore() && <div className="dsh-ia-muted">草稿已有新编辑，原文仍可复制。</div>}
      </details>}
      <section className="dsh-ia-section">
        <h4>草稿暂存 ({state.drafts.length}/3)</h4>
        <button type="button" disabled={!state.settings.stashEnabled || !canEdit || !pure || !input.draft.trim() || state.drafts.length >= 3} onPointerDown={preserveSelection} onClick={() => { void controller.stash() }}>暂存并清空</button>
        {!state.settings.stashEnabled && <p className="dsh-ia-muted">暂存已关闭；历史草稿仍可查看和删除，重新启用后可恢复。</p>}
        {!pure && <p className="dsh-ia-muted">暂存和恢复仅支持无引用、无附件的纯文本草稿。</p>}
        {state.drafts.map(draft => <DraftCard key={draft.id} draft={draft} controller={controller} canEdit={state.settings.stashEnabled && canEdit && pure}
          canReplace={state.settings.stashEnabled && canEdit && pure && Boolean(input.draft.trim()) && state.drafts.length >= 3} />)}
        {state.drafts.length === 0 && <p className="dsh-ia-muted">暂存后可以先追问别的，再找回原来的草稿。</p>}
        {state.drafts.length > 0 && <button type="button" disabled={Boolean(state.busy)} onClick={() => { void controller.clearDrafts() }}>清空暂存</button>}
      </section>
      <section className="dsh-ia-section">
        <h4>输入建议</h4>
        <div className="dsh-ia-muted dsh-ia-route">辅助模型：{auxiliaryRoute ? `${auxiliaryRoute.provider} / ${auxiliaryRoute.model}` : '尚未选择'}{state.settings.provider ? '（固定）' : '（跟随输入框）'}</div>
        <div className="dsh-ia-suggestion-state" role="status" aria-label="输入建议状态" aria-live="polite">{state.suggestionMessage || '可手动生成一次建议；开启自动建议后也会按设置触发。'}</div>
        <div className="dsh-ia-muted">Tab 采纳，Esc 忽略；建议不会自动发送。</div>
        {!pure && <div className="dsh-ia-muted">手动建议仅支持无附件、无引用的纯文本草稿。</div>}
        <div className="dsh-ia-row"><button type="button" disabled={!canRequestSuggestion} onPointerDown={preserveSelection} onClick={() => { predict(); setOpen(false) }}>{retryLabel}</button>
          <button type="button" onClick={() => controller.dismissSuggestion()}>暂停至下次编辑</button></div>
      </section>
      <details className="dsh-ia-section"><summary>本次使用统计</summary>
        <p className="dsh-ia-muted">当前会话：展示 {state.metrics.exposures} 次，采纳 {state.metrics.accepted} 次，
          采纳后继续编辑 {state.metrics.editedAcceptances} 次，编辑字数约 {state.metrics.editedCharacters}，辅助调用 {state.metrics.calls} 次。</p>
        <div className="dsh-ia-muted">仅保留在本次插件运行内，不上传；忽略建议不会被视为负反馈。</div>
      </details>
      <p className="dsh-ia-muted">功能开关、显示方式与辅助模型：DSH 设置 → 输入助手（全局设置）</p>
    </div>, document.body)}
  </div>
}

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffText(before, after), [before, after])
  return <div className="dsh-ia-pre dsh-ia-diff">{parts.map((part, index) => part.type === 'insert'
    ? <ins key={index}>{part.value}</ins> : part.type === 'delete' ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>
}

function PendingUndo({ drafts, controller, busy }: { drafts: readonly StoredDraft[]; controller: InputAssistantController; busy: boolean }) {
  if (!drafts.length) return null
  return <div className="dsh-ia-pending-undo">
    <details><summary>暂未恢复的草稿 ({drafts.length})</summary><div className="dsh-ia-pre">{drafts.map(draft => draft.text).join('\n\n')}</div></details>
    <div className="dsh-ia-row"><button type="button" disabled={busy} onClick={() => { void controller.undoDeleteDrafts('pending') }}>重试恢复草稿</button>
      <button type="button" onClick={() => { void copyText(drafts.map(draft => draft.text).join('\n\n'), controller, '待恢复草稿已复制') }}>复制待恢复草稿</button>
      <button type="button" disabled={busy} onClick={() => controller.discardPendingUndo()}>放弃此恢复备份</button></div>
  </div>
}

function DraftCard({ draft, controller, canEdit, canReplace }: { draft: StoredDraft; controller: InputAssistantController; canEdit: boolean; canReplace: boolean }) {
  return <details className="dsh-ia-draft"><summary>{draft.text.split('\n')[0].slice(0, 50) || '未命名草稿'}</summary>
    <time>{new Date(draft.createdAt).toLocaleString()}</time><div className="dsh-ia-pre">{draft.text}</div>
    <div className="dsh-ia-row">
      <button type="button" disabled={!canEdit} onPointerDown={event => event.preventDefault()} onClick={() => controller.restoreDraft(draft, 'append')}>追加</button>
      <button type="button" disabled={!canEdit} onPointerDown={event => event.preventDefault()} onClick={() => controller.restoreDraft(draft, 'replace')}>替换</button>
      <button type="button" onClick={() => { void copyText(draft.text, controller, '草稿已复制') }}>复制草稿</button>
      <button type="button" disabled={Boolean(controller.getSnapshot().busy)} onClick={() => { void controller.deleteDraft(draft.id) }}>删除</button>
      {canReplace && <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => { void controller.stash(draft.id) }}>用当前草稿替换此条</button>}
    </div></details>
}

async function copyText(text: string, controller: InputAssistantController, success = '原文已复制') {
  try { await navigator.clipboard.writeText(text); controller.notice(success) }
  catch { controller.notice('复制不可用，请展开对应文本后手动选择复制') }
}

export function AssistantOverlay({ runtime, sessionId }: OverlayProps) {
  const { controller, state } = useController(runtime, sessionId)
  const anchor = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<GhostGeometry | null>(null)
  const suggestion = state.suggestion
  const displayMode = state.settings.predictionDetail === 'detailed' ? 'panel' : state.settings.displayMode
  const panelPlacement = useFloatingPlacement(anchor, panelRef, Boolean(suggestion) && displayMode === 'panel', true)
  useEffect(() => {
    if (suggestion && ((displayMode === 'panel' && panelPlacement) || geometry)) controller.markExposed(suggestion.snapshot.requestId)
  }, [controller, suggestion, geometry, panelPlacement, displayMode])
  useLayoutEffect(() => {
    if (!suggestion || displayMode !== 'ghost') { setGeometry(null); return }
    const update = () => setGeometry(measureGhost(findEditor(anchor.current), suggestion.snapshot.draft === ''))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('selectionchange', update)
    const editor = findEditor(anchor.current)
    editor?.addEventListener('focus', update)
    editor?.addEventListener('blur', update)
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    if (editor) resize?.observe(editor)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true)
      document.removeEventListener('selectionchange', update); editor?.removeEventListener('focus', update); editor?.removeEventListener('blur', update); resize?.disconnect() }
  }, [suggestion, displayMode])
  const ghostStyle: CSSProperties | undefined = geometry ? { left: geometry.left, top: geometry.top, width: geometry.width,
    maxHeight: `min(3lh, ${geometry.maxHeight}px)`, font: geometry.font, lineHeight: geometry.lineHeight, letterSpacing: geometry.letterSpacing } : undefined
  return <span ref={anchor} className="dsh-ia" style={{ display: 'contents' }}>
    {suggestion && displayMode === 'panel' && createPortal(<div ref={panelRef} className="dsh-ia dsh-ia-candidate" role="status"
      style={panelPlacement ?? { visibility: 'hidden' }} data-dsh-ia-visible-suggestion={panelPlacement ? '' : undefined} data-dsh-ia-session={sessionId}>
      <span className="dsh-ia-candidate-text">{suggestion.text}</span><button type="button" onPointerDown={event => event.preventDefault()} onClick={() => controller.acceptSuggestion()}>采纳</button>
      <button type="button" aria-label="忽略建议" onClick={() => controller.dismissSuggestion()}>×</button></div>, document.body)}
    {suggestion && geometry && displayMode === 'ghost' && <>
      <span className="dsh-ia-sr-only" role="status" aria-atomic="true">有输入建议：{suggestion.text}。按 Tab 采纳，按 Esc 忽略。</span>
      {suggestion.snapshot.draft === '' && <span hidden data-dsh-ia-empty-ghost="" />}
      {createPortal(<span className="dsh-ia dsh-ia-ghost" style={ghostStyle}
        aria-hidden="true" data-dsh-ia-visible-suggestion="" data-dsh-ia-session={sessionId}>{suggestion.text}</span>, document.body)}
    </>}
  </span>
}
