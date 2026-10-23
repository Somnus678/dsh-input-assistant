import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import { BlockAssembler, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { AssistantError, SessionScheduler, prepareGeneration, finishGeneration, type AssistantConfig, type AssistantStatus, type GenerationRequest, type GenerationResult, type ModelRoute } from '../core/index'
import { AssistantStorage } from './storage'
import { emptyTranscript } from './transcript'
import type { RpcPayload } from './rpc'

const stringId = z.string().min(1).max(300)
const sessionRequest = z.object({ sessionId: stringId })
const generationRequest: z.ZodType<GenerationRequest> = z.object({
  requestId: stringId, sessionId: stringId, operation: z.enum(['optimize', 'next', 'complete']),
  sourceTurnId: z.string().nullable(), draft: z.string().max(128_000), draftRev: z.number().int().nonnegative(),
  span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), draftRev: z.number().int().nonnegative() }),
  connectionGeneration: stringId, routeKey: z.string().max(1000),
  targetText: z.string().max(32_000).optional(), lockedFragments: z.array(z.string().min(1).max(32_000)).max(100).optional(),
  provider: z.string().max(200).optional(), model: z.string().max(200).optional(),
})

interface SessionRuntime { generation: string; lastNextTurn: string | null; lastCompletionAt: number }

export class AssistantHostRuntime {
  private readonly mount = randomUUID()
  private readonly instances = new WeakMap<Session, SessionRuntime>()
  private readonly scheduler = new SessionScheduler()
  private disposed = false
  constructor(private readonly ctx: Context, private readonly storage: AssistantStorage) {}

  private state(session: Session): SessionRuntime {
    let state = this.instances.get(session)
    if (!state) {
      state = { generation: `${this.mount}:${randomUUID()}`, lastNextTurn: null, lastCompletionAt: 0 }
      this.instances.set(session, state)
    }
    return state
  }

  private async session(id: string, signal: AbortSignal): Promise<Session> {
    if (this.disposed) throw new AssistantError('DISPOSED', '输入助手已停用')
    signal.throwIfAborted()
    const live = this.ctx.sessions.get(id as SessionId)
    if (live) return live
    // The standard resolver owns cold-session identity and subagent fences.
    const candidate = await this.ctx.typert.lookups.get('session')?.resolve(id)
    signal.throwIfAborted()
    if (!(candidate instanceof Session) || this.ctx.sessions.get(candidate.id) !== candidate) {
      throw new AssistantError('SESSION', '当前会话尚未就绪，请稍后重试')
    }
    return candidate
  }

  private transcript(session: Session) {
    return this.ctx.sessionProjections.stateOf(session, 'inputAssistantTranscript') ?? emptyTranscript()
  }

  private sessionRoute(session: Session): ModelRoute | undefined {
    const route = session.requestHeader()?.config
    return route?.provider && route.model ? { provider: route.provider, model: route.model } : undefined
  }

  async status(id: string, signal: AbortSignal): Promise<AssistantStatus> {
    const session = await this.session(id, signal)
    const settings = await this.storage.settings()
    const transcript = this.transcript(session)
    const route = this.sessionRoute(session)
    return {
      sourceTurnId: transcript.sourceTurnId, running: transcript.running, settings,
      generation: this.state(session).generation, ...(route ? { route } : {}),
    }
  }

  private result(request: GenerationRequest, text: string | null): GenerationResult {
    return { text, requestId: request.requestId, sessionId: request.sessionId, sourceTurnId: request.sourceTurnId,
      draftRev: request.draftRev, span: { ...request.span }, connectionGeneration: request.connectionGeneration, routeKey: request.routeKey }
  }

  private current(request: GenerationRequest, session: Session): void {
    if (this.disposed || this.ctx.sessions.get(session.id) !== session
      || this.state(session).generation !== request.connectionGeneration
      || this.transcript(session).sourceTurnId !== request.sourceTurnId) {
      throw new AssistantError('STALE', '会话状态已变化，已保留当前草稿')
    }
  }

