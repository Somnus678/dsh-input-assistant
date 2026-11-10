import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { resolveConfig } from '../core/config.js'
import { DEFAULT_CONFIG, type AssistantConfig } from '../core/types.js'
import type { AssistantModelCatalog } from '../core/models.js'
import type { BrowserRuntime } from './runtime.js'

type SettingsProps = PropsRuntime<'settings.section'> & { runtime: BrowserRuntime }
const NUMBERS = [
  ['debounceMs', '续写停顿', '毫秒', 200, 5000, 50],
  ['minIntervalMs', '续写请求最小间隔', '毫秒', 500, 30000, 100],
  ['maxHistoryChars', '会话上下文上限', '字符', 1000, 64000, 500],
  ['maxDraftChars', '待处理草稿上限', '字符', 100, 32000, 100],
  ['maxNextChars', '下一句长度上限', '字符', 20, 1000, 10],
  ['maxCompletionChars', '续写长度上限', '字符', 10, 500, 5],
  ['optimizeTimeoutMs', '优化超时', '毫秒', 1000, 120000, 1000],
  ['suggestionTimeoutMs', '自动建议超时', '毫秒', 1000, 60000, 500],
] as const
const PRESETS: { name: string; description: string; values: Partial<AssistantConfig> }[] = [
  { name: '敏捷模式', description: '更短停顿与精简预测，适合快速输入。', values: {
    debounceMs: 300, minIntervalMs: 1000, optimizationStrength: 'light', predictionDetail: 'concise', maxNextChars: 60, maxCompletionChars: 40,
  } },
  { name: '标准平衡', description: '平衡响应时机与模型用量，适合日常对话。', values: {
    debounceMs: 600, minIntervalMs: 2000, optimizationStrength: 'standard', predictionDetail: 'standard', maxNextChars: 120, maxCompletionChars: 80,
  } },
  { name: '节流省流', description: '延长停顿与请求间隔，减少自动请求。', values: {
    debounceMs: 1500, minIntervalMs: 5000, optimizationStrength: 'standard', predictionDetail: 'concise', maxNextChars: 80, maxCompletionChars: 40,
  } },
]
const formatValue = (value: number, unit: string): string => Number.isNaN(value) ? '未填写'
  : unit === '毫秒' && value >= 1000 ? `约 ${Number((value / 1000).toFixed(1))} 秒` : `${value} ${unit}`

