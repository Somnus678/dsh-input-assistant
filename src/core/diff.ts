export interface TextChange { type: 'equal' | 'insert' | 'delete'; value: string }

/**
 * Tokenizer for the inspection diff.
 *
 * CJK text carries no spaces, so treating a whole clause as one token makes the
 * diff unreadable (a one-character change replaces the clause). Splitting CJK
 * into individual code points keeps the common characters visible while still
 * grouping Latin words, whitespace runs and punctuation.
 */
const tokenPattern = /(\s+|[^\p{L}\p{N}_]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/u
const split = (text: string): string[] => text.split(tokenPattern).filter(Boolean)

/** Sentence-ish chunks used only when the code-point DP would be too large. */
const coarsePattern = /(\n+|[。！？；，、.!?;]+\s*)/u
const splitCoarse = (text: string): string[] => text.split(coarsePattern).filter(Boolean)

/** Cells a full DP is allowed to allocate; above this the diff degrades to sentence chunks. */
const MAX_CELLS = 1_000_000

function diffTokens(a: readonly string[], b: readonly string[]): TextChange[] {
  const result: TextChange[] = []
  const push = (type: TextChange['type'], value: string) => {
    if (!value) return
    const last = result[result.length - 1]
    if (last?.type === type) last.value += value; else result.push({ type, value })
  }
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1])
    }
  }
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('equal', a[i++]); j++ }
    else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) push('delete', a[i++])
    else push('insert', b[j++])
  }
  return result
}

/** A bounded token diff for inspection; never a claim about semantic fidelity. */
export function diffText(before: string, after: string): TextChange[] {
  if (before === after) return [{ type: 'equal', value: before }]
  const a = split(before), b = split(after)
  // Trim the unchanged head and tail first: real rewrites usually touch one
  // region, and trimming keeps the DP small even for maximum-length drafts.
  let head = 0, tail = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  while (tail < a.length - head && tail < b.length - head && a[a.length - tail - 1] === b[b.length - tail - 1]) tail++
  const middleA = a.slice(head, a.length - tail), middleB = b.slice(head, b.length - tail)
  const result: TextChange[] = []
  const push = (type: TextChange['type'], value: string) => {
    if (!value) return
    const last = result[result.length - 1]
    if (last?.type === type) last.value += value; else result.push({ type, value })
  }
  push('equal', a.slice(0, head).join(''))
  if (middleA.length === 0) push('insert', middleB.join(''))
  else if (middleB.length === 0) push('delete', middleA.join(''))
  else if (middleA.length * middleB.length <= MAX_CELLS) for (const part of diffTokens(middleA, middleB)) push(part.type, part.value)
  else {
    // Too large for a code-point DP: compare sentence-sized chunks so unchanged
    // sentences stay visible and only genuinely edited ones are replaced.
    const coarseA = splitCoarse(middleA.join('')), coarseB = splitCoarse(middleB.join(''))
    if (coarseA.length * coarseB.length <= MAX_CELLS) for (const part of diffTokens(coarseA, coarseB)) push(part.type, part.value)
    else { push('delete', middleA.join('')); push('insert', middleB.join('')) }
  }
  push('equal', tail ? a.slice(a.length - tail).join('') : '')
  return result
}
