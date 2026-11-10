import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig, resolveStoredConfig, protectText, restoreProtected, prepareGeneration, finishGeneration, NO_SUGGESTION, buildContext, charCount, snapshotMatches, diffText, SessionScheduler, type GenerationRequest } from '../src/core'

const request = (extra: Partial<GenerationRequest> = {}): GenerationRequest => ({
  operation: 'optimize', requestId: 'r1', sessionId: 's1', sourceTurnId: 'turn1',
  draft: '请修复登录问题，不改变接口。', draftRev: 7, span: { start: 0, end: 16, draftRev: 7 },
  connectionGeneration: '1', routeKey: 'provider/model', ...extra,
})
describe('literal protection and prompt construction', () => {
  it('merges nested code/path matches and restores literals exactly', () => {
    const text = '检查 `C:\\项目\\app.ts`，参考 https://example.com/a，不要改接口。\n```ts\nconst x = "./app.ts"\n```'
    const protectedText = protectText(text, ['不要改接口'])
    expect(protectedText.fragments).toHaveLength(4)
    expect(restoreProtected('请仔细' + protectedText.masked, protectedText)).toBe('请仔细' + text)
  })
  it.each(['missing', 'duplicate', 'damaged'])('rejects %s protected token', kind => {
    const p = protectText('修改 `safeFn`，不要改接口。')
    const token = p.fragments[0].token
    const output = kind === 'missing' ? p.masked.replace(token, '') : kind === 'duplicate' ? p.masked + token : p.masked.replace(token, token.toLowerCase())
    expect(() => restoreProtected(output, p)).toThrow(/锁定/)
  })
  it('rejects a manual lock that no longer exists', () => expect(() => protectText('new draft', ['old'])).toThrow(/已变化/))
  it('protects Unicode relative and POSIX paths without consuming following Chinese punctuation', () => {
    const original = '查看 ./项目/配置.json，比较 /项目/src/入口.ts。另看 ..\\代码\\main.ts。'
    const protectedText = protectText(original)
    expect(protectedText.fragments.map(fragment => fragment.original)).toEqual(['./项目/配置.json', '/项目/src/入口.ts', '..\\代码\\main.ts'])
    expect(restoreProtected(protectedText.masked, protectedText)).toBe(original)
  })
  it('protects bare and relative project paths that carry no leading separator', () => {
    const cases: [string, string[]][] = [
      ['修改 package.json 里的 scripts', ['package.json']],
      ['看看 src/index.ts 的实现', ['src/index.ts']],
      ['不要改 src/a.ts', ['src/a.ts']],
      ['看 src/core/generation 目录', ['src/core/generation']],
      ['修改 README.md 和 LICENSE', ['README.md', 'LICENSE']],
      ['更新 docs/validation.md 和 src/core/generation.ts，再检查 package.json',
        ['docs/validation.md', 'src/core/generation.ts', 'package.json']],
    ]
    for (const [draft, expected] of cases) {
      const p = protectText(draft)
      expect(p.fragments.map(fragment => fragment.original)).toEqual(expected)
      expect(restoreProtected(p.masked, p)).toBe(draft)
    }
  })
  it('does not protect ordinary prose that merely looks like an abbreviation', () => {
    expect(protectText('这是 e.g. 的例子，i.e. 也不是文件。').fragments).toEqual([])
    expect(protectText('执行 npm run build 不要改').fragments).toEqual([])
    expect(protectText('保持 maxDraftChars=8000').fragments).toEqual([])
  })
  it('covers the whole relative path when a file name and its directory both appear', () => {
    const original = '更新 src/core/generation.ts 的实现'
    const p = protectText(original)
    expect(p.fragments.map(fragment => fragment.original)).toEqual(['src/core/generation.ts'])
    // The directory must not be left exposed to a silent rewrite.
    expect(restoreProtected(p.masked.replace('更新', '重写'), p)).toBe(original.replace('更新', '重写'))
  })
  it('protects exact Latin file boundaries next to Chinese prose without freezing the sentence', () => {
    const cases: [string, string[]][] = [
      ['请修改package.json中的scripts。', ['package.json']],
      ['检查src/index.ts中的问题。', ['src/index.ts']],
      ['编辑.env然后重启。', ['.env']],
      ['编辑.env.verylongenvironmentname然后重启。', ['.env.verylongenvironmentname']],
      ['请使用src/core/index.ts中的函数。', ['src/core/index.ts']],
      ['请修改package.json和tsconfig.json后再检查README中的说明。', ['package.json', 'tsconfig.json', 'README']],
      ['检查src\\中文目录\\入口.ts中的问题。', ['src\\中文目录\\入口.ts']],
      ['更新./项目/配置.json中的内容。', ['./项目/配置.json']],
      ['检查 src/配置json目录/入口.ts中的问题。', ['src/配置json目录/入口.ts']],
      ['检查 src/a.json目录/入口.ts中的问题。', ['src/a.json目录/入口.ts']],
      ['检查 src/a.json𠀀目录/入口.ts中的问题。', ['src/a.json𠀀目录/入口.ts']],
      ['检查 配置.json中的问题。', ['配置.json']],
      ['检查 src/core/generation目录。', ['src/core/generation']],
      ['使用 "项目配置file.ts" 中的函数。', ['项目配置file.ts']],
      ['使用 "项目/混合 file.ts" 中的函数。', ['项目/混合 file.ts']],
    ]
    for (const [text, expected] of cases) {
      const p = protectText(text)
      expect(p.fragments.map(fragment => fragment.original), text).toEqual(expected)
      expect(restoreProtected(p.masked, p)).toBe(text)
    }
  })
  it('rejects tampering with files adjacent to Chinese through the production output path', () => {
    for (const text of ['请修改package.json中的scripts。', '检查src/index.ts中的问题。', '编辑.env然后重启。']) {
      const p = prepareGeneration(request({ draft: text }), [], resolveConfig())
      const masked: string = JSON.parse(p.input).targetText
      expect(p.protection!.fragments).toHaveLength(1)
      expect(finishGeneration(masked.replace(/请修改|检查|编辑/, '请仔细核对'), p)).toBe(text.replace(/请修改|检查|编辑/, '请仔细核对'))
      const token = p.protection!.fragments[0].token
      expect(() => finishGeneration(masked.replace(token, 'other-file.json'), p)).toThrow(/锁定/)
    }
  })
  it('protects complete dotfiles, Windows paths with spaces, and balanced URL punctuation', () => {
    const literals = [
      '.env', '.env.production', '.gitignore', 'src\\index.ts', 'src\\core\\generation', '../..',
      'C:\\Program Files\\DeepSeek Harness\\config.json',
      'https://example.com/a_(b)/c?q=1', 'https://example.com/search?q[]=a',
    ]
    for (const literal of literals) {
      const p = protectText(`检查 ${literal}，然后说明原因。`)
      expect(p.fragments.map(fragment => fragment.original)).toEqual([literal])
      expect(p.masked).not.toContain(literal)
      expect(restoreProtected(p.masked, p)).toBe(p.original)
    }
    const quoted = protectText('检查 "C:\\Program Files\\DeepSeek Harness\\config file.json" 的内容。')
    expect(quoted.fragments.map(fragment => fragment.original)).toEqual(['C:\\Program Files\\DeepSeek Harness\\config file.json'])
    const prose = protectText('检查 C:\\Program Files\\DeepSeek Harness\\config.json 的内容。')
    expect(prose.fragments.map(fragment => fragment.original)).toEqual(['C:\\Program Files\\DeepSeek Harness\\config.json'])
    expect(prose.masked).toContain(' 的内容。')
    expect(protectText('(https://example.com/a_(b)).').fragments[0].original).toBe('https://example.com/a_(b)')
  })
  it('handles maximum-length unbroken prose and thousands of protected literals without a long main-thread stall', () => {
    const started = performance.now()
    expect(protectText('汉'.repeat(32_000)).fragments).toEqual([])
    expect(protectText('a'.repeat(32_000)).fragments).toEqual([])
    const many = protectText('`safe` '.repeat(4000))
    expect(restoreProtected(many.masked, many)).toBe(many.original)
    // Generous enough for loaded CI, while catching the former multi-second
    // (and at 32k Chinese, minute-long) repeated path-regex search.
    expect(performance.now() - started).toBeLessThan(1000)
  })
  it('recognizes broad literals immediately after prose without consuming their prefix', () => {
    const cases: [string, string][] = [
      ['请访问https://example.com/a_(b)/c?q=1，然后说明。', 'https://example.com/a_(b)/c?q=1'],
      ['请访问HTTP://example.com/a，然后说明。', 'HTTP://example.com/a'],
      ['检查C:\\Program Files\\DeepSeek Harness\\config.json，然后说明。', 'C:\\Program Files\\DeepSeek Harness\\config.json'],
      ['检查C:/Program Files/DeepSeek Harness/config.json，然后说明。', 'C:/Program Files/DeepSeek Harness/config.json'],
      ['文本~~~code~~~后面', '~~~code~~~'],
    ]
    for (const [text, literal] of cases) {
      const p = protectText(text)
      expect(p.fragments.map(fragment => fragment.original)).toEqual([literal])
      expect(restoreProtected(p.masked, p)).toBe(text)
    }
  })
  it('permits existing marker syntax as user material without accepting invented markers', () => {
    const original = '请说明 ⟪DSH_KEEP_0⟫ 的用途和 `foo`'
    const p = protectText(original)
    expect(restoreProtected(p.masked.replace('请说明', '请解释'), p)).toBe(original.replace('请说明', '请解释'))
    expect(() => restoreProtected(p.masked + ' ⟪DSH_KEEP_99⟫', p)).toThrow(/无效/)
  })
  it('does not put protected originals into the optimize target', () => {
    const p = prepareGeneration(request({ draft: '修复 `api_v2()`，保持参数。' }), [], resolveConfig())
    expect(JSON.parse(p.input).targetText).not.toContain('api_v2()')
    expect(finishGeneration(JSON.parse(p.input).targetText, p)).toBe('修复 `api_v2()`，保持参数。')
  })
  it('refuses oversized target instead of silently clipping it', () => expect(() => prepareGeneration(request({ draft: 'a'.repeat(8001) }), [], resolveConfig())).toThrow(/选中/))
  it('can process a short selection inside a long draft', () => {
    const p = prepareGeneration(request({ draft: 'a'.repeat(9000), targetText: 'make clear' }), [], resolveConfig())
    expect(p.system).toContain('not the full surrounding draft')
    expect(JSON.parse(p.input).targetText).toBe('make clear')
  })
  it('permits a supported next question, and treats abstention normally', () => {
    const p = prepareGeneration(request({ operation: 'next', draft: '' }), [{ role: 'assistant', text: '需要解释缓存吗？' }], resolveConfig())
    expect(finishGeneration('缓存失效时怎么办？', p)).toBe('缓存失效时怎么办？')
    expect(finishGeneration(NO_SUGGESTION, p)).toBeNull()
  })
  it('keeps suffix whitespace but drops repeated prefixes and overlong suggestions', () => {
    const p = prepareGeneration(request({ operation: 'complete', draft: 'Please explain' }), [], resolveConfig())
    expect(finishGeneration(' the cache policy.', p)).toBe(' the cache policy.')
    expect(finishGeneration('Please explain the cache policy.', p)).toBeNull()
    expect(finishGeneration('a'.repeat(81), p)).toBeNull()
    expect(finishGeneration('first\nsecond', p)).toBeNull()
  })
  it('rejects edge newlines while allowing a short draft to share letters with a valid suffix', () => {
    const p = prepareGeneration(request({ operation: 'complete', draft: 'a' }), [], resolveConfig())
    expect(finishGeneration(' and b', p)).toBe(' and b')
    expect(finishGeneration('\n and b', p)).toBeNull()
    expect(finishGeneration(' and b\n', p)).toBeNull()
    expect(finishGeneration(' and b\r', p)).toBeNull()
  })
  it.each(['concise', 'standard', 'detailed'] as const)('keeps explicit character limits and adequate token budgets in %s mode', predictionDetail => {
    for (const [operation, key, limits] of [
      ['next', 'maxNextChars', [20, 121, 199, 400, 450, 1000]],
      ['complete', 'maxCompletionChars', [10, 81, 99, 200, 500]],
    ] as const) for (const limit of limits) {
      const config = resolveConfig({ predictionDetail, [key]: limit })
      const prepared = prepareGeneration(request({ operation, draft: operation === 'next' ? '' : '请继续' }), [], config)
      expect(prepared.config[key]).toBe(limit)
      expect(config[key]).toBe(limit)
      expect(prepared.system).toContain(`at most ${limit} Unicode characters`)
      expect(prepared.system).not.toMatch(/200 to 450|100 to 200/)
      expect(prepared.maxOutputTokens).toBeGreaterThanOrEqual(limit * 4 + 32)
      expect(finishGeneration('甲'.repeat(limit), prepared)).toBe('甲'.repeat(limit))
      expect(finishGeneration('甲'.repeat(limit + 1), prepared)).toBeNull()
    }
  })
  it('allows structured next messages and suffixes only in detailed mode without losing leading suffix whitespace', () => {
    for (const predictionDetail of ['concise', 'standard', 'detailed'] as const) {
      const config = resolveConfig({ predictionDetail })
      const next = prepareGeneration(request({ operation: 'next', draft: '' }), [], config)
      const complete = prepareGeneration(request({ operation: 'complete', draft: '请解释以下事项：' }), [], config)
      const message = '第一点\n第二点', suffix = '\n1. 原因\n2. 影响\n'
      expect(finishGeneration(message, next)).toBe(predictionDetail === 'detailed' ? message : null)
      expect(finishGeneration(suffix, complete)).toBe(predictionDetail === 'detailed' ? '\n1. 原因\n2. 影响' : null)
    }
  })
  it('keeps detailed prediction grounded in existing scope rather than adding tasks to reach a minimum length', () => {
    const prepared = prepareGeneration(request({ operation: 'next', draft: '' }), [
      { role: 'user', text: '只解释原因，不要改文件，也不需要测试。' },
      { role: 'assistant', text: '已解释重构原因。' },
    ], resolveConfig({ predictionDetail: 'detailed', maxNextChars: 20 }))
    expect(prepared.system).toContain('There is no minimum length')
    expect(prepared.system).toContain('Never add tasks, constraints, permissions, deliverables, or commitments')
    expect(prepared.system).not.toContain('兼容性影响')
    expect(JSON.parse(prepared.input).history[0].text).toBe('只解释原因，不要改文件，也不需要测试。')
    expect(finishGeneration('谢谢。', prepared)).toBe('谢谢。')
  })
  it('persists prediction detail and extended limits without dropping a fixed model pair', () => {
    const config = resolveConfig({ predictionDetail: 'detailed', maxNextChars: 1000, maxCompletionChars: 500, provider: 'p', model: 'm' })
    expect(resolveStoredConfig(config)).toEqual(config)
    expect(resolveStoredConfig({ ...config, predictionDetail: 'unknown' })).toEqual({ ...config, predictionDetail: 'standard' })
    expect(() => resolveConfig({ predictionDetail: 'unknown' as never })).toThrow(/详略度/)
    expect(() => resolveConfig({ maxNextChars: 1001 })).toThrow()
    expect(() => resolveConfig({ maxCompletionChars: 501 })).toThrow()
  })
  it('removes one obvious optimization wrapper while keeping protected text intact', () => {
    const prepared = prepareGeneration(request({ draft: '请检查 `src/index.ts`，不要改接口。' }), [], resolveConfig())
    const masked = JSON.parse(prepared.input).targetText
    expect(finishGeneration('```text\n' + masked + '\n```', prepared)).toBe(prepared.protection!.original)
    expect(finishGeneration('优化后的提示词：\n' + masked, prepared)).toBe(prepared.protection!.original)
    expect(finishGeneration('"' + masked + '"', prepared)).toBe(prepared.protection!.original)
    const inline = prepareGeneration(request({ draft: '`src/index.ts`' }), [], resolveConfig())
    expect(finishGeneration('`' + JSON.parse(inline.input).targetText + '`', inline)).toBe('`src/index.ts`')
  })
  it('preserves original quoted paths in a selection and removes only an additional quote wrapper', () => {
    const target = '"C:\\Program Files\\Tool\\app.exe"'
    const prepared = prepareGeneration(request({ draft: `仅检查 ${target}，其他不变。`, targetText: target }), [], resolveConfig())
    const masked = JSON.parse(prepared.input).targetText
    expect(finishGeneration(masked, prepared)).toBe(target)
    expect(finishGeneration('"' + masked + '"', prepared)).toBe(target)
    const prose = prepareGeneration(request({ draft: '“保留引号并解释原因”' }), [], resolveConfig())
    expect(finishGeneration('“保留引号，解释原因”', prose)).toBe('“保留引号，解释原因”')
  })
  it('does not strip a preamble that belongs to the original draft', () => {
    const original = '优化后的提示词：只解释原因，不改文件。'
    const prepared = prepareGeneration(request({ draft: original }), [], resolveConfig())
    expect(finishGeneration(JSON.parse(prepared.input).targetText, prepared)).toBe(original)
    expect(finishGeneration('优化后的提示词：仅解释原因，不修改文件。', prepared)).toBe('优化后的提示词：仅解释原因，不修改文件。')
  })
  it('rejects optimization output that becomes empty after cleaning', () => {
    const prepared = prepareGeneration(request(), [], resolveConfig())
    for (const raw of ['优化后的提示词：', '```text\n\n```', '“”', '``', '""']) {
      expect(() => finishGeneration(raw, prepared), raw).toThrow(/未返回优化文字/)
    }
  })
  it('rejects isolated surrogate characters anywhere while preserving valid emoji pairs', () => {
    const optimize = prepareGeneration(request(), [], resolveConfig())
    const next = prepareGeneration(request({ operation: 'next', draft: '' }), [], resolveConfig({ predictionDetail: 'detailed' }))
    const complete = prepareGeneration(request({ operation: 'complete', draft: '说明' }), [], resolveConfig({ predictionDetail: 'detailed' }))
    for (const raw of ['\uD83D', '\uDC00', 'a\uD83Db', 'a\uDC00b', '😀\uDC00', '\uD83D😀']) {
      expect(() => finishGeneration(raw, optimize)).toThrow(/不完整字符/)
      expect(finishGeneration(raw, next)).toBeNull()
      expect(finishGeneration(raw, complete)).toBeNull()
    }
    expect(finishGeneration(' 😀𠀀', complete)).toBe(' 😀𠀀')
    const invalidProtected = prepareGeneration(request({ draft: '`bad\uD83D`' }), [], resolveConfig())
    expect(() => finishGeneration(JSON.parse(invalidProtected.input).targetText, invalidProtected)).toThrow(/不完整字符/)
  })
  it('preserves a valid stored model pair while tolerating unrelated corrupt fields', () => {
    const persisted = resolveConfig({ provider: ' fixture ', model: ' small-model ' })
    expect(resolveStoredConfig(persisted)).toEqual(persisted)
    expect(resolveStoredConfig({ ...persisted, debounceMs: -1, futureSetting: true })).toEqual({ ...persisted, debounceMs: DEFAULT_CONFIG.debounceMs })
    expect(resolveStoredConfig({ provider: 'fixture' })).toMatchObject({ provider: '', model: '' })
    expect(resolveStoredConfig({ provider: 123, model: 'small-model' })).toMatchObject({ provider: '', model: '' })
  })
  it('rejects unsupported/invalid configuration', () => {
    expect(() => resolveConfig({ debounceMs: 0 })).toThrow()
    expect(() => resolveConfig({ provider: 'only-provider' })).toThrow()
    expect(resolveConfig().debounceMs).toBe(600)
    expect(resolveConfig({ nextEnabled: false }).optimizationStrength).toBe('standard')
    expect(() => resolveConfig({ optimizationStrength: 'unsafe' as never })).toThrow(/优化强度/)
    expect(() => resolveConfig({ optimizeEnabled: 'yes' as never })).toThrow(/布尔值/)
  })
  it.each(['light', 'standard', 'deep'] as const)('uses the %s optimization policy while preserving scope and protected fragments', strength => {
    const prepared = prepareGeneration(request({ draft: '解释 `apiV2`，不要改文件。' }), [], resolveConfig({ optimizationStrength: strength }))
    expect(prepared.system).toContain(`Optimization strength: ${strength.toUpperCase()}`)
    expect(prepared.system).toContain('may not add new work or authorization')
    expect(finishGeneration(JSON.parse(prepared.input).targetText, prepared)).toBe('解释 `apiV2`，不要改文件。')
  })
  it('disables optimization independently without disabling suggestions', () => {
    const config = resolveConfig({ optimizeEnabled: false, stashEnabled: false })
    expect(() => prepareGeneration(request(), [], config)).toThrow(/已关闭/)
    expect(prepareGeneration(request({ operation: 'next', draft: '' }), [], config).operation).toBe('next')
  })
})
describe('bounded context, snapshots, and diff', () => {
  it('preserves task anchor and latest correction under a giant assistant reply', () => {
    const result = buildContext([
      { role: 'user', text: '第一要求：禁止改接口。' },
      { role: 'assistant', text: 'old'.repeat(10000) },
      { role: 'user', text: '最新纠正：不要改文件，只解释。' },
      { role: 'assistant', text: 'answer'.repeat(10000) },
    ], 1000)
    expect(result.map(m => m.text).join('')).toContain('禁止改接口')
    expect(result.map(m => m.text).join('')).toContain('不要改文件')
    expect(result.reduce((n, m) => n + charCount(m.text), 0)).toBeLessThanOrEqual(1000)
  })
  it('invalidates a moved caret even if draft revision did not change', () => {
    const r = request()
    expect(snapshotMatches(r, { ...r })).toBe(true)
    expect(snapshotMatches(r, { ...r, span: { ...r.span, start: 1 } })).toBe(false)
    expect(snapshotMatches(r, { ...r, connectionGeneration: '2' })).toBe(false)
    expect(snapshotMatches(r, { ...r, routeKey: 'p/new-model' })).toBe(false)
  })
  it('diff reproduces both originals without losing text', () => {
    const before = '保留 API v2。\n不要改参数。🐳', after = '保留 API v2。\n请不要修改参数。🐳'
    const parts = diffText(before, after)
    expect(parts.filter(p => p.type !== 'insert').map(p => p.value).join('')).toBe(before)
    expect(parts.filter(p => p.type !== 'delete').map(p => p.value).join('')).toBe(after)
  })
  it('large diff does not split emoji surrogate pairs between DOM segments', () => {
    const parts = diffText('😀' + 'word '.repeat(1100), '😁' + 'word '.repeat(1100))
    expect(parts.find(p => p.type === 'delete')?.value).toBe('😀')
    expect(parts.find(p => p.type === 'insert')?.value).toBe('😁')
    for (const part of parts) expect(Array.from(part.value).some(char => char.length === 1 && /[\uD800-\uDFFF]/.test(char))).toBe(false)
  })
})
describe('session scheduler', () => {
  it('manual optimize cancels a late automatic result, even if provider ignores abort', async () => {
    const scheduler = new SessionScheduler()
    let late!: (value: string) => void
    const previous = scheduler.run('s', 'old', 'next', 1000, () => new Promise<string>(resolve => { late = resolve }))
    const rejected = expect(previous).rejects.toMatchObject({ code: 'CANCELLED' })
    await Promise.resolve()
    expect(await scheduler.run('s', 'new', 'optimize', 1000, async () => 'new')).toBe('new')
    late('late'); await rejected
  })
  it('automatic work cannot abort manual optimize', async () => {
    const scheduler = new SessionScheduler()
    let finish!: (value: string) => void
    const manual = scheduler.run('s', 'm', 'optimize', 1000, () => new Promise<string>(resolve => { finish = resolve }))
    await Promise.resolve()
    await expect(scheduler.run('s', 'a', 'next', 1000, async () => 'automatic')).rejects.toMatchObject({ code: 'BUSY' })
    finish('manual'); expect(await manual).toBe('manual')
  })
  it('timeout settles even an uncooperative provider', async () => {
    vi.useFakeTimers()
    const scheduler = new SessionScheduler()
    const result = scheduler.run('s', 'r', 'complete', 50, () => new Promise<string>(() => {}))
    const rejected = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(50); await rejected; vi.useRealTimers()
  })
  it('sessions are independent and cancellation cannot target another request', async () => {
    const scheduler = new SessionScheduler()
    expect(scheduler.cancel('s', 'missing')).toBe(false)
    expect(await Promise.all([
      scheduler.run('s1', 'r1', 'next', 1000, async () => 1),
      scheduler.run('s2', 'r2', 'next', 1000, async () => 2),
    ])).toEqual([1, 2])
    scheduler.dispose()
  })
})
