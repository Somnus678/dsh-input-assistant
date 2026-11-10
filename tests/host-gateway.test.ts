import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import LlmRuntime, { createAssistantMessage, createUserMessage, LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import * as plugin from '../src/index'
import type { AssistantConfig, AssistantStatus, DraftMutationResult, GenerationRequest, GenerationResult, StoredDraft } from '../src/core/types'
import type { AssistantModelCatalog } from '../src/core/models'
import { AssistantHostRuntime } from '../src/host/runtime'
import { AssistantStorage } from '../src/host/storage'

class TestModelCatalog extends Service {
  calls = 0
  failed = false
  constructor(ctx: Context) { super(ctx, 'sessionController') }
  async modelCatalog() {
    this.calls++
    if (this.failed) throw new Error('private catalog diagnostic')
    return {
      groups: [{ id: 'fixture', name: 'Fixture provider', models: [{ id: 'model', name: 'Fixture model' }] }],
      failures: [{ id: 'offline', name: 'Offline provider', message: 'secret provider diagnostic' }],
    }
  }
}

class TestStorageDomain extends Service {
  private readonly records = new Map<string, unknown>()
  private global: unknown
  attempts = 0
  constructor(ctx: Context, private failuresRemaining = 0) { super(ctx, 'storageDomain') }
  async open<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
    this.attempts++
    if (this.failuresRemaining-- > 0) throw new Error('temporary storage failure')
    this.global ??= structuredClone(spec.global!.initial)
    const domain = {
      name: spec.name,
      global: { get: () => this.global, set: async (value: unknown) => { this.global = structuredClone(value) } },
      table: () => ({
        get: (id: string) => this.records.get(id),
        put: async (id: string, value: unknown) => { this.records.set(id, structuredClone(value)) },
        delete: async (id: string) => this.records.delete(id),
      }),
      close: async () => {},
    }
    return domain as unknown as Domain<S>
  }
}

class TestAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  output = '请解释这次修改的原因'
  paused: Promise<void> | null = null
  entered: (() => void) | null = null
  failNext = false
  async resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo> {
    return { provider, id, name: 'Local fixture', reasoning: { efforts: [
      { id: ReasoningEffortId('fixture-low'), name: 'Low' }, { id: ReasoningEffortId('fixture-high'), name: 'High' },
    ] } }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.failNext) { this.failNext = false; throw new Error('temporary provider failure') }
    this.entered?.()
    if (this.paused) await this.paused
    yield { type: 'text-delta', index: 0, text: this.output }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0)) await root.fiber.dispose(); vi.restoreAllMocks() })

async function fixture(storageFailures = 0) {
  const ctx = new Context(); roots.push(ctx)
  new TypertRegistry(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  const catalog = new TestModelCatalog(ctx)
  const storage = new TestStorageDomain(ctx, storageFailures)
  const llm = new LlmRuntime(ctx), adapter = new TestAdapter()
  llm.registerAdapter(['fixture'], adapter)
  const gateway = new TypertGatewayService(ctx, {})
  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  const fiber = ctx.plugin(plugin, {})
  await fiber.await()
  const session = ctx.sessions.create(SessionId('test-session'))
  const call = async <T>(method: string, data: unknown): Promise<T> => await gateway.invoke({
    namespace: 'input-assistant', method: 'call', args: { payload: { method, data } }, peer,
  }) as T
  return { ctx, adapter, storage, catalog, gateway, peer, fiber, session, call }
}

function complete(session: Session, turn: number) {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '修复问题，并解释原因' }] }), { surfaceOp: 'append' })
  const text = '问题已修复。'
  session.append('assistant/message', {
    turn, step: 1,
    message: createAssistantMessage({ source: { provider: 'fixture', model: 'model' }, content: [{ type: 'text', text }] }),
    stream: [
      { type: 'text-chunks', time0: 0, index: 0, dt: [0], texts: [text] },
      { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } },
    ],
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function generation(status: AssistantStatus, overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    operation: 'next', requestId: 'generation-1', sessionId: 'test-session',
    draft: '', draftRev: 1, span: { start: 0, end: 0, draftRev: 1 },
    connectionGeneration: status.generation, sourceTurnId: status.sourceTurnId,
    provider: 'fixture', model: 'model', routeKey: JSON.stringify(['fixture', 'model']), ...overrides,
  }
}

