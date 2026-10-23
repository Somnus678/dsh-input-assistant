import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig, protectText, restoreProtected, prepareGeneration, finishGeneration, NO_SUGGESTION, buildContext, charCount, snapshotMatches, diffText, SessionScheduler, type GenerationRequest } from '../src/core'

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
