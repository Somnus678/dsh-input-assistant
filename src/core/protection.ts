import { AssistantError } from './types.js'
export interface ProtectedFragment { token: string; original: string }
export interface ProtectedText { original: string; masked: string; fragments: ProtectedFragment[] }

/**
 * Extensions worth protecting when they appear as a bare file name.
 * Deliberately closed: guessing an extension from shape alone would protect
 * ordinary prose such as `e.g.` or `i.e.`.
 */
const FILE_EXTENSIONS = new Set([
  'json', 'jsonc', 'json5', 'md', 'markdown', 'mdx', 'rst',
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi', 'rs', 'go', 'java', 'kt', 'kts', 'scala',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'rb', 'php', 'swift', 'dart', 'lua', 'pl', 'r', 'jl',
  'toml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'properties', 'env',
  'txt', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'lock', 'log',
  'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'sql', 'gradle', 'proto', 'graphql', 'gql', 'tf', 'tfvars',
  'vue', 'svelte', 'astro', 'ex', 'exs', 'erl', 'hs', 'ml', 'clj',
  'npmrc', 'nvmrc', 'editorconfig', 'gitignore', 'gitattributes', 'gitmodules',
  'prettierrc', 'eslintrc', 'stylelintrc', 'babelrc', 'browserslistrc',
])

/** Well-known extensionless project files. */
const NAMED_FILES = new Set([
  'LICENSE', 'LICENCE', 'README', 'CHANGELOG', 'CONTRIBUTING', 'CODEOWNERS',
  'AUTHORS', 'NOTICE', 'Makefile', 'Dockerfile', 'Gemfile', 'Rakefile',
  'Procfile', 'Vagrantfile', 'Jenkinsfile', 'Brewfile',
])

const DOTFILES = ['.env', '.npmrc', '.nvmrc', '.editorconfig', '.gitignore', '.gitattributes', '.gitmodules',
  '.prettierrc', '.eslintrc', '.stylelintrc', '.babelrc', '.browserslistrc']
const candidatePattern = /[\p{L}\p{N}\p{M}_.@+~\\/-]+/uy
const cjk = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]'
const cjkCharacter = new RegExp(cjk, 'u')
const candidateEnding = new RegExp(`(?:\\.[A-Za-z][A-Za-z0-9]{0,11}|${[...NAMED_FILES].join('|')})(?=${cjk}|$)`, 'gu')

function knownFile(value: string): boolean {
  const dot = value.lastIndexOf('.')
  return NAMED_FILES.has(value) || DOTFILES.some(name => value === name || value.startsWith(name + '.'))
    || (dot > 0 && FILE_EXTENSIONS.has(value.slice(dot + 1).toLowerCase()))
}

/** Classify one maximal candidate, rather than retrying a greedy path regex at every character. */
function pathOrFile(value: string): boolean {
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  if (slash < 0) return knownFile(value)
  if (/^(?:\.{1,2}[\\/]|[\\/])/.test(value)) return value.length > slash + 1 || slash > 0
  const tail = value.slice(slash + 1), dot = tail.lastIndexOf('.')
  if (dot >= 0 && /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(tail.slice(dot + 1))) return true
  let separators = 0
  for (const char of value) if (char === '/' || char === '\\') separators++
  return separators >= 2
}

/** Strip adjacent CJK prose before a Latin first component, keeping CJK path components intact. */
function literalStart(value: string): number {
  const slash = value.search(/[\\/]/)
  const first = slash < 0 ? value : value.slice(0, slash)
  if (slash >= 0) {
    const relative = first.match(/(?:\.{1,2}|~)$/)
    if (relative) return relative.index!
  }
  const dot = first.indexOf('.')
  const stem = dot < 0 ? first : first.slice(0, dot)
  let start = 0, previous = '', offset = 0
  for (const char of stem) {
    if (cjkCharacter.test(previous) && /[A-Za-z0-9_@+~-]/.test(char)) start = offset
    previous = char; offset += char.length
  }
  // A known dotfile is an explicit boundary: 编辑.env is not a CJK file name.
  if (!start && dot > 0 && DOTFILES.some(name => first.slice(dot) === name || first.slice(dot).startsWith(name + '.'))
    && Array.from(stem).every(char => cjkCharacter.test(char))) return dot
  return start
}

