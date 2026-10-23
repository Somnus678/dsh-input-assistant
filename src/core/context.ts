import type { HistoryMessage } from './types'
export const charCount = (text: string): number => Array.from(text).length
function clip(text: string, limit: number): string {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  if (limit < 12) return chars.slice(-limit).join('')
  const label = '\n[…节选…]\n'
  const room = limit - charCount(label)
  return chars.slice(0, Math.ceil(room / 2)).join('') + label + chars.slice(-Math.floor(room / 2)).join('')
}

/** Preserve the initial task, latest correction, and latest answer before filling the remaining tail. */
export function buildContext(history: readonly HistoryMessage[], budget = 16000): HistoryMessage[] {
  if (budget <= 0) return []
  const messages = history.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
  if (messages.reduce((sum, m) => sum + charCount(m.text), 0) <= budget) return messages.map(m => ({ ...m }))
  const selected = new Map<number, HistoryMessage>()
  let remaining = budget
  const take = (index: number, allowance: number) => {
    if (index < 0 || selected.has(index) || remaining <= 0) return
    const text = clip(messages[index].text, Math.max(1, Math.min(remaining, allowance)))
    selected.set(index, { ...messages[index], text }); remaining -= charCount(text)
  }
  const lastUser = messages.findLastIndex(m => m.role === 'user')
  const lastAssistant = messages.findLastIndex(m => m.role === 'assistant')
  const firstUser = messages.findIndex(m => m.role === 'user')
  take(lastUser, Math.floor(budget * .35))
  take(lastAssistant, Math.floor(budget * .4))
  take(firstUser, Math.floor(budget * .125))
  for (let i = messages.length - 1; i >= 0; i--) take(i, remaining)
  return [...selected.entries()].sort(([a], [b]) => a - b).map(([, message]) => message)
}
