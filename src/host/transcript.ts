import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { HistoryMessage } from '../core/types'
import { buildContext } from '../core/context'

/** Host-only projection: never adds records or messages to the user's session. */
export interface TranscriptState {
  entries: HistoryMessage[]
  currentTurn: number
  sourceTurnId: string | null
  running: boolean
  pendingAssistant: string | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { inputAssistantTranscript: TranscriptState }
}

export const transcriptSchema: z.ZodType<TranscriptState> = z.object({
  entries: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string(), turnId: z.string().optional() })),
  currentTurn: z.number().int().nonnegative(),
  sourceTurnId: z.string().nullable(),
  running: z.boolean(),
  pendingAssistant: z.string().nullable(),
})

export function emptyTranscript(): TranscriptState {
  return { entries: [], currentTurn: 0, sourceTurnId: null, running: false, pendingAssistant: null }
}

function textOf(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
}

/** Retain the initial request and recent exchanges, with a bounded projection cache. */
function retain(entries: HistoryMessage[]): HistoryMessage[] {
  return buildContext(entries, 64_000)
}

export function foldTranscript(state: TranscriptState, event: SessionEvent): TranscriptState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, currentTurn: event.data.turn, sourceTurnId: null, running: true, pendingAssistant: null }
    case 'user/message': {
      // Injected instructions, tool output and recalled chats are not human input.
      if (event.data.source.kind !== 'user') return state
      const text = textOf(event.data.content)
      if (text.length === 0) return state
      return { ...state, entries: retain([...state.entries, { role: 'user', text, turnId: String(state.currentTurn) }]) }
    }
    case 'assistant/message': {
      if (event.data.interrupted || event.data.message.content.some(block => block.type === 'tool-call')) {
        return state.pendingAssistant === null ? state : { ...state, pendingAssistant: null }
      }
      const text = buildContext([{ role: 'assistant', text: textOf(event.data.message.content) }], 64_000)[0]?.text ?? ''
      return { ...state, pendingAssistant: text || null }
    }
    case 'turn/end': {
      const completed = event.data.reason.kind === 'completed'
      const entries = completed && state.pendingAssistant
        ? retain([...state.entries, { role: 'assistant', text: state.pendingAssistant, turnId: String(event.data.turn) }])
        : state.entries
      return { ...state, entries, running: false, pendingAssistant: null, sourceTurnId: completed ? String(event.data.turn) : null }
    }
    default: return state
  }
}