describe('real DSH Gateway / projection / LLM composition', () => {
  it('reports unavailable optional model catalog support without opening storage', async () => {
    const ctx = new Context(); roots.push(ctx)
    const open = vi.fn(async () => { throw new Error('storage must not open') })
    const runtime = new AssistantHostRuntime(ctx, new AssistantStorage(open))
    await expect(runtime.models(new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_CATALOG' })
    expect(open).not.toHaveBeenCalled()
    runtime.dispose()
  })
  it('returns a read-only global model catalog without a session or generation', async () => {
    const f = await fixture(), before = f.session.seq, beforeHeader = f.session.requestHeader()
    const catalog = await f.call<AssistantModelCatalog>('models/list', {})
    expect(catalog).toEqual({
      groups: [{ provider: 'fixture', name: 'Fixture provider', models: [{ id: 'model', name: 'Fixture model' }] }],
      failures: [{ provider: 'offline', name: 'Offline provider' }],
    })
    expect(f.catalog.calls).toBe(1)
    expect(f.adapter.requests).toHaveLength(0)
    expect(f.session.seq).toBe(before)
    expect(f.session.requestHeader()).toEqual(beforeHeader)
    f.catalog.failed = true
    await expect(f.call('models/list', {})).rejects.toMatchObject({ details: { code: 'INPUT_ASSISTANT' } })
    f.catalog.failed = false
    expect((await f.call<AssistantModelCatalog>('models/list', {})).groups).toHaveLength(1)
  })

  it('accepts Unicode code-point budgets through generation and durable draft RPCs', async () => {
    const f = await fixture()
    await f.call('settings/set', { maxDraftChars: 32000 })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const text = '😀'.repeat(20000)
    const request = generation(status, { operation: 'optimize', draft: text, targetText: text,
      span: { start: 0, end: text.length, draftRev: 1 } })
    expect((await f.call<GenerationResult>('generate', request)).text).toBe(f.adapter.output)
    expect(f.adapter.requests).toHaveLength(1)
    const saved = await f.call<StoredDraft[]>('drafts/save', { sessionId: f.session.id, text })
    expect(saved[0].text).toBe(text)
    await expect(f.call('generate', { ...request, targetText: '😀'.repeat(32001) })).rejects.toMatchObject({ details: { code: 'INPUT' } })
    await expect(f.call('drafts/save', { sessionId: f.session.id, text: '😀'.repeat(32001) })).rejects.toMatchObject({ details: { code: 'INPUT' } })
  })

  it('allows explicit suggestions with automatic switches off while retaining host throttling', async () => {
    const f = await fixture(); complete(f.session, 1)
    await f.call('settings/set', { nextEnabled: false, completionEnabled: false })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const request = generation(status)
    expect((await f.call<GenerationResult>('generate', request)).text).toBeNull()
    expect((await f.call<GenerationResult>('generate', { ...request, manual: true })).text).toBe(f.adapter.output)
    expect((await f.call<GenerationResult>('generate', { ...request, manual: true, requestId: 'manual-again' })).text).toBe(f.adapter.output)
    const draft = '请解释时间', completion = { ...request, manual: true, operation: 'complete', draft,
      span: { start: draft.length, end: draft.length, draftRev: 1 } }
    expect((await f.call<GenerationResult>('generate', completion)).text).toBe(f.adapter.output)
    expect(await f.call<GenerationResult>('generate', completion)).toMatchObject({ outcome: 'throttled', text: null })
    expect(f.adapter.requests).toHaveLength(3)
    f.session.append('turn/start', { turn: 2 })
    const running = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    expect((await f.call<GenerationResult>('generate', { ...completion, sourceTurnId: running.sourceTurnId, connectionGeneration: running.generation })).text).toBeNull()
    expect(f.adapter.requests).toHaveLength(3)
  })
  it('routes strict RPC, takes completed context and dispatches once without changing the main session', async () => {
    const f = await fixture()
    complete(f.session, 1)
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const before = f.session.seq
    const request = generation(status)
    const first = await f.call<GenerationResult>('generate', request)
    expect(first.text).toBe('请解释这次修改的原因')
    expect((await f.call<GenerationResult>('generate', { ...request, requestId: 'duplicate' })).text).toBeNull()
    expect(f.adapter.requests).toHaveLength(1)
    const options = f.adapter.requests[0]!
    expect(options.reasoningEffort).toBe('fixture-low')
    expect(options.tools).toEqual([])
    expect(JSON.stringify(options.messages)).toContain('修复问题，并解释原因')
    expect(f.session.seq).toBe(before)
  })

  it('retries a failed storage open and shares a successful open across later requests', async () => {
    const f = await fixture(1)
    await expect(f.call('settings/get', {})).rejects.toMatchObject({ details: { code: 'INPUT_ASSISTANT' } })
    const results = await Promise.all([f.call<AssistantConfig>('settings/get', {}), f.call('drafts/list', { sessionId: f.session.id })])
    expect(results[0].optimizeEnabled).toBe(true)
    expect(results[1]).toEqual([])
    expect(f.storage.attempts).toBe(2)
    await f.call('settings/get', {})
    expect(f.storage.attempts).toBe(2)
  })

  it('cancels an in-flight generation when another owner client changes global settings', async () => {
    const f = await fixture()
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const draft = '解释缓存机制，保留接口'
    let release!: () => void
    f.adapter.paused = new Promise(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { f.adapter.entered = resolve })
    const pending = f.call<GenerationResult>('generate', generation(status, { operation: 'optimize', draft,
      targetText: draft, span: { start: 0, end: draft.length, draftRev: 1 } }))
    const rejected = expect(pending).rejects.toMatchObject({ details: { code: 'CANCELLED' } })
    try {
      await entered
      const otherPeer = new Peer(f.ctx, { principal: { kind: 'owner' } })
      await f.gateway.invoke({ namespace: 'input-assistant', method: 'call', args: { payload: {
        method: 'settings/set', data: { optimizeEnabled: false, provider: 'fixture', model: 'new-auxiliary' },
      } }, peer: otherPeer })
      await rejected
      expect(f.adapter.requests[0].signal?.aborted).toBe(true)
      expect(await f.call('settings/get', {})).toMatchObject({ optimizeEnabled: false, provider: 'fixture', model: 'new-auxiliary' })
      expect(f.adapter.requests).toHaveLength(1)
    } finally { release() }
  })

  it('persists prediction detail and expanded limits together with a fixed auxiliary route', async () => {
    const f = await fixture()
    expect(await f.call('settings/get', {})).toMatchObject({ predictionDetail: 'standard' })
    await f.call('settings/set', { predictionDetail: 'detailed', maxNextChars: 1000, maxCompletionChars: 500,
      provider: 'fixture', model: 'saved-auxiliary' })
    await f.call('settings/set', { displayMode: 'panel' })
    expect(await f.call('settings/get', {})).toMatchObject({ predictionDetail: 'detailed', maxNextChars: 1000,
      maxCompletionChars: 500, provider: 'fixture', model: 'saved-auxiliary', displayMode: 'panel' })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const draft = '说明缓存'
    await f.call('generate', generation(status, { operation: 'optimize', draft,
      targetText: draft, span: { start: 0, end: draft.length, draftRev: 1 } }))
    expect(f.adapter.requests[0].model).toBe('saved-auxiliary')
    await expect(f.call('settings/set', { predictionDetail: 'unsupported' })).rejects.toMatchObject({ details: { code: 'CONFIG' } })
    expect((await f.call<AssistantConfig>('settings/get', {})).predictionDetail).toBe('detailed')
  })

  it('deduplicates successful next predictions by their actual model route', async () => {
    const f = await fixture()
    complete(f.session, 1)
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const request = (model: string) => generation(status, { model, routeKey: JSON.stringify(['fixture', model]) })
    expect(await f.call('generate', request('a'))).toMatchObject({ text: f.adapter.output, outcome: 'suggestion' })
    expect(await f.call('generate', request('b'))).toMatchObject({ text: f.adapter.output, outcome: 'suggestion' })
    expect(await f.call('generate', request('a'))).toMatchObject({ text: null, outcome: 'abstained' })
    expect(f.adapter.requests).toHaveLength(2)
  })

  it('allows a same-turn prediction after fixing a missing model or a transient provider failure', async () => {
    const f = await fixture()
    complete(f.session, 1)
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const missing = generation(status, { routeKey: '' })
    delete missing.provider; delete missing.model
    await expect(f.call('generate', missing)).rejects.toMatchObject({ details: { code: 'MODEL' } })
    f.adapter.failNext = true
    await expect(f.call('generate', generation(status))).rejects.toMatchObject({ details: { code: 'OUTPUT' } })
    expect(await f.call('generate', generation(status))).toMatchObject({ text: f.adapter.output, outcome: 'suggestion' })
    expect(f.adapter.requests).toHaveLength(2)
  })

  it('distinguishes real abstention from temporary completion throttling and allows retry at its deadline', async () => {
    const f = await fixture()
    await f.call('settings/set', { minIntervalMs: 30000 })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const draft = '请解释这段代码的时间'
    const request = generation(status, { operation: 'complete', draft, span: { start: draft.length, end: draft.length, draftRev: 1 } })
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    f.adapter.output = '[[NO_SUGGESTION]]'
    expect(await f.call('generate', request)).toMatchObject({ text: null, outcome: 'abstained' })
    clock.mockReturnValue(now + 1000)
    expect(await f.call('generate', request)).toMatchObject({ text: null, outcome: 'throttled', retryAfterMs: 29000 })
    expect(f.adapter.requests).toHaveLength(1)
    clock.mockReturnValue(now + 30000)
    f.adapter.output = '复杂度。'
    expect(await f.call('generate', request)).toMatchObject({ text: '复杂度。', outcome: 'suggestion' })
    expect(f.adapter.requests).toHaveLength(2)
  })

  it('uses a saved auxiliary model after settings rereads and unrelated updates', async () => {
    const f = await fixture()
    await f.call('settings/set', { provider: 'fixture', model: 'auxiliary' })
    expect(await f.call('settings/get', {})).toMatchObject({ provider: 'fixture', model: 'auxiliary' })
    await f.call('settings/set', { displayMode: 'panel' })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const draft = '说明原因'
    await f.call('generate', generation(status, { operation: 'optimize', draft, span: { start: 0, end: draft.length, draftRev: 1 } }))
    expect(f.adapter.requests[0]?.model).toBe('auxiliary')
  })

  it('rejects late generation when a new real session turn arrives', async () => {
    const f = await fixture()
    complete(f.session, 1)
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    let release!: () => void
    f.adapter.paused = new Promise(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { f.adapter.entered = resolve })
    const pending = f.call('generate', generation(status))
    const rejection = expect(pending).rejects.toMatchObject({ details: { code: 'CANCELLED' } })
    await entered
    f.session.append('turn/start', { turn: 2 })
    await rejection
    release()
    expect((await f.call<AssistantStatus>('status', { sessionId: f.session.id })).sourceTurnId).toBeNull()
  })

  it('abstains from a queued first-draft completion after turn/start but permits an idle first draft', async () => {
    const running = await fixture()
    const statusBeforeTurn = await running.call<AssistantStatus>('status', { sessionId: running.session.id })
    expect(statusBeforeTurn).toMatchObject({ sourceTurnId: null, running: false })
    const draft = '请解释这段代码的时间'
    const request = generation(statusBeforeTurn, { operation: 'complete', draft,
      span: { start: draft.length, end: draft.length, draftRev: 1 } })
    running.session.append('turn/start', { turn: 1 })
    expect(await running.call('generate', request)).toMatchObject({ text: null })
    expect(running.adapter.requests).toHaveLength(0)

    // No completed turn is required for a genuinely idle initial draft.
    const idle = await fixture()
    const initial = await idle.call<AssistantStatus>('status', { sessionId: idle.session.id })
    idle.adapter.output = '复杂度。'
    expect(await idle.call('generate', generation(initial, { operation: 'complete', draft,
      span: { start: draft.length, end: draft.length, draftRev: 1 } }))).toMatchObject({ text: '复杂度。' })
    expect(idle.adapter.requests).toHaveLength(1)
  })

  it('optimizes with the lowest supported effort while preserving the main conversation High setting', async () => {
    const f = await fixture()
    complete(f.session, 1)
    f.session.append('request/header', { reason: 'initial', header: {
      config: { provider: 'fixture', model: 'model', reasoningEffort: ReasoningEffortId('fixture-high') },
    } })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    const before = f.session.seq
    f.adapter.output = '请清楚说明修复原因，保持简洁。'
    const draft = '说说为什么这么改'
    const result = await f.call<GenerationResult>('generate', generation(status, {
      operation: 'optimize', requestId: 'optimize-low', draft,
      span: { start: 0, end: draft.length, draftRev: 1 },
    }))
    expect(result.text).toBe(f.adapter.output)
    expect(f.adapter.requests).toHaveLength(1)
    expect(f.adapter.requests[0]!.reasoningEffort).toBe('fixture-low')
    expect(f.session.requestHeader()?.config.reasoningEffort).toBe('fixture-high')
    expect(f.session.seq).toBe(before)
  })

  it('uses durable plugin-owned settings and session-isolated drafts through the Gateway', async () => {
    const f = await fixture()
    await f.call('settings/set', { displayMode: 'panel', nextEnabled: false })
    const saved = await f.call<StoredDraft[]>('drafts/save', { sessionId: f.session.id, text: '先暂存的长提示词' })
    expect(saved).toHaveLength(1)
    expect((await f.call<AssistantStatus>('status', { sessionId: f.session.id })).settings.displayMode).toBe('panel')
    const other = f.ctx.sessions.create(SessionId('another'))
    expect(await f.call('drafts/list', { sessionId: other.id })).toEqual([])
    expect(await f.call('drafts/list', { sessionId: f.session.id })).toEqual(saved)
    await f.call('drafts/clear', { sessionId: f.session.id })
    expect(await f.call('drafts/list', { sessionId: f.session.id })).toEqual([])
  })

  it('blocks disabled manual capabilities on the Host before any model call while retaining draft management', async () => {
    const f = await fixture()
    const saved = await f.call<StoredDraft[]>('drafts/save', { sessionId: f.session.id, text: '关闭前保存的草稿' })
    await f.call('settings/set', { optimizeEnabled: false, stashEnabled: false, optimizationStrength: 'deep' })
    const status = await f.call<AssistantStatus>('status', { sessionId: f.session.id })
    expect(status.settings).toMatchObject({ optimizeEnabled: false, stashEnabled: false, optimizationStrength: 'deep' })
    const draft = '解释缓存，不改文件'
    await expect(f.call('generate', generation(status, { operation: 'optimize', draft,
      span: { start: 0, end: draft.length, draftRev: 1 } }))).rejects.toMatchObject({ details: { code: 'DISABLED' } })
    expect(f.adapter.requests).toHaveLength(0)
    await expect(f.call('drafts/save', { sessionId: f.session.id, text: '关闭后不能保存' }))
      .rejects.toMatchObject({ details: { code: 'DISABLED' } })
    expect(await f.call('drafts/list', { sessionId: f.session.id })).toEqual(saved)
    expect(await f.call('drafts/delete', { sessionId: f.session.id, id: saved[0]!.id })).toEqual({ drafts: [], removed: saved })
    expect(await f.call('drafts/clear', { sessionId: f.session.id })).toEqual({ drafts: [], removed: [] })
    expect(await f.call('drafts/restore', { sessionId: f.session.id, drafts: saved })).toEqual(saved)
  })

  it('returns every actually cleared draft for undo, including records another client saved', async () => {
    const f = await fixture()
    await f.call('drafts/save', { sessionId: f.session.id, text: 'first' })
    const all = await f.call<StoredDraft[]>('drafts/save', { sessionId: f.session.id, text: 'second from another client' })
    const removed = await f.call<DraftMutationResult>('drafts/clear', { sessionId: f.session.id })
    expect(removed).toEqual({ drafts: [], removed: all })
    expect(await f.call('drafts/restore', { sessionId: f.session.id, drafts: removed.removed })).toEqual(all)
  })

  it('unloads strict endpoint and rejects malformed requests without reaching a model', async () => {
    const f = await fixture()
    await expect(f.gateway.invoke({ namespace: 'input-assistant', method: 'call', args: { payload: { method: 'unsafe', data: {} } }, peer: f.peer }))
      .rejects.toMatchObject({ code: 'gateway/input-invalid' })
    await f.fiber.dispose()
    await expect(f.call('settings/get', {})).rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
    expect(f.adapter.requests).toHaveLength(0)
  })
})
