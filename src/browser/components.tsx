import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { diffText } from '../core/diff'
import type { StoredDraft } from '../core/types'
import { canUseTab, findEditor, measureGhost, type GhostGeometry } from './dom'
import type { BrowserRuntime } from './runtime'
import type { InputAssistantController } from './controller'
import { placeFloating, type FloatingPlacement } from './floating'

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
        card ? Math.min(640, rect.width || 440) : 440)
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
  const [open, setOpen] = useState(false)
  const menuPlacement = useFloatingPlacement(anchor, menuRef, open)
  const noticePlacement = useFloatingPlacement(anchor, noticeRef, !open && Boolean(state.notice))
  const [provider, setProvider] = useState(state.settings.provider)
  const [modelId, setModelId] = useState(state.settings.model)
  useEffect(() => { void directory?.load().catch(() => {}) }, [directory])
  useEffect(() => { setProvider(state.settings.provider); setModelId(state.settings.model) }, [state.settings.provider, state.settings.model])
  useLayoutEffect(() => {
    if (removed) { controller.dispose(); return }
    controller.bind({ sessionId, input, actions: inputActions, running, editor: findEditor(anchor.current), route: model.current ?? undefined })
  }, [controller, sessionId, input, inputActions, running, model.current, removed, generation])
  useEffect(() => {
    const editor = findEditor(anchor.current)
    if (!editor) return
    const selectionChanged = () => controller.notifySelectionChange()
    const compositionStart = () => controller.setComposing(true)
    const compositionEnd = () => controller.setComposing(false)
    const keyDown = (event: KeyboardEvent) => {
      if (!controller.getSnapshot().suggestion || !canUseTab(event, editor, false)) return
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
  }, [controller, sessionId])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { setOpen(false); event.preventDefault() } }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [open])
  const preserveSelection = (event: React.PointerEvent) => { event.preventDefault() }
  const canEdit = input.phase === 'plain' && !state.busy && !state.settingsSaving
  const canOptimize = canEdit && state.settings.optimizeEnabled
  const pure = !input.occurrences.length && !input.attachmentIds.length
  return <div className="dsh-ia dsh-ia-root" ref={anchor} data-dsh-input-assistant="">
    <button className="dsh-ia-trigger" type="button" disabled={!canOptimize || !input.draft.trim() || !state.connected}
      onPointerDown={preserveSelection} onClick={() => { void controller.optimize() }} title="有选区时优化选区，否则优化整稿">{state.busy === 'optimize' ? '优化中…' : '优化'}</button>
    <button type="button" aria-label="输入助手菜单" aria-expanded={open} onPointerDown={preserveSelection} onClick={() => setOpen(value => !value)}>▾</button>
    {!open && state.notice && createPortal(<div ref={noticeRef} role="status" className="dsh-ia dsh-ia-notice"
      style={noticePlacement ?? { visibility: 'hidden' }} onClick={() => controller.clearNotice()}>{state.notice}</div>, document.body)}
    {open && createPortal(<div ref={menuRef} className="dsh-ia dsh-ia-menu" aria-label="输入助手" style={menuPlacement ?? { visibility: 'hidden' }}>
      <strong>输入助手</strong><div className="dsh-ia-muted">当前会话 · 采纳后由你发送</div>
      {state.settingsSaving && <div role="status">设置保存中…</div>}
      <div className="dsh-ia-row">
        <label><input type="checkbox" disabled={state.settingsSaving} checked={state.settings.optimizeEnabled} onChange={event => { void controller.updateSettings({ optimizeEnabled: event.target.checked }) }} />提示词优化</label>
        <label><input type="checkbox" disabled={state.settingsSaving} checked={state.settings.stashEnabled} onChange={event => { void controller.updateSettings({ stashEnabled: event.target.checked }) }} />草稿暂存</label>
      </div>
      <label>优化强度 <select aria-label="优化强度" value={state.settings.optimizationStrength} disabled={state.settingsSaving || !state.settings.optimizeEnabled}
        onChange={event => { void controller.updateSettings({ optimizationStrength: event.target.value as 'light' | 'standard' | 'deep' }) }}>
        <option value="light">轻度润色</option><option value="standard">标准优化</option><option value="deep">深度梳理</option></select></label>
      {state.notice && <div className="dsh-ia-notice" role="status">{state.notice}</div>}
      <div className="dsh-ia-row">
        <button type="button" disabled={!canOptimize} onPointerDown={preserveSelection} onClick={() => controller.lockSelection()}>保护选中原文{state.locked.length ? ` (${state.locked.length})` : ''}</button>
        {state.locked.length > 0 && <button type="button" onClick={() => controller.clearLocks()}>清除保护</button>}
      </div>
      <div className="dsh-ia-muted">代码、路径和网址自动保护；手动保护在编辑草稿后清除。</div>
      {state.change && <details className="dsh-ia-section">
        <summary>查看改动</summary>
        <div className="dsh-ia-pre dsh-ia-diff">{diffText(state.change.beforeTarget, state.change.afterTarget).map((part, index) => part.type === 'insert'
          ? <ins key={index}>{part.value}</ins> : part.type === 'delete' ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>
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
        {state.drafts.length > 0 && <button type="button" onClick={() => { void controller.clearDrafts() }}>清空暂存</button>}
      </section>
      <section className="dsh-ia-section">
        <h4>输入建议</h4>
        <div className="dsh-ia-row"><label><input type="checkbox" disabled={state.settingsSaving} checked={state.settings.nextEnabled} onChange={event => { void controller.updateSettings({ nextEnabled: event.target.checked }) }} />回复后预测</label>
          <label><input type="checkbox" disabled={state.settingsSaving} checked={state.settings.completionEnabled} onChange={event => { void controller.updateSettings({ completionEnabled: event.target.checked }) }} />输入续写</label></div>
        <label>显示方式 <select aria-label="显示方式" disabled={state.settingsSaving} value={state.settings.displayMode} onChange={event => { void controller.updateSettings({ displayMode: event.target.value as 'ghost' | 'panel' }) }}>
          <option value="ghost">灰字</option><option value="panel">候选面板</option></select></label>
        <div className="dsh-ia-row"><button type="button" onClick={() => controller.dismissSuggestion()}>暂停至下次编辑</button></div>
      </section>
      <details className="dsh-ia-section"><summary>辅助模型设置</summary>
        <div className="dsh-ia-muted">两项留空时跟随输入框模型；辅助调用单独消耗模型用量。</div>
        <label className="dsh-ia-field">提供商<input disabled={state.settingsSaving} value={provider} onChange={event => setProvider(event.target.value)} placeholder="跟随输入框" autoComplete="off" /></label>
        <label className="dsh-ia-field">模型<input disabled={state.settingsSaving} value={modelId} onChange={event => setModelId(event.target.value)} placeholder="跟随输入框" autoComplete="off" /></label>
        <button type="button" disabled={state.settingsSaving} onClick={() => { void controller.updateSettings({ provider, model: modelId }) }}>保存模型设置</button>
      </details>
      <details className="dsh-ia-section"><summary>本次使用统计</summary>
        <p className="dsh-ia-muted">当前会话：展示 {state.metrics.exposures} 次，采纳 {state.metrics.accepted} 次，
          采纳后继续编辑 {state.metrics.editedAcceptances} 次，编辑字数约 {state.metrics.editedCharacters}，辅助调用 {state.metrics.calls} 次。</p>
        <div className="dsh-ia-muted">仅保留在本次插件运行内，不上传；忽略建议不会被视为负反馈。</div>
      </details>
      <p className="dsh-ia-muted">更多设置：DSH 设置 → 输入助手</p>
    </div>, document.body)}
  </div>
}

function DraftCard({ draft, controller, canEdit, canReplace }: { draft: StoredDraft; controller: InputAssistantController; canEdit: boolean; canReplace: boolean }) {
  return <details className="dsh-ia-draft"><summary>{draft.text.split('\n')[0].slice(0, 50) || '未命名草稿'}</summary>
    <time>{new Date(draft.createdAt).toLocaleString()}</time><div className="dsh-ia-pre">{draft.text}</div>
    <div className="dsh-ia-row">
      <button type="button" disabled={!canEdit} onPointerDown={event => event.preventDefault()} onClick={() => controller.restoreDraft(draft, 'append')}>追加</button>
      <button type="button" disabled={!canEdit} onPointerDown={event => event.preventDefault()} onClick={() => controller.restoreDraft(draft, 'replace')}>替换</button>
      <button type="button" onClick={() => { void controller.deleteDraft(draft.id) }}>删除</button>
      {canReplace && <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => { void controller.stash(draft.id) }}>用当前草稿替换此条</button>}
    </div></details>
}

async function copyText(text: string, controller: InputAssistantController) {
  try { await navigator.clipboard.writeText(text); controller.notice('原文已复制') }
  catch { controller.notice('复制不可用，请在改动面板手动选择原文') }
}

export function AssistantOverlay({ runtime, sessionId }: OverlayProps) {
  const { controller, state } = useController(runtime, sessionId)
  const anchor = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<GhostGeometry | null>(null)
  const suggestion = state.suggestion
  const panelPlacement = useFloatingPlacement(anchor, panelRef, Boolean(suggestion) && state.settings.displayMode === 'panel', true)
  useEffect(() => {
    if (suggestion && ((state.settings.displayMode === 'panel' && panelPlacement) || geometry)) controller.markExposed(suggestion.snapshot.requestId)
  }, [controller, suggestion, geometry, panelPlacement, state.settings.displayMode])
  useLayoutEffect(() => {
    if (!suggestion || state.settings.displayMode !== 'ghost') { setGeometry(null); return }
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
  }, [suggestion, state.settings.displayMode])
  const ghostStyle: CSSProperties | undefined = geometry ? { left: geometry.left, top: geometry.top, width: geometry.width,
    maxHeight: `min(3lh, ${geometry.maxHeight}px)`, font: geometry.font, lineHeight: geometry.lineHeight, letterSpacing: geometry.letterSpacing } : undefined
  return <span ref={anchor} className="dsh-ia" style={{ display: 'contents' }}>
    {suggestion && state.settings.displayMode === 'panel' && createPortal(<div ref={panelRef} className="dsh-ia dsh-ia-candidate" role="status"
      style={panelPlacement ?? { visibility: 'hidden' }} data-dsh-ia-visible-suggestion={panelPlacement ? '' : undefined} data-dsh-ia-session={sessionId}>
      <span className="dsh-ia-candidate-text">{suggestion.text}</span><button type="button" onPointerDown={event => event.preventDefault()} onClick={() => controller.acceptSuggestion()}>采纳</button>
      <button type="button" aria-label="忽略建议" onClick={() => controller.dismissSuggestion()}>×</button></div>, document.body)}
    {suggestion && geometry && state.settings.displayMode === 'ghost' && <>
      {suggestion.snapshot.draft === '' && <span hidden data-dsh-ia-empty-ghost="" />}
      {createPortal(<span className="dsh-ia dsh-ia-ghost" style={ghostStyle}
        aria-hidden="true" data-dsh-ia-visible-suggestion="" data-dsh-ia-session={sessionId}>{suggestion.text}</span>, document.body)}
    </>}
  </span>
}
