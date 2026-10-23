/** Interactive, zero-network test adapter. This file is excluded from releases. */
import assert from 'node:assert/strict'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export const name = 'input-assistant-completion-fixture'
export const inject = ['inputAssistant', 'typertGateway', 'connection', 'llm']
const cache = resolve(fileURLToPath(new URL('../../', import.meta.url)), '.test-runtime/desktop-fixture')

export async function apply(ctx, config) {
  const directory = resolve(config.directory)
  assert(directory.startsWith(cache + sep))
  assert(/^[a-f0-9-]+$/.test(config.runId))
  const provider = `input-assistant-fixture-${config.runId}`
  const model = 'completion-fixture'
  const target = '请解释这段代码的时间'
  const suffix = '复杂度。'
  const report = { kind: 'interactive-local-completion-fixture', pid: process.pid,
    startedAt: new Date().toISOString(), paidRequests: 0, localRequests: 0,
    matchingRequests: 0, provider, model, ready: false, cleaned: false }
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
  const call = (method, data) => ctx.typertGateway.invoke({ namespace: 'input-assistant', method: 'call',
    args: { payload: { method, data } }, peer })
  let before
  let modified = false
  let unregister
  let cleaning
  let stop = false
  const saveReport = (filename, extra = {}) => writeFile(resolve(directory, filename), JSON.stringify({ ...report, ...extra }, null, 2) + '\n')
  const cleanup = () => cleaning ??= (async () => {
    stop = true
    let settingsRestored = !modified
    let concurrentSettingsChange = false
    try {
      if (modified) {
        const current = await call('settings/get', {})
        const restored = { ...current }
        const expected = { provider, model, completionEnabled: true, nextEnabled: false }
        for (const key of Object.keys(expected)) {
          if (current[key] === expected[key]) restored[key] = before[key]
          else if (current[key] !== before[key]) concurrentSettingsChange = true
        }
        await call('settings/set', restored)
        const after = await call('settings/get', {})
        settingsRestored = Object.keys(expected).every(key => after[key] === before[key])
      }
    } catch { report.cleanupError = 'Settings restoration did not complete; use the saved non-sensitive settings snapshot.' }
    unregister?.()
    report.fixtureRouteRemoved = !ctx.llm.listProviders().some(row => row.id === provider)
    await peer.dispose()
    report.settingsRestored = settingsRestored
    report.concurrentSettingsChange = concurrentSettingsChange
    report.cleaned = settingsRestored && report.fixtureRouteRemoved
    report.finishedAt = new Date().toISOString()
    await saveReport('finished.json')
  })()
  ctx.effect(() => async () => { await cleanup() })
  try {
    await mkdir(directory, { recursive: true })
    before = await call('settings/get', {})
    await writeFile(resolve(directory, 'settings-before.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' })
    const adapter = {
      providerInfo: id => ({ id, name: 'Input Assistant local zero-token fixture' }),
      providerRetryPolicy: () => undefined,
      imageRequestPricing: () => undefined,
      imageRequestTarget: (_provider, _model, image) => ({ width: image.width, height: image.height, maxBytes: image.bytes }),
      listModels: async () => [{ provider, id: model, name: 'Local completion fixture (no network)' }],
      resolveModel: async () => ({ provider, id: model, name: 'Local completion fixture',
        reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' }, inputModalities: ['text'] }),
      async prepareCall() { return { model: await this.resolveModel(), stream: options => this.stream(options) } },
      async *stream(options) {
        options.signal?.throwIfAborted()
        report.localRequests++
        let match = false
        try {
          const text = options.messages.at(-1)?.content.find(block => block.type === 'text')?.text
          match = JSON.parse(text).draft === target
        } catch { /* Other drafts get a normal abstention, never a network call. */ }
        if (match) report.matchingRequests++
        await saveReport('requests.json')
        yield { type: 'text-delta', index: 0, text: match ? suffix : '[[NO_SUGGESTION]]' }
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    unregister = ctx.llm.registerAdapter([provider], adapter)
    await call('settings/set', { provider, model, nextEnabled: false, completionEnabled: true })
    modified = true
    report.ready = true
    report.deadlineAt = new Date(Date.now() + 5 * 60_000).toISOString()
    await saveReport('ready.json', { instruction: `在真实输入框输入“${target}”，等待灰字“${suffix}”，按Tab采纳；请勿发送。结束后写入cleanup.signal。` })
    const deadline = Date.now() + 5 * 60_000
    while (!stop && Date.now() < deadline) {
      try { await access(resolve(directory, 'cleanup.signal')); break } catch { /* waiting for the operator */ }
      await delay(200)
    }
  } catch (error) {
    report.error = { name: error?.name ?? 'Error', code: error?.code ?? 'FIXTURE_FAILED' }
  } finally {
    await cleanup()
  }
}
