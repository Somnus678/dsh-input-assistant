import { InputAssistantController, type BrowserTransport, type UsageMetrics, type UndoSnapshot } from './controller.js'
import type { AssistantConfig } from '../core/types.js'

export interface ConnectionFace {
  rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: { code?: string; message?: string } }> }
  generation: { getSnapshot(): { id: number } | undefined; subscribe(listener: () => void): () => void }
}
export interface ModelDirectoryFace {
  directoryFor(sessionId: string): { store: { getSnapshot(): { current: { provider: string; model: string } | null }; subscribe(listener: () => void): () => void }; load(): Promise<unknown> }
}

export class BrowserRuntime {
  private entries = new Map<string, { controller: InputAssistantController; refs: number; waitForMutation?: () => void }>()
  private disposed = false
  private lifetime = new AbortController()
  private pendingSettings = 0
  private settingsQueue: Promise<void> = Promise.resolve()
  private metrics = new Map<string, UsageMetrics>()
  private undo = new Map<string, { snapshot: UndoSnapshot; timer?: ReturnType<typeof setTimeout> }>()
  readonly transport: BrowserTransport
  constructor(readonly connection: ConnectionFace, readonly models?: ModelDirectoryFace) {
    this.transport = {
      generation: () => { const generation = connection.generation.getSnapshot(); return generation ? String(generation.id) : null },
      call: async <T>(method: string, data: unknown, signal?: AbortSignal): Promise<T> => {
        const result = await connection.rpc.call('/api', 'input-assistant/call', { args: { payload: { method, data } } }, signal)
        if (!result.ok) throw new Error(result.error.message || `输入助手请求失败 (${result.error.code || 'unknown'})`)
        return result.value as T
      },
    }
  }
  controllerFor(sessionId: string): InputAssistantController {
    let entry = this.entries.get(sessionId)
    if (!entry) {
      const saved = this.undo.get(sessionId)
      clearTimeout(saved?.timer); this.undo.delete(sessionId)
      entry = { controller: new InputAssistantController(sessionId, this.transport, this.metrics.get(sessionId), update => this.saveSettings(update), saved?.snapshot), refs: 0 }
      this.entries.set(sessionId, entry)
      if (this.pendingSettings) entry.controller.beginSettingsUpdate()
    }
    return entry.controller
  }
  retain(sessionId: string): () => void {
    const controller = this.controllerFor(sessionId), entry = this.entries.get(sessionId)!
    entry.waitForMutation?.(); entry.waitForMutation = undefined
    entry.refs++
    controller.start()
    return () => {
      entry.refs--
      queueMicrotask(() => {
        if (entry.refs === 0 && this.entries.get(sessionId) === entry) {
          const release = () => {
            if (entry.refs !== 0 || this.entries.get(sessionId) !== entry) return
            // A durable delete/save may finish after navigation. Retain its
            // controller until the reply supplies the actual undo snapshot.
            if (controller.getSnapshot().busy === 'stash') {
              entry.waitForMutation ??= controller.subscribe(() => {
                if (controller.getSnapshot().busy !== 'stash') {
                  entry.waitForMutation?.(); entry.waitForMutation = undefined; release()
                }
              })
              return
            }
            this.metrics.set(sessionId, { ...controller.getSnapshot().metrics })
            this.saveUndo(sessionId, controller.getUndoSnapshot())
            controller.dispose(); this.entries.delete(sessionId)
          }
          release()
        }
      })
    }
  }
  private saveUndo(sessionId: string, snapshot: UndoSnapshot): void {
    clearTimeout(this.undo.get(sessionId)?.timer); this.undo.delete(sessionId)
    if (!snapshot.recent.length && !snapshot.pending.length) return
    const record: { snapshot: UndoSnapshot; timer?: ReturnType<typeof setTimeout> } = { snapshot }
    if (snapshot.recent.length && Number.isFinite(snapshot.expiresAt)) {
      record.timer = setTimeout(() => {
        if (this.undo.get(sessionId) !== record) return
        record.snapshot = { ...record.snapshot, recent: [], expiresAt: 0 }
        if (!record.snapshot.pending.length) this.undo.delete(sessionId)
      }, Math.max(0, snapshot.expiresAt - Date.now()))
    }
    this.undo.set(sessionId, record)
  }
  applySettings(settings: AssistantConfig): void {
    for (const entry of this.entries.values()) entry.controller.applySettings(settings)
  }
  async saveSettings(update: Partial<AssistantConfig>): Promise<AssistantConfig> {
    if (this.disposed) throw new Error('输入助手已卸载')
    const generation = this.transport.generation()
    if (generation === null) throw new Error('连接已断开，请重连后保存')
    if (this.pendingSettings++ === 0) for (const entry of this.entries.values()) entry.controller.beginSettingsUpdate()
    const task = this.settingsQueue.then(async () => {
      if (this.disposed) throw new Error('输入助手已卸载')
      if (generation !== this.transport.generation()) throw new Error('连接已变化，请重新加载设置')
      const settings = await this.transport.call<AssistantConfig>('settings/set', update, this.lifetime.signal)
      if (this.disposed || generation !== this.transport.generation()) throw new Error('连接已变化，请重新加载设置')
      this.applySettings(settings)
      return settings
    })
    this.settingsQueue = task.then(() => {}, () => {})
    try { return await task }
    finally { if (--this.pendingSettings === 0) for (const entry of this.entries.values()) entry.controller.endSettingsUpdate() }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifetime.abort()
    for (const entry of this.entries.values()) { entry.waitForMutation?.(); entry.controller.dispose() }
    this.entries.clear()
    this.metrics.clear()
    for (const record of this.undo.values()) clearTimeout(record.timer)
    this.undo.clear()
  }
}
