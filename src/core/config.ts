import { AssistantError, DEFAULT_CONFIG, type AssistantConfig } from './types'

const numeric: Record<string, [number, number]> = {
  debounceMs: [200, 5000], minIntervalMs: [500, 30000], maxHistoryChars: [1000, 64000],
  maxDraftChars: [100, 32000], maxNextChars: [20, 300], maxCompletionChars: [10, 200],
  optimizeTimeoutMs: [1000, 120000], suggestionTimeoutMs: [1000, 60000],
}
const booleans = ['optimizeEnabled', 'stashEnabled', 'nextEnabled', 'completionEnabled'] as const
const strings = ['provider', 'model'] as const

/** Validate one already-merged config object; throws with the first problem found. */
function validate(config: AssistantConfig): AssistantConfig {
  for (const key of booleans) {
    if (typeof config[key] !== 'boolean') throw new AssistantError('CONFIG', `${key} 必须是布尔值`)
  }
  if (!['ghost', 'panel'].includes(config.displayMode)) throw new AssistantError('CONFIG', '显示方式必须是 ghost 或 panel')
  if (!['light', 'standard', 'deep'].includes(config.optimizationStrength)) throw new AssistantError('CONFIG', '优化强度必须是 light、standard 或 deep')
  for (const [key, [min, max]] of Object.entries(numeric)) {
    const value = config[key as keyof AssistantConfig]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new AssistantError('CONFIG', `${key} 必须是 ${min} 到 ${max} 之间的整数`)
    }
  }
  for (const key of strings) {
    if (typeof config[key] !== 'string' || config[key].length > 200) throw new AssistantError('CONFIG', `${key} 无效`)
    config[key] = config[key].trim()
  }
  if (Boolean(config.provider) !== Boolean(config.model)) throw new AssistantError('CONFIG', '固定辅助模型需同时填写提供商和模型；留空则跟随输入框')
  return config
}

/**
 * Strict resolution for author-supplied input: the plugin's own Cordis config and
 * every `settings/set` patch. Unknown keys are a caller mistake and must fail loudly
 * rather than be silently dropped from a partial update.
 */
export function resolveConfig(input: Partial<AssistantConfig> = {}): AssistantConfig {
  for (const key of Object.keys(input)) if (!(key in DEFAULT_CONFIG)) throw new AssistantError('CONFIG', `未知配置：${key}`)
  return validate({ ...DEFAULT_CONFIG, ...input })
}

/**
 * Lenient resolution for settings already on disk.
 *
 * Stored settings outlive the code that wrote them: a downgrade, a newer build
 * that added a key, or a partially-written record must never make the plugin
 * unusable. Unknown keys are ignored and unusable values fall back to their
 * default, so a bad record degrades one setting instead of locking every
 * endpoint. The next successful `settings/set` rewrites a clean record.
 */
export function resolveStoredConfig(input: unknown): AssistantConfig {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const config: Record<string, unknown> = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AssistantConfig)[]) {
    if (!(key in record)) continue
    const value = record[key]
    const candidate = { ...DEFAULT_CONFIG, [key]: value } as AssistantConfig
    try { validate({ ...candidate }) } catch { continue }
    config[key] = typeof value === 'string' ? value.trim() : value
  }
  // `provider`/`model` are only valid as a pair; a half-filled pair falls back to follow-the-composer.
  if (Boolean(config.provider) !== Boolean(config.model)) { config.provider = ''; config.model = '' }
  return config as unknown as AssistantConfig
}