/** Find file endings before adjacent prose, with bounded extension checks and disjoint slices. */
function candidateRanges(value: string, base: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  let cursor = 0
  candidateEnding.lastIndex = 0
  for (const ending of value.matchAll(candidateEnding)) {
    const end = ending.index! + ending[0].length
    let next = end
    while (next < value.length) {
      const char = String.fromCodePoint(value.codePointAt(next)!)
      if (!cjkCharacter.test(char)) break
      next += char.length
    }
    if (next > end && /[\\/]/.test(value[next] ?? '')) continue
    const portion = value.slice(cursor, end)
    const start = cursor + literalStart(portion)
    if (pathOrFile(value.slice(start, end))) ranges.push({ start: base + start, end: base + end })
    cursor = end
  }
  if (cursor < value.length && /[.\\/]/.test(value.slice(cursor))) {
    const portion = value.slice(cursor)
    const start = cursor + literalStart(portion)
    let end = value.length
    const tailStart = Math.max(start, Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
    // Unquoted Latin extensionless components end at adjacent CJK prose.
    // Entirely CJK component names remain intact; ambiguous mixed names can be quoted/locked.
    const tail = value.slice(tailStart), boundary = tail.search(cjkCharacter)
    if (tailStart >= start && boundary > 0 && /^[A-Za-z0-9_@+~.-]/.test(tail)) end = tailStart + boundary
    if (pathOrFile(value.slice(start, end))) ranges.push({ start: base + start, end: base + end })
  }
  return ranges
}

function urlEnd(text: string, start: number): number {
  let end = start, parentheses = 0, brackets = 0
  while (end < text.length) {
    const char = text[end]
    if (/[\s<>"'`，。；;）]/.test(char)) break
    if (char === '(') parentheses++
    else if (char === ')') { if (!parentheses) break; parentheses-- }
    else if (char === '[') brackets++
    else if (char === ']') { if (!brackets) break; brackets-- }
    end++
  }
  // Sentence punctuation is outside an unquoted URL; balanced URL brackets stay inside.
  while (end > start && /[.,!]/.test(text[end - 1])) end--
  return end
}

function windowsPathEnd(text: string, start: number): number {
  const quote = text[start - 1]
  if (quote === '"' || quote === "'") {
    const closing = text.indexOf(quote, start)
    if (closing >= 0 && !/[\r\n]/.test(text.slice(start, closing))) return closing
  }
  let end = start + 3
  while (end < text.length && !/[\r\n<>"'`，。；;）)\]！？!?：:]/.test(text[end])) end++
  while (end > start && /[ \t]/.test(text[end - 1])) end--
  const value = text.slice(start, end)
  const tailStart = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1
  const tail = value.slice(tailStart)
  // Unquoted paths may contain spaces in directory names. A known final file
  // followed by whitespace ends the path before prose. Quote ambiguous paths.
  const dotfile = DOTFILES.some(name => tail.startsWith(name) && /[. \t]/.test(tail[name.length] ?? ''))
  let dot = -1
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] === '.') dot = i
    if (/[ \t]/.test(tail[i]) && (dotfile || (dot >= 0 && i - dot <= 13 && FILE_EXTENSIONS.has(tail.slice(dot + 1, i).toLowerCase()))
      || (i <= 20 && NAMED_FILES.has(tail.slice(0, i))))) return start + tailStart + i
  }
  return end
}

function automaticRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = cursor
    const fence = text.startsWith('```', cursor) ? '```' : text.startsWith('~~~', cursor) ? '~~~' : null
    if (fence) {
      const closing = text.indexOf(fence, cursor + 3)
      cursor = closing < 0 ? text.length : closing + 3
      ranges.push({ start, end: cursor }); continue
    }
    if (text[cursor] === '`') {
      let end = cursor + 1
      while (end < text.length && text[end] !== '`' && text[end] !== '\n') end++
      if (text[end] === '`' && end > cursor + 1) {
        cursor = end + 1; ranges.push({ start, end: cursor }); continue
      }
    }
    if (text[cursor] === '"' || text[cursor] === "'") {
      const closing = text.indexOf(text[cursor], cursor + 1)
      if (closing >= 0) {
        const literal = text.slice(cursor + 1, closing)
        if (!/[\r\n]/.test(literal) && (pathOrFile(literal) || /^[A-Za-z]:[\\/]/.test(literal))) {
          ranges.push({ start: cursor + 1, end: closing }); cursor = closing + 1; continue
        }
      }
    }
    const scheme = text.slice(cursor, cursor + 8).toLowerCase()
    if (scheme.startsWith('https://') || scheme.startsWith('http://')) {
      cursor = urlEnd(text, cursor)
      ranges.push({ start, end: cursor }); continue
    }
    if (/[A-Za-z]/.test(text[cursor]) && text[cursor + 1] === ':' && /[\\/]/.test(text[cursor + 2] ?? '')) {
      cursor = windowsPathEnd(text, cursor)
      ranges.push({ start, end: cursor }); continue
    }
    candidatePattern.lastIndex = cursor
    const match = candidatePattern.exec(text)
    if (match) {
      cursor = candidatePattern.lastIndex
      // A maximal Unicode candidate can start in adjacent prose. Leave broad
      // literals for their scanner even when no whitespace separates them:
      // 请看https://..., 检查C:\\..., or 文本~~~code~~~.
      const fenceOffset = match[0].indexOf('~~~')
      if (fenceOffset >= 0) cursor = start + fenceOffset
      else if (text[cursor] === ':') {
        if (text.startsWith('//', cursor + 1)) {
          const ending = text.slice(Math.max(start, cursor - 5), cursor).toLowerCase()
          if (ending.endsWith('https')) cursor -= 5
          else if (ending.endsWith('http')) cursor -= 4
          else if (/[A-Za-z]/.test(text[cursor - 1] ?? '')) cursor--
        } else if (/[\\/]/.test(text[cursor + 1] ?? '') && /[A-Za-z]/.test(text[cursor - 1] ?? '')) cursor--
      }
      if (cursor === start) continue
      let end = cursor
      if (!/[\\/]\.{1,2}$/.test(text.slice(start, cursor))) while (end > start && text[end - 1] === '.') end--
      const value = text.slice(start, end)
      if (value) ranges.push(...candidateRanges(value, start))
    } else cursor++
  }
  return ranges
}