/** A root-scoped DSH settings section; works even when no composer is mounted. */
export function AssistantSettings({ runtime }: SettingsProps) {
  const fieldsId = useId()
  const generation = useSyncExternalStore(runtime.connection.generation.subscribe.bind(runtime.connection.generation),
    () => runtime.transport.generation(), () => null)
  const [accepted, setAccepted] = useState<AssistantConfig | null>(null)
  const [form, setForm] = useState<AssistantConfig>({ ...DEFAULT_CONFIG })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [catalog, setCatalog] = useState<AssistantModelCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [catalogReload, setCatalogReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true); setLoadFailed(false); setAccepted(null); setError(''); setMessage('')
    if (generation === null) { setLoading(false); setLoadFailed(true); setError('连接已断开，请重连后加载设置'); return () => abort.abort() }
    void runtime.transport.call<AssistantConfig>('settings/get', {}, abort.signal).then(settings => {
      if (abort.signal.aborted) return
      const normalized = resolveConfig(settings)
      setAccepted(normalized); setForm(normalized); setLoading(false)
    }).catch(reason => { if (!abort.signal.aborted) { setLoading(false); setLoadFailed(true); setError(reason instanceof Error ? reason.message : '设置加载失败') } })
    return () => abort.abort()
  }, [runtime, generation, reload])
  useEffect(() => {
    const abort = new AbortController()
    setCatalog(null); setCatalogError('')
    if (generation === null) { setCatalogLoading(false); return () => abort.abort() }
    setCatalogLoading(true)
    void runtime.transport.call<AssistantModelCatalog>('models/list', {}, abort.signal).then(value => {
      if (!abort.signal.aborted) { setCatalog(value); setCatalogLoading(false) }
    }).catch(reason => {
      if (!abort.signal.aborted) { setCatalogLoading(false); setCatalogError(reason instanceof Error ? reason.message : '模型目录加载失败，请重试或手动填写') }
    })
    return () => abort.abort()
  }, [runtime, generation, catalogReload])
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
  const selection = form.provider || form.model ? JSON.stringify([form.provider, form.model]) : ''
  const available = catalog?.groups.some(group => group.provider === form.provider && group.models.some(model => model.id === form.model)) ?? false
  return <form className="dsh-ia dsh-ia-settings" aria-label="输入助手设置" onSubmit={event => { void save(event) }}>
    <h2>输入助手</h2>
    <p className="dsh-ia-muted">以下为全局设置，对所有会话生效。各功能独立开关，采纳内容后仍由你发送。</p>
    {loading && <p role="status">正在加载设置…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {loadFailed && <button type="button" disabled={loading || generation === null} onClick={() => setReload(value => value + 1)}>重新加载</button>}
    <fieldset disabled={loading || saving || generation === null || !accepted}>
      <section className="dsh-ia-section">
        <h3>预设档位</h3>
        <p className="dsh-ia-muted">预设只修改下方表单，点击保存后才对所有会话生效；不会立即调用模型。</p>
        <div className="dsh-ia-settings-presets">{PRESETS.map(preset => <button key={preset.name} type="button" className="dsh-ia-preset" aria-label={preset.name}
          aria-pressed={Object.entries(preset.values).every(([key, value]) => form[key as keyof AssistantConfig] === value)}
          onClick={() => { setForm(previous => ({ ...previous, ...preset.values })); setMessage(`已套用「${preset.name}」，保存后生效`); setError('') }}>
          <strong>{preset.name}</strong><span className="dsh-ia-muted">{preset.description}</span></button>)}</div>
      </section>
      <section className="dsh-ia-section">
        <h3>功能开关</h3>
        <div className="dsh-ia-settings-toggles">
          <label><input type="checkbox" checked={form.optimizeEnabled} onChange={event => change('optimizeEnabled', event.target.checked)} />提示词优化</label>
          <label><input type="checkbox" checked={form.nextEnabled} onChange={event => change('nextEnabled', event.target.checked)} />回复后预测</label>
          <label><input type="checkbox" checked={form.completionEnabled} onChange={event => change('completionEnabled', event.target.checked)} />输入续写</label>
          <label><input type="checkbox" checked={form.stashEnabled} onChange={event => change('stashEnabled', event.target.checked)} />草稿暂存</label>
        </div>
        <p className="dsh-ia-muted">关闭暂存后仍可查看和删除历史草稿；已有优化改动仍可查看和还原。</p>
        <p className="dsh-ia-muted">回复后预测与输入续写开启后会自动调用模型，消耗模型用量。</p>
      </section>
      <section className="dsh-ia-section">
        <h3>优化与建议</h3>
        <label className="dsh-ia-field">优化强度<select value={form.optimizationStrength} onChange={event => change('optimizationStrength', event.target.value as AssistantConfig['optimizationStrength'])}>
          <option value="light">轻度润色</option><option value="standard">标准优化</option><option value="deep">深度梳理</option>
        </select></label>
        <p className="dsh-ia-muted">轻度润色只修正表达；标准优化整理目标与约束；深度梳理可重组结构。各档位均要求保留原意，不新增任务或授权；先预览差异，采纳后才写入草稿。</p>
        <label className="dsh-ia-field">预测详略度<select aria-label="预测详略度" value={form.predictionDetail} onChange={event => change('predictionDetail', event.target.value as AssistantConfig['predictionDetail'])}>
          <option value="concise">简明</option><option value="standard">标准</option><option value="detailed">详尽</option>
        </select></label>
        <p className="dsh-ia-muted">简明侧重短句，标准提供自然衔接，详尽允许多行结构并以候选面板完整展示。各档均遵守你设置的长度上限。</p>
        <label className="dsh-ia-field">建议显示方式<select value={form.displayMode} onChange={event => change('displayMode', event.target.value as AssistantConfig['displayMode'])}>
          <option value="ghost">灰字</option><option value="panel">候选面板</option>
        </select></label>
      </section>
      <section className="dsh-ia-section">
        <h3>辅助模型</h3>
        <p className="dsh-ia-muted">仅设置输入助手使用的模型，不改变主会话模型。辅助调用单独消耗模型用量。</p>
        <label className="dsh-ia-field">辅助模型选择<select aria-label="辅助模型选择" value={selection} onChange={event => {
          const [provider, model] = event.target.value ? JSON.parse(event.target.value) as [string, string] : ['', '']
          setForm(previous => ({ ...previous, provider, model })); setMessage(''); setError('')
        }}>
          <option value="">跟随输入框模型</option>
          {selection && !available && <option value={selection}>{catalog ? '当前手动选择／目录未列出' : '当前选择／目录尚未确认'}：{form.provider || '未填提供商'} / {form.model || '未填模型'}</option>}
          {catalog?.groups.map(group => <optgroup key={group.provider} label={group.name}>
            {group.models.map(model => <option key={model.id} value={JSON.stringify([group.provider, model.id])}>{model.name}</option>)}
          </optgroup>)}
        </select></label>
        {catalogLoading && <p role="status">正在加载模型目录…</p>}
        {catalogError && <p role="status">模型目录：{catalogError}</p>}
        {catalog && catalog.groups.length === 0 && <p className="dsh-ia-muted">宿主暂无可用模型；可刷新目录或手动填写。</p>}
        {catalog && catalog.failures.length > 0 && <p role="status">部分提供商目录加载失败：{catalog.failures.map(item => item.name).join('、')}。已加载模型仍可选择。</p>}
        <button type="button" disabled={catalogLoading || generation === null} onClick={() => setCatalogReload(value => value + 1)}>刷新模型列表</button>
        <details>
          <summary>手动填写模型 ID</summary>
          <p className="dsh-ia-muted">目录暂时不可用或使用自定义模型时，可填写提供商与模型 ID；两项同时留空则跟随输入框。</p>
          <label className="dsh-ia-field">提供商<input value={form.provider} onChange={event => change('provider', event.target.value)} placeholder="跟随输入框" maxLength={200} autoComplete="off" /></label>
          <label className="dsh-ia-field">模型<input value={form.model} onChange={event => change('model', event.target.value)} placeholder="跟随输入框" maxLength={200} autoComplete="off" /></label>
        </details>
      </section>
      <details className="dsh-ia-section"><summary>高级设置</summary>
        <p className="dsh-ia-muted">滑块用于快速调整，数值框支持精确整数输入。</p>
        <div className="dsh-ia-setting-grid">{NUMBERS.map(([key, label, unit, min, max, step]) => <div key={key} className="dsh-ia-field">
          <div className="dsh-ia-setting-heading"><label htmlFor={`${fieldsId}-${key}`}>{label}（{unit}）</label><span className="dsh-ia-muted">{formatValue(form[key], unit)}</span></div>
          <div className="dsh-ia-number-control"><input id={`${fieldsId}-${key}`} type="number" aria-label={`${label}（${unit}）`} value={Number.isNaN(form[key]) ? '' : form[key]} min={min} max={max} step={1} required
            onChange={event => change(key, event.target.value === '' ? NaN : Number(event.target.value))} />
            <input type="range" tabIndex={-1} aria-hidden="true" min={min} max={max} step={step}
              value={Number.isNaN(form[key]) ? min : Math.min(max, min + Math.round((form[key] - min) / step) * step)}
              onChange={event => change(key, Number(event.target.value))} /></div>
          <span className="dsh-ia-muted">{min.toLocaleString()}–{max.toLocaleString()} {unit}</span>
        </div>)}</div>
      </details>
      <div className="dsh-ia-row"><button type="submit" disabled={!changed}>{saving ? '保存中…' : '保存设置'}</button>
        <button type="button" disabled={!changed} onClick={() => { if (accepted) setForm(accepted); setError(''); setMessage('已放弃未保存的修改') }}>放弃修改</button>
        {changed && <span className="dsh-ia-muted">有未保存的修改</span>}
      </div>
    </fieldset>
  </form>
}
