import type { TokenSpan } from '../core/types'

export interface ReferenceOccurrence { offset: number; length: number }
export const CHIP_SELECTOR = '[data-composer-chip],[data-composer-text-ref],[data-composer-command]'

export function findEditor(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.closest('[data-composer-card]')?.querySelector<HTMLElement>('[data-composer-input]') ?? null
}

export function focusedIn(editor: HTMLElement | null): boolean {
  return editor !== null && (document.activeElement === editor || editor.contains(document.activeElement))
}

export function referenceOverlaps(span: TokenSpan, references: readonly ReferenceOccurrence[]): boolean {
  let shrink = 0
  for (const reference of references) {
    const start = reference.offset - shrink
    if (span.start < start + 1 && span.end > start) return true
    shrink += reference.length - 1
  }
  return false
}

/** Public InputState references use clipboard offsets; TokenSpan uses one character per reference. */
export function clipboardOffset(detectOffset: number, references: readonly ReferenceOccurrence[]): number {
  let shrink = 0
  for (const reference of references) {
    const start = reference.offset - shrink
    if (detectOffset <= start) break
    shrink += reference.length - 1
  }
  return detectOffset + shrink
}

export function selectedPlainText(
  editor: HTMLElement | null, draft: string, span: TokenSpan,
  references: readonly ReferenceOccurrence[],
): { text: string; clipboardStart: number; clipboardEnd: number } | null {
  if (span.start === span.end) return null
  if (referenceOverlaps(span, references)) return null
  const selection = editor?.ownerDocument.getSelection()
  if (!editor || !selection || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null
  for (const chip of editor.querySelectorAll(CHIP_SELECTOR)) {
    if (range.intersectsNode(chip)) return null
  }
  const clipboardStart = clipboardOffset(span.start, references)
  const clipboardEnd = clipboardOffset(span.end, references)
  const text = draft.slice(clipboardStart, clipboardEnd)
  if (!text) return null
  // Native Range supplies an independent plain-text proof for reference-bearing drafts.
  if (references.length && range.toString() !== text) return null
  return { text, clipboardStart, clipboardEnd }
}

export interface GhostGeometry {
  left: number; top: number; width: number; maxHeight: number; font: string; lineHeight: string; letterSpacing: string
}

/** Read-only DOM measurements; failure hides the decoration instead of guessing padding. */
export function measureGhost(editor: HTMLElement | null, empty: boolean): GhostGeometry | null {
  if (!editor || !focusedIn(editor)) return null
  const editorBox = editor.getBoundingClientRect()
  if (editorBox.width <= 0 || editorBox.height <= 0) return null
  const style = getComputedStyle(editor)
  const selection = editor.ownerDocument.getSelection()
  let rect: DOMRect | null = null
  if (selection?.rangeCount === 1) {
    const range = selection.getRangeAt(0)
    if (!range.collapsed || !editor.contains(range.startContainer)) return null
    if (typeof range.getBoundingClientRect === 'function') {
      const measured = range.getBoundingClientRect()
      if (measured.height > 0 && measured.left >= editorBox.left - 1 && measured.left <= editorBox.right + 1) rect = measured
    }
    if (!rect && !empty && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      const preceding = range.cloneRange()
      preceding.setStart(range.startContainer, range.startOffset - 1)
      const last = preceding.getBoundingClientRect()
      if (last.height > 0) rect = new DOMRect(last.right, last.top, 0, last.height)
    }
  }
  if (!rect && empty) {
    rect = new DOMRect(editorBox.left + parseFloat(style.paddingLeft || '0'), editorBox.top + parseFloat(style.paddingTop || '0'), 0, parseFloat(style.lineHeight) || parseFloat(style.fontSize))
  }
  if (!rect) return null
  // The decoration is portalled outside clipped/paint-contained ancestors. Keep
  // its visible area inside the same intersection that clips the native caret.
  const viewport = window.visualViewport
  const visible = { left: Math.max(editorBox.left, viewport?.offsetLeft ?? 0),
    top: Math.max(editorBox.top, viewport?.offsetTop ?? 0),
    right: Math.min(editorBox.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)),
    bottom: Math.min(editorBox.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) }
  for (let ancestor = editor.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const clipping = getComputedStyle(ancestor)
    const paint = /paint|strict|content/.test(clipping.contain)
    const clipX = paint || /hidden|clip|auto|scroll/.test(clipping.overflowX || clipping.overflow)
    const clipY = paint || /hidden|clip|auto|scroll/.test(clipping.overflowY || clipping.overflow)
    if (clipX || clipY) {
      const box = ancestor.getBoundingClientRect()
      if (clipX) { visible.left = Math.max(visible.left, box.left); visible.right = Math.min(visible.right, box.right) }
      if (clipY) { visible.top = Math.max(visible.top, box.top); visible.bottom = Math.min(visible.bottom, box.bottom) }
    }
  }
  if (rect.left < visible.left - 1 || rect.top < visible.top - 1 || rect.bottom > visible.bottom + 1) return null
  const width = Math.min(editorBox.right - parseFloat(style.paddingRight || '0'), visible.right) - rect.left
  if (width < 24) return null
  return { left: rect.left, top: rect.top, width, maxHeight: visible.bottom - rect.top,
    font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing }
}

export function nativeMenuOpen(editor: HTMLElement | null): boolean {
  const scope = editor?.closest('[data-composer-seat]') ?? editor?.closest('[data-composer-card]')
  return Boolean(scope?.querySelector('[data-trigger-menu],[role="listbox"]'))
}

export function canUseTab(event: KeyboardEvent, editor: HTMLElement | null, composing: boolean): boolean {
  return event.key === 'Tab' && !event.defaultPrevented && !event.shiftKey && !event.ctrlKey
    && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229
    && !composing && focusedIn(editor)
    && !editor?.hasAttribute('data-composer-composing')
    && !nativeMenuOpen(editor)
}
