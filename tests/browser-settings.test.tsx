// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantSettings } from '../src/browser/settings'
import { BrowserRuntime, type ConnectionFace } from '../src/browser/runtime'
import { DEFAULT_CONFIG, type AssistantConfig, type GenerationRequest } from '../src/core/types'

const runtimes: BrowserRuntime[] = []
afterEach(() => { cleanup(); runtimes.splice(0).forEach(runtime => runtime.dispose()); document.body.innerHTML = '' })

function settingsFixture(failInitialLoad = false, initial: Partial<AssistantConfig> = {}, failCatalog = false) {
  let settings: AssistantConfig = { ...DEFAULT_CONFIG, nextEnabled: false, completionEnabled: false, ...initial }
  let failure = false
  let generation = { id: 1 }
  let finishSave: ((value: unknown) => void) | undefined
  let delayed = false
  const setters: Partial<AssistantConfig>[] = []
  const generates: { request: GenerationRequest; signal?: AbortSignal; resolve: (value: { ok: true; value: unknown }) => void }[] = []
  const connection: ConnectionFace = {
    generation: { getSnapshot: () => generation, subscribe: () => () => {} },
    rpc: { call: vi.fn(async (_channel, _endpoint, envelope, signal) => {
      const { method, data } = (envelope as { args: { payload: { method: string; data: any } } }).args.payload
      if (method === 'settings/get') {
        if (failInitialLoad) { failInitialLoad = false; return { ok: false as const, error: { message: '存储暂时无法打开' } } }
        return { ok: true as const, value: settings }
      }
      if (method === 'models/list') {
        if (failCatalog) return { ok: false as const, error: { message: '目录连接暂时不可用' } }
        return { ok: true as const, value: {
          groups: [{ provider: 'local', name: '本地提供商', models: [{ id: 'small', name: '快速小模型' }] }],
          failures: [{ provider: 'offline', name: '暂时离线提供商' }],
        } }
      }
      if (method === 'settings/set') {
        setters.push(data)
        if (failure) return { ok: false as const, error: { message: '连接响应丢失' } }
        if (delayed) await new Promise(resolve => { finishSave = resolve })
        settings = { ...settings, ...data }; return { ok: true as const, value: settings }
      }
      if (method === 'status') return { ok: true as const, value: { settings, sourceTurnId: null, generation: 'mount', running: false, route: { provider: 'mock', model: 'fast' } } }
      if (method === 'generate') return new Promise<{ ok: true; value: unknown }>(resolve => generates.push({ request: data, signal, resolve }))
      if (method === 'cancel') return { ok: true as const, value: {} }
      if (method === 'drafts/list') return { ok: true as const, value: [] }
      throw new Error(`Unexpected ${method}`)
    }) },
  }
  const runtime = new BrowserRuntime(connection); runtimes.push(runtime)
  render(<AssistantSettings {...{ runtime, close() {} } as ComponentProps<typeof AssistantSettings>} />)
  return { runtime, setters, generates, settings: () => settings, fail: () => { failure = true }, delay: () => { delayed = true },
    finish: () => finishSave?.({}), reconnect: () => { generation = { id: generation.id + 1 } }, recoverCatalog: () => { failCatalog = false } }
}

