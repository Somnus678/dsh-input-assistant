import { describe, expect, it } from 'vitest'
import { AssistantStorage, type AssistantDomain } from '../src/host/storage'
import { DEFAULT_CONFIG } from '../src/core/types'

function fixture() {
  const records = new Map<string, unknown>()
  let global = { version: 1 as const, settings: { ...DEFAULT_CONFIG } }
  let fail = false
  const domain = {
    global: { get: () => global, set: async (value: typeof global) => { if (fail) throw new Error('disk full'); global = value } },
    table: () => ({
      get: (key: string) => records.get(key),
      put: async (key: string, value: unknown) => { if (fail) throw new Error('disk full'); records.set(key, structuredClone(value)) },
      delete: async (key: string) => { if (fail) throw new Error('disk full'); return records.delete(key) },
    }),
  } as unknown as AssistantDomain
  return { create: () => new AssistantStorage(async () => domain), fail: () => { fail = true } }
}

describe('session-isolated durable drafts', () => {
  it('serializes concurrent initial saves and enforces the three-draft cap', async () => {
    const storage = fixture().create()
    const results = await Promise.allSettled(['a', 'b', 'c', 'd'].map(text => storage.save('session-a', text)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3)
    expect((await storage.list('session-a')).map(draft => draft.text)).toEqual(['a', 'b', 'c'])
    expect(await storage.list('session-b')).toEqual([])
  })

  it('retains explicitly saved text after a rejected replacement and across repository reopen', async () => {
    const f = fixture(), storage = f.create()
    const saved = await storage.save('a', '长草稿原文')
    f.fail()
    await expect(storage.save('a', '未能保存的新稿', saved[0]!.id)).rejects.toThrow('disk full')
    expect((await f.create().list('a'))[0]?.text).toBe('长草稿原文')
  })

  it('replaces only the explicitly selected draft and returns defensive snapshots', async () => {
    const storage = fixture().create()
    const before = await storage.save('a', 'first')
    await storage.save('a', 'second')
    await storage.save('a', 'replacement', before[0]!.id)
    const read = await storage.list('a')
    read[0]!.text = 'mutated outside'
    expect((await storage.list('a')).map(draft => draft.text)).toEqual(['replacement', 'second'])
    await expect(storage.save('a', 'bad', 'missing')).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
  })

  it('validates settings before committing and retains selected display mode on reopen', async () => {
    const f = fixture(), storage = f.create()
    await storage.updateSettings({ displayMode: 'panel', nextEnabled: false })
    await expect(storage.updateSettings({ debounceMs: 0 })).rejects.toMatchObject({ code: 'CONFIG' })
    expect(await f.create().settings()).toMatchObject({ displayMode: 'panel', nextEnabled: false, debounceMs: 600 })
  })
})

describe('stored settings survive version drift', () => {
  /** A storage fixture seeded with an arbitrary persisted record. */
  function seeded(initial: unknown) {
    let global: { version: 1; settings: unknown } = { version: 1, settings: initial }
    const domain = {
      global: { get: () => global, set: async (value: typeof global) => { global = value } },
      table: () => ({ get: () => undefined, put: async () => {}, delete: async () => {} }),
    } as unknown as AssistantDomain
    return { storage: new AssistantStorage(async () => domain), read: () => global }
  }

  it('ignores an unknown key written by a different version instead of locking every endpoint', async () => {
    const f = seeded({ ...DEFAULT_CONFIG, futureFlag: true })
    const settings = await f.storage.settings()
    expect(settings.optimizeEnabled).toBe(true)
    expect('futureFlag' in settings).toBe(false)
  })

  it('rewrites a clean record on the next save so the bad key disappears', async () => {
    const f = seeded({ ...DEFAULT_CONFIG, futureFlag: true })
    const saved = await f.storage.updateSettings({ nextEnabled: false })
    expect(saved.nextEnabled).toBe(false)
    expect('futureFlag' in (f.read().settings as object)).toBe(false)
  })

  it('falls back per field for corrupted values while keeping the rest', async () => {
    const f = seeded({ ...DEFAULT_CONFIG, debounceMs: 'oops', optimizeEnabled: 'yes', maxNextChars: 99_999, displayMode: 'panel' })
    const settings = await f.storage.settings()
    expect(settings.debounceMs).toBe(600)
    expect(settings.optimizeEnabled).toBe(true)
    expect(settings.maxNextChars).toBe(120)
    expect(settings.displayMode).toBe('panel')
  })

  it('drops a half-filled auxiliary model pair', async () => {
    const f = seeded({ ...DEFAULT_CONFIG, provider: 'only-provider', model: '' })
    expect(await f.storage.settings()).toMatchObject({ provider: '', model: '' })
  })

  it('still rejects unknown keys in an explicit patch', async () => {
    const f = seeded({ ...DEFAULT_CONFIG })
    await expect(f.storage.updateSettings({ legacyFlag: true } as never)).rejects.toMatchObject({ code: 'CONFIG' })
  })
})
