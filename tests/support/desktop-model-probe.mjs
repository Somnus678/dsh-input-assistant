/** Test-only, host-local model catalog and explicitly bounded auxiliary benchmark. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'input-assistant-model-probe'
export const inject = ['llm', 'sessions', 'storageDomain']
const cache = resolve(fileURLToPath(new URL('../../', import.meta.url)), '.test-runtime/benchmark')

export async function apply(ctx, config) {
  const reportPath = resolve(config.reportPath)
  assert(reportPath.startsWith(cache + sep), 'Report must stay inside benchmark cache')
  const report = { kind: config.mode, pid: process.pid, ppid: process.ppid,
    execPath: process.execPath, startedAt: new Date().toISOString(), generatedRequests: 0 }
  try {
    assert(['catalog', 'benchmark', 'cleanup'].includes(config.mode))
    if (config.mode === 'cleanup') {
      const target = '请解释缓存机制，不修改接口。验证🙂'
      const domain = ctx.storageDomain.get('input_assistant')
      assert(domain, 'Production private domain must already be open')
      const table = domain.table('drafts')
      let deleted = 0
      let touchedSessions = 0
      let unrelatedPreserved = true
      for (const sessionId of table.keys()) {
        const before = table.get(sessionId)
        if (!before.drafts.some(draft => draft.text === target)) continue
        const unrelated = before.drafts.filter(draft => draft.text !== target)
        // Atomic private-domain update rechecks current content at its queue
        // slot; it never clears a whole session or races a second delete.
        const after = await table.update(sessionId, current => ({ ...current,
          drafts: current.drafts.filter(draft => draft.text !== target) }))
        deleted += before.drafts.filter(draft => draft.text === target).length
        touchedSessions++
        unrelatedPreserved &&= unrelated.every(draft => after.drafts.some(next => JSON.stringify(next) === JSON.stringify(draft)))
      }
      const remainingMatches = [...table.entries()].reduce((count, [, record]) => count + record.drafts.filter(draft => draft.text === target).length, 0)
      report.cleanup = { deleted, touchedSessions, remainingMatches, unrelatedPreserved,
        method: 'storageDomain.get(input_assistant).table(drafts).update exact-text filter' }
      report.uiOptimizeUsage = 'unknown: no public request-usage history API was used'
      report.passed = remainingMatches === 0 && unrelatedPreserved
      report.finishedAt = new Date().toISOString()
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
      return
    }
    if (config.mode === 'benchmark') {
      await benchmark(ctx, config, report)
      report.finishedAt = new Date().toISOString()
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
      return
    }
    const providers = []
    for (const provider of ctx.llm.listProviders()) {
      const models = await ctx.llm.listModels(provider.id)
      providers.push({ id: provider.id, name: provider.name,
        models: models.map(model => ({ id: model.id, name: model.name })) })
    }
    report.providers = providers
    const targets = providers.flatMap(provider => provider.models
      .filter(model => /DeepSeek.?V4\.1.?Flash/i.test(model.name))
      .map(model => ({ provider: provider.id, model: model.id, name: model.name })))
    report.targets = []
    for (const target of targets) {
      const info = await ctx.llm.resolveModelInfo(target.provider, target.model, AbortSignal.timeout(15_000))
      report.targets.push({ ...target, reasoning: info.reasoning, context: info.context,
        defaultMaxTokens: info.defaultMaxTokens, inputModalities: info.inputModalities })
    }
    report.passed = true
  } catch (error) {
    report.passed = false
    report.error = { name: error?.name ?? 'Error', code: error?.code ?? 'PROBE_FAILED',
      message: error?.name === 'AssertionError' ? String(error.message).slice(0, 800) : 'Model metadata probe did not complete.' }
  }
  report.finishedAt = new Date().toISOString()
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
}

async function benchmark(ctx, config, report) {
  const planPath = resolve(config.planPath)
  assert(planPath.startsWith(cache + sep), 'Only an explicit workspace benchmark plan is accepted')
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  assert.equal(plan.version, 1)
  assert.equal(plan.requests.length, 6)
  assert.equal(plan.limits.maxRequests, 6)
  assert(plan.limits.maxTokensPerRequest > 0 && plan.limits.maxTokensPerRequest <= 256)
  assert(plan.limits.maxTotalInputTokens <= 8000)
  assert(plan.roughInputTokens < plan.limits.maxTotalInputTokens)
  assert.equal(plan.route.provider, 'deepseek-account')
  assert.equal(plan.route.model, 'deepseek-flash')
  const core = await import(plan.coreUrl)
  const session = ctx.sessions.prepare(`input-assistant-benchmark-${randomUUID()}`)
  const detach = ctx.sessions.enter(session)
  const beforeSeq = session.seq
  const controller = new AbortController()
  ctx.effect(() => () => controller.abort(new Error('Benchmark plugin unloaded')))
  report.route = plan.route
  report.limits = plan.limits
  report.adaptations = plan.adaptations
  report.results = []
  report.inputTokens = 0
  report.outputTokens = 0
  report.peerCreated = false
  report.agentCreated = false
  const progressPath = resolve(dirname(config.reportPath), 'progress.json')
  try {
    for (const request of plan.requests) {
      assert(report.generatedRequests < 6)
      if (report.inputTokens >= plan.limits.maxTotalInputTokens) throw new Error('Input token budget reached')
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(plan.limits.timeoutMs)])
      const started = performance.now()
      const row = { id: request.id, operation: request.operation, implementation: request.implementation,
        source: request.source, system: request.system, input: request.input }
      const blocks = new Map()
      let finish
      let usage
      let firstTextMs
      const prepared = await ctx.llm.prepareCall({ ...plan.route, maxTokens: plan.limits.maxTokensPerRequest,
        temperature: plan.limits.temperature }, signal, (controls, info) => ({ ...controls,
        ...(info.reasoning?.efforts[0]?.id === undefined ? {} : { reasoningEffort: info.reasoning.efforts[0].id }) }))
      row.config = { ...prepared.config }
      report.generatedRequests++
      try {
        for await (const chunk of prepared.stream({ ...prepared.config, system: request.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: request.input }] }],
          tools: [], sessionId: session.id, signal })) {
          signal.throwIfAborted()
          if (chunk.type === 'text-delta') {
            firstTextMs ??= performance.now() - started
            blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
          } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
            blocks.set(chunk.index, chunk.block.text)
          } else if (chunk.type === 'usage') {
            usage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
              .filter(key => Number.isFinite(chunk.usage[key])).map(key => [key, chunk.usage[key]]))
          } else if (chunk.type === 'finish') {
            finish = { kind: chunk.reason.kind,
              ...(chunk.reason.failure ? { failureCode: chunk.reason.failure.code } : {}) }
          } else if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) {
            throw new Error('Auxiliary benchmark cannot execute tools')
          }
        }
        signal.throwIfAborted()
        row.rawText = [...blocks.values()].join('')
        row.finish = finish ?? { kind: 'missing' }
        if (finish?.kind === 'stop') {
          if (request.implementation === 'candidate') {
            try { row.visibleText = core.finishGeneration(row.rawText, request.prepared) }
            catch (error) { row.validationError = { code: error.code ?? 'OUTPUT' } }
          } else row.observedTrimmedText = row.rawText.trim()
        }
      } catch (error) {
        row.error = { name: error?.name ?? 'Error', code: error?.code ?? 'CALL_FAILED' }
      }
      row.elapsedMs = Math.round(performance.now() - started)
      row.firstTextMs = firstTextMs === undefined ? null : Math.round(firstTextMs)
      row.usage = usage ?? null
      row.inputTokens = usage ? usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) : null
      report.inputTokens += row.inputTokens ?? 0
      report.outputTokens += usage?.outputTokens ?? 0
      report.results.push(row)
      await writeFile(progressPath, JSON.stringify({ completed: report.results.length, generatedRequests: report.generatedRequests,
        inputTokens: report.inputTokens, outputTokens: report.outputTokens, latest: { id: row.id, elapsedMs: row.elapsedMs,
          finish: row.finish, error: row.error, usage: row.usage } }, null, 2) + '\n')
      if (row.error || ['error', 'aborted'].includes(row.finish?.kind)) break
    }
    report.passed = report.results.length === 6 && report.results.every(row => !row.error && row.finish?.kind === 'stop')
  } finally {
    report.noSessionEvents = session.seq === beforeSeq
    detach()
    report.cleaned = ctx.sessions.get(session.id) === undefined
    report.passed &&= report.noSessionEvents && report.cleaned
  }
}
