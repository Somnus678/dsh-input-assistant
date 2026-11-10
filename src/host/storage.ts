import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { AssistantError, type AssistantConfig, type DraftMutationResult, type StoredDraft } from '../core/types.js'
import { resolveConfig, resolveStoredConfig } from '../core/config.js'
import { charCount } from '../core/context.js'

export const draftSchema = z.object({ id: z.string().min(1).max(300), text: z.string().min(1).max(64_000).refine(text => charCount(text) <= 32_000), createdAt: z.number().int().nonnegative() })
const sessionDraftsSchema = z.object({ version: z.literal(1), drafts: z.array(draftSchema).max(3) })

export function createDomainSpec(initial: AssistantConfig) {
  return defineDomain({
    name: 'input_assistant', version: 1, layout: 'per-record',
    global: { schema: z.object({ version: z.literal(1), settings: z.record(z.string(), z.unknown()) }), initial: { version: 1 as const, settings: { ...initial } } },
    tables: { drafts: domainTable<string, { version: 1; drafts: StoredDraft[] }>(sessionDraftsSchema) },
  })
}

export type AssistantDomain = Domain<ReturnType<typeof createDomainSpec>>

/** Serializes read-modify-write operations, including the very first save. */
export class AssistantStorage {
  private chain: Promise<void> = Promise.resolve()
  constructor(private readonly domain: () => Promise<AssistantDomain>) {}

  private transaction<T>(work: (domain: AssistantDomain) => Promise<T>): Promise<T> {
    const task = this.chain.then(async () => work(await this.domain()))
    this.chain = task.then(() => undefined, () => undefined)
    return task
  }

  async settings(): Promise<AssistantConfig> {
    const domain = await this.domain()
    // Stored records are read leniently: an older/newer build or a partially
    // written record must degrade individual fields, never lock every endpoint.
    return resolveStoredConfig(domain.global.get().settings)
  }

  updateSettings(patch: Partial<AssistantConfig>): Promise<AssistantConfig> {
    return this.transaction(async domain => {
      // The patch itself is strict (a caller typo must fail), while the base it
      // merges onto is read leniently so one unknown stored key cannot make the
      // plugin permanently unsavable.
      const settings = resolveConfig({ ...resolveStoredConfig(domain.global.get().settings), ...patch })
      await domain.global.set({ version: 1, settings })
      return settings
    })
  }

  async list(sessionId: string): Promise<StoredDraft[]> {
    return (await this.domain()).table('drafts').get(sessionId)?.drafts.map(draft => ({ ...draft })) ?? []
  }

  save(sessionId: string, text: string, replaceId?: string): Promise<StoredDraft[]> {
    if (text.trim().length === 0 || text.length > 64_000 || charCount(text) > 32_000) throw new AssistantError('DRAFT', '暂存内容为空或超过 32,000 字符')
    return this.transaction(async domain => {
      const drafts = [...(domain.table('drafts').get(sessionId)?.drafts ?? [])]
      const index = replaceId === undefined ? -1 : drafts.findIndex(draft => draft.id === replaceId)
      if (replaceId !== undefined && index < 0) throw new AssistantError('DRAFT_NOT_FOUND', '要替换的暂存草稿不存在，请刷新列表')
      if (drafts.length >= 3 && index < 0) throw new AssistantError('DRAFT_LIMIT', '当前会话已暂存三条，请选择替换或删除一条')
      const next = { id: replaceId ?? randomUUID(), text, createdAt: Date.now() }
      if (index < 0) drafts.push(next)
      else drafts[index] = next
      await domain.table('drafts').put(sessionId, { version: 1, drafts })
      return drafts.map(draft => ({ ...draft }))
    })
  }

  delete(sessionId: string, id?: string): Promise<StoredDraft[]> {
    return this.transaction(async domain => {
      const current = domain.table('drafts').get(sessionId)?.drafts ?? []
      const drafts = id === undefined ? [] : current.filter(draft => draft.id !== id)
      if (drafts.length === 0) await domain.table('drafts').delete(sessionId)
      else await domain.table('drafts').put(sessionId, { version: 1, drafts })
      return drafts.map(draft => ({ ...draft }))
    })
  }

  /** Undo deletion without overwriting drafts created or changed elsewhere. */
  restore(sessionId: string, deleted: readonly StoredDraft[]): Promise<StoredDraft[]> {
    const snapshots = z.array(draftSchema).max(3).parse(deleted)
    return this.transaction(async domain => {
      const drafts = [...(domain.table('drafts').get(sessionId)?.drafts ?? [])]
      const ids = new Set(drafts.map(draft => draft.id))
      for (const snapshot of snapshots) {
        if (!ids.has(snapshot.id)) { drafts.push(snapshot); ids.add(snapshot.id) }
      }
      if (drafts.length > 3) throw new AssistantError('DRAFT_LIMIT', '当前会话暂存空间不足，请删除一条后再撤销')
      if (drafts.length) await domain.table('drafts').put(sessionId, { version: 1, drafts })
      return drafts.map(draft => ({ ...draft }))
    })
  }
}
