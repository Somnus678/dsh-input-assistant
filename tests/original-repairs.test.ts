import { describe, expect, it } from 'vitest'
import { resolveConfig, resolveStoredConfig, prepareGeneration, finishGeneration, type GenerationRequest } from '../src/core/index.js'

const request = (operation: GenerationRequest['operation'], draft: string): GenerationRequest => ({
  operation, requestId: 'r', sessionId: 's', sourceTurnId: 't', draft, draftRev: 1,
  span: { start: 0, end: draft.length, draftRev: 1 }, connectionGeneration: 'g', routeKey: '',
})

describe('targeted repairs without changing the original generation policy', () => {
  it('retains fixed provider/model together', () => {
    expect(resolveStoredConfig(resolveConfig({ provider: 'fixture', model: 'aux' }))).toMatchObject({ provider: 'fixture', model: 'aux' })
  })
  it('keeps the original detailed-mode default budget and prompt behavior', () => {
    const config = resolveConfig({ predictionDetail: 'detailed' })
    const next = prepareGeneration(request('next', ''), [], config)
    const complete = prepareGeneration(request('complete', '请解释'), [], config)
    expect(next.config.maxNextChars).toBe(400)
    expect(complete.config.maxCompletionChars).toBe(200)
    expect(next.system).toContain('200 to 450 characters')
    expect(complete.system).toContain('100 to 200 characters')
  })
  it.each(['"C:\\Program Files\\Tool\\app.exe"', '“保持这对引号”'])('preserves original wrappers: %s', text => {
    const prepared = prepareGeneration(request('optimize', text), [], resolveConfig())
    const masked = JSON.parse(prepared.input).targetText
    expect(finishGeneration(masked, prepared)).toBe(text)
  })
  it.each(['优化后的提示词：', '```text\n\n```', '“”', '``', '""'])('rejects empty optimization after cleaning: %s', raw => {
    const prepared = prepareGeneration(request('optimize', '请解释原因'), [], resolveConfig())
    expect(() => finishGeneration(raw, prepared)).toThrow()
  })
  it.each(['\ud83d', '\udc00', 'a\ud83db'])('rejects incomplete surrogate output', raw => {
    const opt = prepareGeneration(request('optimize', '请解释'), [], resolveConfig())
    const complete = prepareGeneration(request('complete', '请解释'), [], resolveConfig())
    expect(() => finishGeneration(raw, opt)).toThrow()
    expect(finishGeneration(raw, complete)).toBeNull()
  })
})
