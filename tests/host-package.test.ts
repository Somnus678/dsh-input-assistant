import { afterAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AssistantStatus, StoredDraft } from '../src/core/types'

/** Only the external medium is replaced; Loader, Gateway and plugin are published code. */
class PersistentFixtureMedium extends Service {
  private readonly records = new Map<string, unknown>()
  private savedGlobal: unknown
  constructor(ctx: Context) { super(ctx, 'storageDomain') }
  async open<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
    this.savedGlobal ??= structuredClone(spec.global!.initial)
    return {
      name: spec.name,
      global: { get: () => this.savedGlobal, set: async (value: unknown) => { this.savedGlobal = structuredClone(value) } },
      table: () => ({
        get: (key: string) => this.records.get(key),
        put: async (key: string, value: unknown) => { this.records.set(key, structuredClone(value)) },
        delete: async (key: string) => this.records.delete(key),
      }),
      close: async () => {},
    } as unknown as Domain<S>
  }
}

const releaseVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
const archive = resolve(`dist/dsh-input-assistant-${releaseVersion}.tgz`)
const parent = resolve('.test-runtime')
let extraction: string | undefined
let ctx: Context | undefined
afterAll(async () => {
  await ctx?.fiber.dispose()
  // Only delete this test's verified, absolute child of the workspace cache.
  if (extraction) {
    if (!extraction.startsWith(parent + sep) || !extraction.slice(parent.length + 1).startsWith('host-package-')) throw new Error('Unsafe test cleanup target')
    await rm(extraction, { recursive: true, force: true })
  }
})

async function extractPublishedPackage(): Promise<string> {
  extraction = resolve(parent, `host-package-${randomUUID()}`)
  await mkdir(extraction, { recursive: true })
  const tar = gunzipSync(await readFile(archive))
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '')
    if (!name) break
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/s, '')
    const entry = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0
    const target = resolve(extraction, entry)
    if (!target.startsWith(extraction + sep)) throw new Error('Archive path escapes test directory')
    const type = header[156]
    if (type === 0 || type === 48) {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, tar.subarray(offset + 512, offset + 512 + size))
    } else if (type === 53) await mkdir(target, { recursive: true })
    else if (type !== 120 && type !== 103) throw new Error('Unexpected archive link or special entry')
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return resolve(extraction, 'package')
}

describe.skipIf(!existsSync(archive))('published .tgz through the official Loader', () => {
  it('loads actual packed entry, configures, disables, reenables and unloads with drafts preserved', async () => {
    const packedRoot = await extractPublishedPackage()
    const pkg = JSON.parse(await readFile(resolve(packedRoot, 'package.json'), 'utf8'))
    expect(pkg.engines.dsh).toBe('0.2.1-rc.2')
    const patch = await readFile(resolve(packedRoot, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('name: dsh-input-assistant')
    ctx = new Context()
    new TypertRegistry(ctx)
    new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    new PersistentFixtureMedium(ctx)
    new LlmRuntime(ctx)
    const gateway = new TypertGatewayService(ctx, {})
    const peer = new Peer(ctx, { principal: { kind: 'owner' } })
    // Loader installs its isolation hooks in a child fiber. Await its normal
    // plugin lifecycle before creating entries, as the actual application does.
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(packedRoot + sep).href }).await()
    const loader = ctx.loader
    const id = await loader.create({ name: pkg.name, config: { displayMode: 'panel' } })
    await loader.await()
    await loader.resolve(id).fiber?.await()
    expect(ctx.get('inputAssistant')).toBeDefined()
    const session = ctx.sessions.create(SessionId('packed-session'))
    const call = async <T>(method: string, data: unknown): Promise<T> => await gateway.invoke({
      namespace: 'input-assistant', method: 'call', args: { payload: { method, data } }, peer,
    }) as T
    const before = await call<AssistantStatus>('status', { sessionId: session.id })
    expect(before.settings.displayMode).toBe('panel')
    const drafts = await call<StoredDraft[]>('drafts/save', { sessionId: session.id, text: '安装包中的草稿 😀\n第二行' })
    await call('settings/set', { nextEnabled: false })
    await loader.update(id, { disabled: true })
    await loader.await()
    expect(ctx.get('inputAssistant')).toBeUndefined()
    await expect(call('settings/get', {})).rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
    await loader.update(id, { disabled: false })
    await loader.await()
    await loader.resolve(id).fiber?.await()
    expect(await call('drafts/list', { sessionId: session.id })).toEqual(drafts)
    const after = await call<AssistantStatus>('status', { sessionId: session.id })
    expect(after.settings.nextEnabled).toBe(false)
    expect(after.generation).not.toBe(before.generation)
    loader.remove(id)
    await loader.await()
    expect(ctx.get('inputAssistant')).toBeUndefined()
    await expect(call('settings/get', {})).rejects.toMatchObject({ code: 'gateway/definition-unavailable' })
  }, 30_000)
})