describe('DSH input assistant settings section', () => {
  it('applies a preset to the form only and saves its global values after review', async () => {
    const f = settingsFixture()
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '敏捷模式' }))
    expect((screen.getByLabelText('预测详略度') as HTMLSelectElement).value).toBe('concise')
    expect((screen.getByLabelText('续写停顿（毫秒）') as HTMLInputElement).value).toBe('300')
    expect(f.setters).toHaveLength(0)
    expect(f.generates).toHaveLength(0)
    expect(f.settings().predictionDetail).toBe('standard')
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.setters).toEqual([{ debounceMs: 300, minIntervalMs: 1000, optimizationStrength: 'light', predictionDetail: 'concise', maxNextChars: 60, maxCompletionChars: 40 }])
    expect(f.generates).toHaveLength(0)
  })
  it('keeps valid expanded prediction limits editable without changing numeric precision', async () => {
    const f = settingsFixture(false, { maxNextChars: 800, maxCompletionChars: 450, debounceMs: 601 })
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    const next = screen.getByLabelText('下一句长度上限（字符）') as HTMLInputElement
    const completion = screen.getByLabelText('续写长度上限（字符）') as HTMLInputElement
    const debounce = screen.getByLabelText('续写停顿（毫秒）') as HTMLInputElement
    expect(next.max).toBe('1000'); expect(completion.max).toBe('500')
    expect(next.validity.valid).toBe(true); expect(completion.validity.valid).toBe(true); expect(debounce.validity.valid).toBe(true)
    fireEvent.change(screen.getByLabelText('预测详略度'), { target: { value: 'detailed' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.setters).toEqual([{ predictionDetail: 'detailed' }])
    expect(f.settings()).toMatchObject({ maxNextChars: 800, maxCompletionChars: 450, debounceMs: 601 })
  })
  it('can discard an unsaved preset without changing global settings or making a generation', async () => {
    const f = settingsFixture()
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '节流省流' }))
    expect((screen.getByLabelText('续写请求最小间隔（毫秒）') as HTMLInputElement).value).toBe('5000')
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect((screen.getByLabelText('续写请求最小间隔（毫秒）') as HTMLInputElement).value).toBe('2000')
    expect(f.setters).toHaveLength(0); expect(f.generates).toHaveLength(0)
  })
  it('loads grouped auxiliary choices without a session and saves only after review', async () => {
    const f = settingsFixture()
    await screen.findByRole('option', { name: '快速小模型' })
    expect(screen.getByText(/部分提供商目录加载失败/).textContent).toContain('暂时离线提供商')
    fireEvent.change(screen.getByLabelText('辅助模型选择'), { target: { value: JSON.stringify(['local', 'small']) } })
    expect(f.setters).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.setters).toEqual([{ provider: 'local', model: 'small' }])
    const controller = f.runtime.controllerFor('a'); await controller.refresh()
    expect(controller.getSnapshot().status?.route).toEqual({ provider: 'mock', model: 'fast' })
    expect(controller.getSnapshot().settings).toMatchObject({ provider: 'local', model: 'small' })
  })
  it('preserves an unavailable saved model until the user explicitly chooses another route', async () => {
    const f = settingsFixture(false, { provider: 'old-provider', model: 'old-model' })
    const option = await screen.findByRole('option', { name: /当前手动选择／目录未列出：old-provider \/ old-model/ })
    expect((screen.getByLabelText('辅助模型选择') as HTMLSelectElement).value).toBe(option.getAttribute('value'))
    expect(f.settings()).toMatchObject({ provider: 'old-provider', model: 'old-model' })
    fireEvent.change(screen.getByLabelText('辅助模型选择'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.setters).toEqual([{ provider: '', model: '' }])
  })
  it('keeps manual settings editable when the catalog fails and can reload it', async () => {
    const f = settingsFixture(false, {}, true)
    await screen.findByText('模型目录：目录连接暂时不可用')
    fireEvent.change(screen.getByLabelText('提供商'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'private-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.settings()).toMatchObject({ provider: 'custom', model: 'private-model' })
    f.recoverCatalog(); fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }))
    await screen.findByRole('option', { name: '快速小模型' })
    expect(screen.queryByText('模型目录：目录连接暂时不可用')).toBeNull()
    expect(f.settings()).toMatchObject({ provider: 'custom', model: 'private-model' })
  })
  it('retries a failed initial settings load without requiring the page to close', async () => {
    settingsFixture(true)
    expect((await screen.findByRole('alert')).textContent).toContain('存储暂时无法打开')
    expect(screen.getByLabelText('提示词优化').closest('fieldset')?.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(screen.getByLabelText('提示词优化').closest('fieldset')?.disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull()
  })
  it('does not overwrite another switch changed after the settings page was opened', async () => {
    const f = settingsFixture()
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    await f.runtime.saveSettings({ completionEnabled: true })
    fireEvent.change(screen.getByLabelText('优化强度'), { target: { value: 'deep' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.setters[1]).toEqual({ optimizationStrength: 'deep' })
    expect(f.settings().completionEnabled).toBe(true)
    expect((screen.getByLabelText('输入续写') as HTMLInputElement).checked).toBe(true)
  })
  it('serializes settings writes and broadcasts the combined accepted result', async () => {
    const f = settingsFixture(), controller = f.runtime.controllerFor('a')
    await controller.refresh(); f.delay()
    const first = f.runtime.saveSettings({ nextEnabled: true })
    const second = f.runtime.saveSettings({ completionEnabled: true })
    expect(controller.getSnapshot().settingsSaving).toBe(true)
    await waitFor(() => expect(f.setters).toHaveLength(1))
    expect(f.setters[0]).toEqual({ nextEnabled: true })
    f.finish(); await first
    await waitFor(() => expect(f.setters).toHaveLength(2))
    expect(controller.getSnapshot().settingsSaving).toBe(true)
    f.finish(); await second
    expect(controller.getSnapshot().settings.nextEnabled).toBe(true)
    expect(controller.getSnapshot().settings.completionEnabled).toBe(true)
    expect(controller.getSnapshot().settingsSaving).toBe(false)
  })
  it('does not send a queued setting on a newer connection', async () => {
    const f = settingsFixture(); f.delay()
    const first = f.runtime.saveSettings({ nextEnabled: true })
    const second = f.runtime.saveSettings({ completionEnabled: true })
    const firstRejected = expect(first).rejects.toThrow('连接已变化')
    const secondRejected = expect(second).rejects.toThrow('连接已变化')
    await waitFor(() => expect(f.setters).toHaveLength(1))
    f.reconnect(); f.finish()
    await firstRejected; await secondRejected
    expect(f.setters).toHaveLength(1)
  })
  it('saves independent switches, strength and advanced limits through one reviewed update', async () => {
    const f = settingsFixture()
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    fireEvent.click(screen.getByLabelText('提示词优化'))
    fireEvent.click(screen.getByLabelText('草稿暂存'))
    fireEvent.change(screen.getByLabelText('优化强度'), { target: { value: 'deep' } })
    fireEvent.change(screen.getByLabelText('续写请求最小间隔（毫秒）'), { target: { value: '4000' } })
    expect(f.setters).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已保存并生效')
    expect(f.setters).toEqual([{ optimizeEnabled: false, stashEnabled: false, optimizationStrength: 'deep', minIntervalMs: 4000 }])
    expect(f.settings().optimizationStrength).toBe('deep')
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('keeps unconfirmed form values and does not broadcast a failed save as active settings', async () => {
    const f = settingsFixture(), controller = f.runtime.controllerFor('a')
    await controller.refresh()
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    f.fail()
    fireEvent.change(screen.getByLabelText('优化强度'), { target: { value: 'light' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('保存未确认')
    expect(controller.getSnapshot().settings.optimizationStrength).toBe('standard')
    expect((screen.getByLabelText('优化强度') as HTMLSelectElement).value).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect((screen.getByLabelText('优化强度') as HTMLSelectElement).value).toBe('standard')
  })
  it('cancels an old optimization before saving and rejects a reconnect response', async () => {
    const f = settingsFixture(), controller = f.runtime.controllerFor('a')
    const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.tabIndex = 0; editor.textContent = '原稿'; document.body.append(editor)
    const insertText = vi.fn(() => true)
    controller.bind({ sessionId: 'a', running: false, editor,
      input: { draft: '原稿', draftRev: 1, phase: 'plain', occurrences: [], attachmentIds: [] },
      actions: { captureInsertion: () => ({ start: 2, end: 2, draftRev: 1 }), insertText } })
    await controller.refresh()
    const old = controller.optimize()
    expect(f.generates).toHaveLength(1)
    f.delay()
    const saving = f.runtime.saveSettings({ optimizeEnabled: false })
    expect(f.generates[0].signal?.aborted).toBe(true)
    await Promise.resolve()
    const newController = f.runtime.controllerFor('b'); await newController.refresh()
    f.reconnect(); f.finish()
    await expect(saving).rejects.toThrow('连接已变化')
    await act(async () => { f.generates[0].resolve({ ok: true, value: { ...f.generates[0].request, text: '迟到结果' } }); await old })
    expect(insertText).not.toHaveBeenCalled()
    expect(controller.getSnapshot().settings.optimizeEnabled).toBe(true)
  })
  it('validates blank and out-of-range advanced values without requesting a save', async () => {
    const f = settingsFixture()
    await waitFor(() => expect(screen.queryByText('正在加载设置…')).toBeNull())
    fireEvent.change(screen.getByLabelText('续写停顿（毫秒）'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('form', { name: '输入助手设置' }))
    await screen.findByRole('alert')
    expect(f.setters).toHaveLength(0)
  })
})
