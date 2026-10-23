import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { resolveConfig } from '../core/config'
import { DEFAULT_CONFIG, type AssistantConfig } from '../core/types'
import type { BrowserRuntime } from './runtime'

type SettingsProps = PropsRuntime<'settings.section'> & { runtime: BrowserRuntime }
const NUMBERS = [
  ['debounceMs', '续写停顿', '毫秒', 200, 5000],
  ['minIntervalMs', '续写请求最小间隔', '毫秒', 500, 30000],
  ['maxHistoryChars', '会话上下文上限', '字符', 1000, 64000],
  ['maxDraftChars', '待处理草稿上限', '字符', 100, 32000],
  ['maxNextChars', '下一句长度上限', '字符', 20, 300],
  ['maxCompletionChars', '续写长度上限', '字符', 10, 200],
  ['optimizeTimeoutMs', '优化超时', '毫秒', 1000, 120000],
  ['suggestionTimeoutMs', '自动建议超时', '毫秒', 1000, 60000],
] as const

/** A root-scoped DSH settings section; works even when no composer is mounted. */
export function AssistantSettings({ runtime }: SettingsProps) {
  const generation = useSyncExternalStore(runtime.connection.generation.subscribe.bind(runtime.connection.generation),
    () => runtime.transport.generation(), () => null)
  const [accepted, setAccepted] = useState<AssistantConfig | null>(null)
  const [form, setForm] = useState<AssistantConfig>({ ...DEFAULT_CONFIG })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true); setError(''); setMessage('')
    if (generation === null) { setLoading(false); setError('连接已断开，请重连后加载设置'); return () => abort.abort() }
    void runtime.transport.call<AssistantConfig>('settings/get', {}, abort.signal).then(settings => {
      if (abort.signal.aborted) return
      const normalized = resolveConfig(settings)
      setAccepted(normalized); setForm(normalized); setLoading(false)
    }).catch(reason => { if (!abort.signal.aborted) { setLoading(false); setError(reason instanceof Error ? reason.message : '设置加载失败') } })
    return () => abort.abort()
  }, [runtime, generation])
  const change = <K extends keyof AssistantConfig>(key: K, value: AssistantConfig[K]) => {
    setForm(previous => ({ ...previous, [key]: value })); setMessage(''); setError('')
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!accepted || saving || generation === null) return
    setError(''); setMessage('')
    let draft: AssistantConfig
    try { draft = resolveConfig(form) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '设置无效'); return }
    setSaving(true)
    try {
      const patch = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== accepted[key as keyof AssistantConfig])) as Partial<AssistantConfig>
      const settings = await runtime.saveSettings(patch)
      if (runtime.transport.generation() !== generation) return
      setAccepted(settings); setForm(settings); setMessage('设置已保存并生效')
    } catch (reason) { setError(`保存未确认：${reason instanceof Error ? reason.message : '请重试'}；请重新打开设置核对`) }
    finally { setSaving(false) }
  }
  const changed = accepted !== null && JSON.stringify(form) !== JSON.stringify(accepted)
  return <form className="dsh-ia dsh-ia-settings" aria-label="输入助手设置" onSubmit={event => { void save(event) }}>
    <h2>输入助手</h2>
    <p className="dsh-ia-muted">帮助你形成准确、可发送的输入。各功能独立开关，采纳内容后仍由你发送。</p>
    {loading && <p role="status">正在加载设置…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={loading || saving || generation === null || !accepted}>
      <section className="dsh-ia-section">
        <h3>功能开关</h3>
        <div className="dsh-ia-settings-toggles">
          <label><input type="checkbox" checked={form.optimizeEnabled} onChange={event => change('optimizeEnabled', event.target.checked)} />提示词优化</label>
          <label><input type="checkbox" checked={form.nextEnabled} onChange={event => change('nextEnabled', event.target.checked)} />回复后预测</label>
          <label><input type="checkbox" checked={form.completionEnabled} onChange={event => change('completionEnabled', event.target.checked)} />输入续写</label>
          <label><input type="checkbox" checked={form.stashEnabled} onChange={event => change('stashEnabled', event.target.checked)} />草稿暂存</label>
        </div>
        <p className="dsh-ia-muted">关闭暂存后仍可查看和删除历史草稿；已有优化改动仍可查看和还原。</p>
      </section>
      <section className="dsh-ia-section">
        <h3>优化与建议</h3>
        <label className="dsh-ia-field">优化强度<select value={form.optimizationStrength} onChange={event => change('optimizationStrength', event.target.value as AssistantConfig['optimizationStrength'])}>
          <option value="light">轻度润色</option><option value="standard">标准优化</option><option value="deep">深度梳理</option>
        </select></label>
        <p className="dsh-ia-muted">轻度润色只修正表达；标准优化整理目标与约束；深度梳理可重组结构。各档位均要求保留原意，不新增任务或授权；应用后可查看改动。</p>
        <label className="dsh-ia-field">建议显示方式<select value={form.displayMode} onChange={event => change('displayMode', event.target.value as AssistantConfig['displayMode'])}>
          <option value="ghost">灰字</option><option value="panel">候选面板</option>
        </select></label>
      </section>
      <section className="dsh-ia-section">
        <h3>辅助模型</h3>
        <p className="dsh-ia-muted">两项同时留空时跟随输入框模型。辅助调用单独消耗模型用量。</p>
        <label className="dsh-ia-field">提供商<input value={form.provider} onChange={event => change('provider', event.target.value)} placeholder="跟随输入框" maxLength={200} autoComplete="off" /></label>
        <label className="dsh-ia-field">模型<input value={form.model} onChange={event => change('model', event.target.value)} placeholder="跟随输入框" maxLength={200} autoComplete="off" /></label>
      </section>
      <details className="dsh-ia-section"><summary>高级设置</summary>
        {NUMBERS.map(([key, label, unit, min, max]) => <label key={key} className="dsh-ia-field">{label}（{unit}）
          <input type="number" aria-label={`${label}（${unit}）`} value={Number.isNaN(form[key]) ? '' : form[key]} min={min} max={max} step={1} required
            onChange={event => change(key, event.target.value === '' ? NaN : Number(event.target.value))} />
          <span className="dsh-ia-muted">{min.toLocaleString()}–{max.toLocaleString()} {unit}</span>
        </label>)}
      </details>
      <div className="dsh-ia-row"><button type="submit" disabled={!changed}>{saving ? '保存中…' : '保存设置'}</button>
        <button type="button" disabled={!changed} onClick={() => { if (accepted) setForm(accepted); setError(''); setMessage('已放弃未保存的修改') }}>放弃修改</button>
        {changed && <span className="dsh-ia-muted">有未保存的修改</span>}
      </div>
    </fieldset>
  </form>
}