/**
 * Protect syntax and user-locked literals, without trying to prove semantic equivalence.
 *
 * Broad literals own their complete span, so nested paths are protected once.
 * Plain candidates are consumed once and classified at their boundary; long
 * prose without separators must not cause quadratic failed regex searches.
 */
export function protectText(text: string, locked: readonly string[] = []): ProtectedText {
  const ranges = automaticRanges(text)
  for (const literal of locked) {
    if (typeof literal !== 'string' || !literal.length || !text.includes(literal)) throw new AssistantError('LOCK_SCOPE', '锁定片段已变化或不在本次优化范围内')
    let start = text.indexOf(literal)
    while (start >= 0) { ranges.push({ start, end: start + literal.length }); start = text.indexOf(literal, start + literal.length) }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: typeof ranges = []
  for (const r of ranges) {
    const prev = merged[merged.length - 1]
    if (prev && r.start < prev.end) prev.end = Math.max(prev.end, r.end)
    else merged.push({ ...r })
  }
  let longestPrefix = -1, occurrence = text.indexOf('DSH_KEEP_')
  while (occurrence >= 0) {
    let start = occurrence
    while (start > 0 && text[start - 1] === '_') start--
    longestPrefix = Math.max(longestPrefix, occurrence - start)
    occurrence = text.indexOf('DSH_KEEP_', occurrence + 9)
  }
  const prefix = '_'.repeat(longestPrefix + 1) + 'DSH_KEEP_'
  const fragments: ProtectedFragment[] = []
  let cursor = 0, masked = ''
  for (const r of merged) {
    const token = `⟪${prefix}${fragments.length}⟫`
    const original = text.slice(r.start, r.end)
    fragments.push({ token, original })
    masked += text.slice(cursor, r.start) + token
    cursor = r.end
  }
  return { original: text, masked: masked + text.slice(cursor), fragments }
}

export function restoreProtected(output: string, protectedText: ProtectedText): string {
  const fragments = new Map(protectedText.fragments.map(fragment => [fragment.token, fragment.original]))
  const existing = new Set(protectedText.original.match(/⟪_*DSH_KEEP_\d+⟫/gu) ?? [])
  const seen = new Set<string>()
  const restored = output.replace(/⟪_*DSH_KEEP_\d+⟫/gu, token => {
    const original = fragments.get(token)
    if (original === undefined) {
      if (!existing.has(token)) throw new AssistantError('PROTECTION', '生成结果包含无效的保护标记，已保留原稿')
      return token
    }
    if (seen.has(token)) throw new AssistantError('PROTECTION', '生成结果未完整保留锁定内容，已保留原稿')
    seen.add(token)
    return original
  })
  if (seen.size !== fragments.size) throw new AssistantError('PROTECTION', '生成结果未完整保留锁定内容，已保留原稿')
  return restored
}
