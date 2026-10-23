import { AssistantError } from './types'
export interface ProtectedFragment { token: string; original: string }
export interface ProtectedText { original: string; masked: string; fragments: ProtectedFragment[] }

/**
 * Extensions worth protecting when they appear as a bare file name.
 * Deliberately closed: guessing an extension from shape alone would protect
 * ordinary prose such as `e.g.` or `Node.js`.
 */
const FILE_EXTENSIONS = [
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
].join('|')

/** Well-known extensionless project files. */
const NAMED_FILES = [
  'LICENSE', 'LICENCE', 'README', 'CHANGELOG', 'CONTRIBUTING', 'CODEOWNERS',
  'AUTHORS', 'NOTICE', 'Makefile', 'Dockerfile', 'Gemfile', 'Rakefile',
  'Procfile', 'Vagrantfile', 'Jenkinsfile', 'Brewfile',
].join('|')

const pathSegment = '[\\p{L}\\p{N}\\p{M}_.@+~-]'

/**
 * Protect syntax and user-locked literals, without trying to prove semantic equivalence.
 *
 * Order matters: the broad shapes (fenced code, inline code, URL, absolute
 * path) are collected first and the narrower path/file rules afterwards; the
 * merge step below folds overlapping matches into one fragment, so a file name
 * inside inline code or inside a URL is protected exactly once.
 */
export function protectText(text: string, locked: readonly string[] = []): ProtectedText {
  const ranges: { start: number; end: number }[] = []
  const patterns = [
    /```[^]*?(?:```|$)/g, /~~~[^]*?(?:~~~|$)/g, /`[^`\n]+`/g,
    /https?:\/\/[^\s<>"'）)\]，。；;]+/g,
    /[A-Za-z]:[\\/][^\s<>"'，。；;）)\]]+/g,
    /(?:\.{1,2}[\\/]|\/(?:[\p{L}\p{N}\p{M}_.-]+\/)+)[\p{L}\p{N}\p{M}_./\\@+-]+/gu,
    // Relative path carrying an extension: `src/index.ts`, `docs/validation.md`.
    // Requires at least one separator so plain prose words stay untouched.
    new RegExp(`(?:${pathSegment}+\\/)+${pathSegment}*\\.[A-Za-z][A-Za-z0-9]{0,11}`, 'gu'),
    // Deep relative path without an extension: `src/core/generation`.
    new RegExp(`(?:${pathSegment}+\\/){2,}${pathSegment}+`, 'gu'),
    // Bare file name with a known extension: `package.json`, `README.md`.
    new RegExp(`${pathSegment}+\\.(?:${FILE_EXTENSIONS})(?![A-Za-z0-9_])`, 'giu'),
    // Well-known extensionless file names.
    new RegExp(`(?<![A-Za-z0-9_])(?:${NAMED_FILES})(?![A-Za-z0-9_])`, 'g'),
  ]
  for (const re of patterns) for (const m of text.matchAll(re)) ranges.push({ start: m.index!, end: m.index! + m[0].length })
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
  let prefix = 'DSH_KEEP_'
  while (text.includes(prefix)) prefix = '_' + prefix
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
  let remaining = output
  for (const { token } of protectedText.fragments) {
    if (remaining.split(token).length !== 2) throw new AssistantError('PROTECTION', '生成结果未完整保留锁定内容，已保留原稿')
    remaining = remaining.replace(token, '')
  }
  for (const marker of remaining.match(/⟪_*DSH_KEEP_\d+⟫/gu) ?? []) {
    if (!protectedText.original.includes(marker)) throw new AssistantError('PROTECTION', '生成结果包含无效的保护标记，已保留原稿')
  }
  let restored = output
  for (const { token, original } of protectedText.fragments) {
    if (restored.split(token).length !== 2) throw new AssistantError('PROTECTION', '生成结果未完整保留锁定内容，已保留原稿')
    restored = restored.replace(token, () => original)
  }
  return restored
}
