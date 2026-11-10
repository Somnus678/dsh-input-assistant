import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-session-projection'
import { AssistantError, DEFAULT_CONFIG, resolveConfig, type AssistantConfig } from './core/index.js'
import { AssistantHostRuntime } from './host/runtime.js'
import { AssistantStorage, createDomainSpec, type AssistantDomain } from './host/storage.js'
import { emptyTranscript, foldTranscript, transcriptSchema } from './host/transcript.js'
import { hostContribution, rpcPayloadSchema, type RpcPayload } from './host/rpc.js'

export type Config = Partial<AssistantConfig>
export const name = 'input-assistant'
export const inject = ['llm', 'sessions', 'sessionProjections', 'storageDomain', 'typert', 'typertGateway']
export const Config = schema.object({
  optimizeEnabled: schema.boolean().default(true), stashEnabled: schema.boolean().default(true),
  optimizationStrength: schema.union(['light', 'standard', 'deep']).default('standard'),
  nextEnabled: schema.boolean().default(true), completionEnabled: schema.boolean().default(true),
  predictionDetail: schema.union(['concise', 'standard', 'detailed']).default('standard'),
  displayMode: schema.union(['ghost', 'panel']).default('ghost'),
  debounceMs: schema.natural().min(200).max(5000).default(600),
  minIntervalMs: schema.natural().min(500).max(30000).default(2000),
  maxHistoryChars: schema.natural().min(1000).max(64000).default(16000),
  maxDraftChars: schema.natural().min(100).max(32000).default(8000),
  maxNextChars: schema.natural().min(20).max(1000).default(120),
  maxCompletionChars: schema.natural().min(10).max(500).default(80),
  optimizeTimeoutMs: schema.natural().min(1000).max(120000).default(60000),
  suggestionTimeoutMs: schema.natural().min(1000).max(60000).default(15000),
  provider: schema.string().default(''), model: schema.string().default(''),
})

declare module '@deepseek-ai/cordis' { interface Context { inputAssistant: InputAssistantService } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'input-assistant/error': { code: string }
    'input-assistant/forbidden': Record<string, never>
  }
}

/** One strictly described Remote endpoint; the standard Gateway owns transport. */
export class InputAssistantService extends TypertRemoteService {
  constructor(ctx: Context, private readonly runtime: AssistantHostRuntime) {
    super(ctx, 'inputAssistant', { namespace: 'input-assistant' })
  }
  async call(payload: RpcPayload, signal: AbortSignal): Promise<unknown> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new RemoteError('input-assistant/forbidden', '输入助手仅供当前宿主用户使用', {})
    try {
      return await this.runtime.invoke(rpcPayloadSchema.parse(payload), signal)
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof AssistantError) throw new RemoteError('input-assistant/error', error.message, { code: error.code })
      if (error instanceof Error && error.name === 'ZodError') throw new RemoteError('input-assistant/error', '请求格式无效', { code: 'INPUT' })
      // Provider/storage diagnostics may contain private material; never echo them.
      throw new RemoteError('input-assistant/error', '操作未完成，请检查模型连接或插件存储；当前草稿保持不变', { code: 'INPUT_ASSISTANT' })
    }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const initial = resolveConfig({ ...DEFAULT_CONFIG, ...config })
  let opened: Promise<AssistantDomain> | undefined
  const domain = (): Promise<AssistantDomain> => {
    if (opened) return opened
    const attempt = Promise.resolve().then(() => ctx.storageDomain.open(createDomainSpec(initial)))
    opened = attempt
    // Keep one shared open in flight, but do not cache a transient failure for
    // the rest of this plugin mount. A later user action or status read can retry.
    void attempt.catch(() => { if (opened === attempt) opened = undefined })
    return attempt
  }
  const runtime = new AssistantHostRuntime(ctx, new AssistantStorage(domain))
  ctx.sessionProjections.register({
    key: 'inputAssistantTranscript', stateSchema: transcriptSchema, init: emptyTranscript,
    apply: foldTranscript, stateVersion: 1,
  })
  new InputAssistantService(ctx, runtime)
  ctx.typert.register(hostContribution)
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end' || event.type === 'request/header') runtime.changed(session)
  })
  ctx.on('session/disposed', session => runtime.changed(session))
  ctx.effect(() => async () => {
    runtime.dispose()
    if (opened) { try { await (await opened).close() } catch { /* The storage owner may already have disposed. */ } }
  })
}