  async generate(input: unknown, signal: AbortSignal): Promise<GenerationResult> {
    const parsed = generationRequest.safeParse(input)
    if (!parsed.success) throw new AssistantError('INPUT', '输入快照无效')
    const request = parsed.data
    if (request.span.draftRev !== request.draftRev || request.span.end < request.span.start) throw new AssistantError('INPUT', '选区快照无效')
    if (request.provider !== undefined || request.model !== undefined) {
      if (!request.provider || !request.model || request.routeKey !== JSON.stringify([request.provider, request.model])) {
        throw new AssistantError('INPUT', '模型选择已变化，请重新操作')
      }
    }
    const session = await this.session(request.sessionId, signal)
    const settings = await this.storage.settings()
    this.current(request, session)
    if (request.operation === 'optimize' && !settings.optimizeEnabled) {
      throw new AssistantError('DISABLED', '提示词优化已关闭，请在输入助手设置中启用')
    }
    const state = this.state(session)
    const transcript = this.transcript(session)
    if (request.operation === 'next') {
      if (!settings.nextEnabled || transcript.running || request.sourceTurnId === null || request.draft.length > 0
        || state.lastNextTurn === request.sourceTurnId) return this.result(request, null)
      state.lastNextTurn = request.sourceTurnId
    } else if (request.operation === 'complete') {
      // A first-draft request and a just-started turn can both have a null
      // sourceTurnId. Check live running state as well as snapshot identity so
      // an RPC arriving after turn/start cannot spend an auxiliary call.
      if (!settings.completionEnabled || transcript.running) return this.result(request, null)
      const now = Date.now()
      if (now - state.lastCompletionAt < settings.minIntervalMs) return this.result(request, null)
      state.lastCompletionAt = now
    }
    const fallback = this.sessionRoute(session)
    const provider = settings.provider || request.provider || fallback?.provider
    const model = settings.model || request.model || fallback?.model
    if (!provider || !model) throw new AssistantError('MODEL', '请先在 DSH 输入框选择可用模型，或在输入助手设置辅助模型')
    const prepared = prepareGeneration(request, transcript.entries, settings)
    const text = await this.scheduler.run(request.sessionId, request.requestId, request.operation, prepared.timeoutMs, async active => {
      const call = await this.ctx.llm.prepareCall({ provider, model, maxTokens: prepared.maxOutputTokens }, active, (controls, info) => {
        // All three operations are short, auxiliary text tasks. Select the
        // adapter's lowest advertised effort rather than inheriting a costly
        // conversation default or assuming every model accepts "off".
        const effort = info.reasoning?.efforts[0]?.id
        return effort === undefined ? { ...controls } : { ...controls, reasoningEffort: effort }
      })
      active.throwIfAborted()
      this.current(request, session)
      const assembler = new BlockAssembler()
      const options: GenerateOptions = {
        ...call.config, system: prepared.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: prepared.input }] }],
        tools: [], sessionId: session.id, signal: active,
      }
      for await (const chunk of call.stream(options)) {
        active.throwIfAborted()
        if (chunk.type === 'tool-call-delta') throw new AssistantError('OUTPUT', '辅助模型返回工具调用，已保留原稿')
        assembler.push(chunk)
      }
      active.throwIfAborted()
      if (assembler.finish.kind !== 'stop') throw new AssistantError('OUTPUT', '模型输出未正常结束，已保留原稿')
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) throw new AssistantError('OUTPUT', '辅助模型返回了非文本内容')
      const raw = blocks.filter(block => block.type === 'text').map(block => block.text).join('')
      return finishGeneration(raw, prepared)
    }, signal)
    this.current(request, session)
    return this.result(request, text)
  }

  cancel(id: string, requestId?: string): boolean { return this.scheduler.cancel(id, requestId) }
  changed(session: Session): void { this.scheduler.cancel(session.id) }
  dispose(): void { this.disposed = true; this.scheduler.dispose() }

  async invoke(payload: RpcPayload, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    switch (payload.method) {
      case 'generate': return this.generate(payload.data, signal)
      case 'settings/get': return this.storage.settings()
      case 'settings/set': {
        const patch = z.record(z.string(), z.unknown()).parse(payload.data) as Partial<AssistantConfig>
        const result = await this.storage.updateSettings(patch)
        // Settings feed prompt construction, output caps and request intervals, so
        // every in-flight auxiliary request was built from a now-obsolete config.
        // Cancel them all; each settles with CANCELLED and the draft is preserved.
        // This is deliberately broader than cancelling only the changed module.
        this.scheduler.cancelAll()
        return result
      }
      case 'status': return this.status(sessionRequest.parse(payload.data).sessionId, signal)
      case 'cancel': {
        const request = z.object({ sessionId: stringId, requestId: stringId.optional() }).parse(payload.data)
        await this.session(request.sessionId, signal)
        return { cancelled: this.cancel(request.sessionId, request.requestId) }
      }
      case 'drafts/list': {
        const request = sessionRequest.parse(payload.data)
        await this.session(request.sessionId, signal)
        return this.storage.list(request.sessionId)
      }
      case 'drafts/save': {
        const request = z.object({ sessionId: stringId, text: z.string().max(32_000), replaceId: stringId.optional() }).parse(payload.data)
        await this.session(request.sessionId, signal)
        if (!(await this.storage.settings()).stashEnabled) {
          throw new AssistantError('DISABLED', '草稿暂存已关闭，请在输入助手设置中启用；已有草稿仍可查看或删除')
        }
        return this.storage.save(request.sessionId, request.text, request.replaceId)
      }
      case 'drafts/delete': {
        const request = z.object({ sessionId: stringId, id: stringId }).parse(payload.data)
        await this.session(request.sessionId, signal)
        return this.storage.delete(request.sessionId, request.id)
      }
      case 'drafts/clear': {
        const request = sessionRequest.parse(payload.data)
        await this.session(request.sessionId, signal)
        return this.storage.delete(request.sessionId)
      }
    }
  }
}
