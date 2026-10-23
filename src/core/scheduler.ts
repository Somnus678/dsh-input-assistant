import { AssistantError, type Operation } from './types'
interface Flight { requestId: string; operation: Operation; controller: AbortController }

/** Cancellation settles callers even if a provider ignores AbortSignal. Late results cannot win. */
export class SessionScheduler {
  private flights = new Map<string, Flight>()
  async run<T>(sessionId: string, requestId: string, operation: Operation, timeoutMs: number,
    work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    external?.throwIfAborted()
    const previous = this.flights.get(sessionId)
    if (previous?.operation === 'optimize' && operation !== 'optimize') throw new AssistantError('BUSY', '正在优化提示词')
    previous?.controller.abort(new AssistantError('CANCELLED', '请求已被更新的输入取代'))
    const controller = new AbortController()
    const flight: Flight = { requestId, operation, controller }
    this.flights.set(sessionId, flight)
    const abort = () => controller.abort(external?.reason ?? new AssistantError('CANCELLED', '请求已取消'))
    external?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new AssistantError('TIMEOUT', '模型请求超时')), timeoutMs)
    let rejectAbort: ((reason?: unknown) => void) | undefined
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
    const reject = () => rejectAbort?.(controller.signal.reason)
    controller.signal.addEventListener('abort', reject, { once: true })
    try {
      const result = await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal) }), aborted])
      controller.signal.throwIfAborted()
      if (this.flights.get(sessionId) !== flight) throw new AssistantError('CANCELLED', '请求已过期')
      return result
    } finally {
      clearTimeout(timer); external?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', reject)
      if (this.flights.get(sessionId) === flight) this.flights.delete(sessionId)
    }
  }
  cancel(sessionId: string, requestId?: string): boolean {
    const flight = this.flights.get(sessionId)
    if (!flight || requestId !== undefined && flight.requestId !== requestId) return false
    flight.controller.abort(new AssistantError('CANCELLED', '请求已取消')); this.flights.delete(sessionId); return true
  }
  /** Abort every in-flight request (a generation-affecting settings change invalidates them all). */
  cancelAll(): void { for (const sessionId of [...this.flights.keys()]) this.cancel(sessionId) }
  dispose(): void { this.cancelAll() }
}
