// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserRuntime, type ConnectionFace } from '../src/browser/runtime'
import { AssistantStorage, type AssistantDomain } from '../src/host/storage'
import { DEFAULT_CONFIG } from '../src/core/types'

const runtimes: BrowserRuntime[] = []
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); document.body.innerHTML = ''; vi.useRealTimers() })

function fixture() {
  const records = new Map<string, unknown>()
  let global = { version: 1 as const, settings: { ...DEFAULT_CONFIG, nextEnabled: false, completionEnabled: false } }
  const domain = { global: { get: () => global, set: async (value: typeof global) => { global = value } }, table: () => ({
    get: (id: string) => records.get(id), put: async (id: string, value: unknown) => { records.set(id, structuredClone(value)) },
    delete: async (id: string) => records.delete(id),
  }) } as unknown as AssistantDomain
  const storage = new AssistantStorage(async () => domain)
  let deleteGate: Promise<void> | undefined, finishDelete: (() => void) | undefined
  const connection: ConnectionFace = { generation: { getSnapshot: () => ({ id: 1 }), subscribe: () => () => {} },
    rpc: { async call(_channel, _endpoint, envelope) {
      const { method, data } = (envelope as { args: { payload: { method: string; data: { sessionId: string; id?: string; drafts: Parameters<AssistantStorage['restore']>[1] } } } }).args.payload
      let value: unknown
      if (method === 'status') value = { sourceTurnId: '1', generation: 'host', running: false, settings: global.settings }
      else if (method === 'drafts/list') value = await storage.list(data.sessionId)
      else if (method === 'drafts/delete' || method === 'drafts/clear') {
        value = await storage.delete(data.sessionId, method === 'drafts/clear' ? undefined : data.id)
        if (deleteGate) await deleteGate
      } else if (method === 'drafts/restore') value = await storage.restore(data.sessionId, data.drafts)
      else value = {}
      return { ok: true, value }
    } },
  }
  const runtime = new BrowserRuntime(connection); runtimes.push(runtime)
  document.body.innerHTML = '<div data-composer-card><div data-composer-input tabindex="0">当前输入</div></div>'
  const editor = document.querySelector<HTMLElement>('[data-composer-input]')!
  async function open(sessionId: string) {
    const controller = runtime.controllerFor(sessionId)
    controller.bind({ sessionId, editor, running: false,
      input: { draft: '当前输入', draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [] },
      actions: { captureInsertion: () => ({ start: 4, end: 4, draftRev: 1 }), insertText: vi.fn() },
    })
    const release = runtime.retain(sessionId)
    await controller.refreshDrafts(); await flush()
    return { controller, release }
  }
  return { storage, runtime, open,
    delayDelete: () => { deleteGate = new Promise(resolve => { finishDelete = resolve }); return () => { finishDelete?.(); deleteGate = undefined } },
  }
}

describe('session undo ownership', () => {
  it('retains a deleted snapshot across navigation without extending its original deadline', async () => {
    vi.useFakeTimers(); const f = fixture(), saved = await f.storage.save('a', '待找回的草稿')
    const first = await f.open('a'); await first.controller.clearDrafts(); first.release(); await flush()
    await vi.advanceTimersByTimeAsync(4000)
    const second = await f.open('a')
    expect(second.controller).not.toBe(first.controller)
    expect(second.controller.getSnapshot().deletedDrafts).toEqual(saved)
    second.release(); await flush(); await vi.advanceTimersByTimeAsync(6001)
    const third = await f.open('a')
    expect(third.controller.getSnapshot().deletedDrafts).toEqual([])
    expect(await f.storage.list('a')).toEqual([])
  })
  it('restores original identity after switching away and back', async () => {
    const f = fixture(), saved = await f.storage.save('a', '原文')
    const first = await f.open('a'); await first.controller.clearDrafts(); first.release(); await flush()
    const second = await f.open('a'); await second.controller.undoDeleteDrafts()
    expect(await f.storage.list('a')).toEqual(saved)
    expect(second.controller.getSnapshot().deletedDrafts).toEqual([])
  })
  it('keeps the failed restore target when deleting another draft to make room', async () => {
    const f = fixture(), saved = await f.storage.save('a', 'A')
    const active = await f.open('a'); await active.controller.clearDrafts()
    const others = await f.storage.save('a', 'D'); await f.storage.save('a', 'E'); await f.storage.save('a', 'F')
    await active.controller.undoDeleteDrafts()
    expect(active.controller.getSnapshot().pendingUndoDrafts).toEqual(saved)
    await active.controller.deleteDraft(others[0].id)
    expect(active.controller.getSnapshot().pendingUndoDrafts).toEqual(saved)
    active.release(); await flush()
    const returned = await f.open('a'); await returned.controller.undoDeleteDrafts('pending')
    expect((await f.storage.list('a')).map(draft => draft.text)).toEqual(['E', 'F', 'A'])
    expect(returned.controller.getSnapshot().pendingUndoDrafts).toEqual([])
    expect(returned.controller.getSnapshot().deletedDrafts[0].text).toBe('D')
  })
  it('preserves the delete reply when navigation happens before it arrives', async () => {
    const f = fixture(), saved = await f.storage.save('a', '慢请求草稿')
    const first = await f.open('a'), finish = f.delayDelete()
    const deletion = first.controller.clearDrafts(); first.release(); await flush()
    first.controller.cancelOperation()
    expect(first.controller.getSnapshot()).toMatchObject({ busy: 'stash', stashClearPending: false, stashClearCancelled: false })
    finish(); await deletion; await flush()
    const returned = await f.open('a')
    expect(returned.controller.getSnapshot().deletedDrafts).toEqual(saved)
    await returned.controller.undoDeleteDrafts()
    expect(await f.storage.list('a')).toEqual(saved)
  })
  it('does not overwrite either failed batch in a second capacity conflict', async () => {
    const f = fixture(); await f.storage.save('a', 'A')
    const active = await f.open('a'); await active.controller.clearDrafts()
    const d = (await f.storage.save('a', 'D'))[0]; const e = (await f.storage.save('a', 'E'))[1]
    await f.storage.save('a', 'F'); await active.controller.undoDeleteDrafts()
    await active.controller.deleteDraft(d.id); await f.storage.save('a', 'G')
    await active.controller.undoDeleteDrafts()
    expect(active.controller.getSnapshot().pendingUndoDrafts[0].text).toBe('A')
    expect(active.controller.getSnapshot().deletedDrafts[0].text).toBe('D')
    await active.controller.deleteDraft(e.id)
    expect((await f.storage.list('a')).map(draft => draft.text)).toEqual(['E', 'F', 'G'])
    expect(active.controller.getSnapshot().deletedDrafts[0].text).toBe('D')
    active.controller.discardPendingUndo()
    expect(active.controller.getSnapshot().pendingUndoDrafts[0].text).toBe('D')
    await active.controller.deleteDraft(e.id); await active.controller.undoDeleteDrafts('pending')
    expect((await f.storage.list('a')).map(draft => draft.text)).toEqual(['F', 'G', 'D'])
  })
})
