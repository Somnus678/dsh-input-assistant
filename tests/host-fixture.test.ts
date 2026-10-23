import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { DEFAULT_CONFIG } from '../src/core/types'

class FixtureSettingsGateway extends Service {
  settings = { ...DEFAULT_CONFIG }
  constructor(ctx: Context) { super(ctx, 'typertGateway') }
  async invoke(request: { args: { payload: { method: string; data: object } } }) {
    const payload = request.args.payload
    if (payload.method === 'settings/get') return { ...this.settings }
    if (payload.method === 'settings/set') { this.settings = { ...this.settings, ...payload.data }; return { ...this.settings } }
    throw new Error('Fixture gateway allows settings only')
  }
}
class FixtureConnection extends Service {
  constructor(ctx: Context) { super(ctx, 'connection') }
  createPeer() { return { dispose: async () => {} } }
}

describe('interactive local zero-token fixture', () => {
  it('uses a real auxiliary adapter and restores every touched setting and route on operator signal', async () => {
    const root = new Context()
    new TypertRegistry(root)
    new LlmRuntime(root)
    new FixtureConnection(root)
    const gateway = new FixtureSettingsGateway(root)
    const before = { ...gateway.settings }
    const cache = resolve('.test-runtime/desktop-fixture')
    const runId = randomUUID()
    const directory = resolve(cache, `test-${runId}`)
    expect(directory.startsWith(cache + sep)).toBe(true)
    await mkdir(directory, { recursive: true })
    let pending: Promise<void> | undefined
    try {
      const moduleUrl = pathToFileURL(resolve('tests/support/desktop-completion-fixture.mjs')).href
      const fixture = await import(moduleUrl)
      pending = fixture.apply(root, { directory, runId })
      let ready: { provider: string; model: string } | undefined
      for (let i = 0; i < 100; i++) {
        try { ready = JSON.parse(await readFile(resolve(directory, 'ready.json'), 'utf8')); break } catch { await delay(10) }
      }
      expect(ready).toBeDefined()
      expect(gateway.settings.nextEnabled).toBe(false)
      expect(gateway.settings.completionEnabled).toBe(true)
      const prepared = await root.llm.prepareCall({ provider: ready!.provider, model: ready!.model, maxTokens: 16 })
      let output = ''
      let tokens = -1
      for await (const chunk of prepared.stream({ ...prepared.config, tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ draft: '请解释这段代码的时间' }) }] }],
      })) {
        if (chunk.type === 'text-delta') output += chunk.text
        if (chunk.type === 'usage') tokens = chunk.usage.totalTokens!
      }
      expect(output).toBe('复杂度。')
      expect(tokens).toBe(0)
      await writeFile(resolve(directory, 'cleanup.signal'), 'cleanup\n')
      await pending
      const report = JSON.parse(await readFile(resolve(directory, 'finished.json'), 'utf8'))
      expect(report).toMatchObject({ paidRequests: 0, localRequests: 1, matchingRequests: 1,
        cleaned: true, settingsRestored: true, fixtureRouteRemoved: true })
      expect(gateway.settings).toEqual(before)
      expect(root.llm.listProviders()).toEqual([])
    } finally {
      await writeFile(resolve(directory, 'cleanup.signal'), 'cleanup\n')
      await pending
      await root.fiber.dispose()
      if (!directory.startsWith(cache + sep) || !directory.slice(cache.length + 1).startsWith('test-')) throw new Error('Unsafe fixture cleanup path')
      await rm(directory, { recursive: true, force: true })
    }
  })
})
