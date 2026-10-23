// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { canUseTab, clipboardOffset, referenceOverlaps, selectedPlainText } from '../src/browser/dom'
afterEach(() => { document.body.innerHTML = '' })

describe('reference-safe selection mapping', () => {
  it('maps one-character detect references to their full clipboard projection', () => {
    const references = [{ offset: 2, length: 14 }, { offset: 20, length: 4 }]
    expect(clipboardOffset(2, references)).toBe(2)
    expect(clipboardOffset(3, references)).toBe(16)
    expect(clipboardOffset(8, references)).toBe(24)
    expect(referenceOverlaps({ start: 3, end: 6, draftRev: 1 }, references)).toBe(false)
    expect(referenceOverlaps({ start: 1, end: 4, draftRev: 1 }, references)).toBe(true)
  })
  it('allows proven plain text after a chip but refuses a range across it', () => {
    document.body.innerHTML = '<div data-composer-input contenteditable="true"><span data-composer-chip="file">x.ts</span> 改好这里</div>'
    const editor = document.querySelector<HTMLElement>('[data-composer-input]')!
    const range = document.createRange(); range.setStart(editor.lastChild!, 1); range.setEnd(editor.lastChild!, 5)
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    expect(selectedPlainText(editor, '@file:x.ts 改好这里', { start: 2, end: 6, draftRev: 1 }, [{ offset: 0, length: 10 }]))
      .toEqual({ text: '改好这里', clipboardStart: 11, clipboardEnd: 15 })
    range.setStart(editor, 0)
    expect(selectedPlainText(editor, '@file:x.ts 改好这里', { start: 0, end: 6, draftRev: 1 }, [{ offset: 0, length: 10 }])).toBeNull()
  })
})

describe('keyboard coexistence', () => {
  function editor() {
    document.body.innerHTML = '<div data-composer-card><div data-composer-input contenteditable="true" tabindex="0"></div></div>'
    const element = document.querySelector<HTMLElement>('[data-composer-input]')!; element.focus(); return element
  }
  it('lets consumed Tab, Shift+Tab and IME keep their behavior', () => {
    const input = editor(); const consumed = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }); consumed.preventDefault()
    expect(canUseTab(consumed, input, false)).toBe(false)
    expect(canUseTab(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }), input, false)).toBe(false)
    expect(canUseTab(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true }), input, false)).toBe(false)
    expect(canUseTab(new KeyboardEvent('keydown', { key: 'Tab' }), input, false)).toBe(true)
  })
  it('yields to the native trigger menu and other focused inputs', () => {
    const input = editor(); const menu = document.createElement('div'); menu.dataset.triggerMenu = ''; input.parentElement!.append(menu)
    expect(canUseTab(new KeyboardEvent('keydown', { key: 'Tab' }), input, false)).toBe(false)
    menu.remove(); const other = document.createElement('input'); document.body.append(other); other.focus()
    expect(canUseTab(new KeyboardEvent('keydown', { key: 'Tab' }), input, false)).toBe(false)
  })
  it('yields when the native popup is a sibling of the composer card', () => {
    document.body.innerHTML = '<div data-composer-seat><div data-composer-card><div data-composer-input contenteditable="true" tabindex="0"></div></div><div data-trigger-menu></div></div>'
    const input = document.querySelector<HTMLElement>('[data-composer-input]')!; input.focus()
    expect(canUseTab(new KeyboardEvent('keydown', { key: 'Tab' }), input, false)).toBe(false)
  })
})
