import type { InputSnapshot } from './types'
export function snapshotMatches(expected: InputSnapshot, current: Omit<InputSnapshot, 'requestId'>, checkCaret = true): boolean {
  return expected.sessionId === current.sessionId && expected.sourceTurnId === current.sourceTurnId
    && expected.connectionGeneration === current.connectionGeneration && expected.routeKey === current.routeKey
    && expected.draftRev === current.draftRev && expected.draft === current.draft
    && (!checkCaret || expected.span.start === current.span.start && expected.span.end === current.span.end)
}
