#!/usr/bin/env node
/** Offline, synthetic evaluation. This program never calls a model or reads credentials. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = Object.fromEntries(process.argv.slice(3).flatMap((arg, index, all) =>
  arg.startsWith('--') ? [[arg.slice(2), all[index + 1]?.startsWith('--') ? true : all[index + 1] ?? true]] : []))
const operations = ['optimize', 'next', 'complete']
const humanFields = ['intentAligned', 'noUnsupportedRequirements', 'naturalUserVoice', 'constraintsPreserved']
const countChars = value => Array.from(value).length

export async function loadCases(path = resolve(root, 'evaluation/cases.json')) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (value.schemaVersion !== 1 || !Array.isArray(value.cases)) throw new Error('Unsupported case-set schema')
  const ids = new Set()
  for (const item of value.cases) {
    if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or missing case id: ${item.id}`)
    ids.add(item.id)
    if (!operations.includes(item.operation) || !Array.isArray(item.history)
      || typeof item.draft !== 'string' || !['text', 'abstain'].includes(item.expect?.behavior)) {
      throw new Error(`Invalid case: ${item.id}`)
    }
  }
  return value.cases
}

async function readRecords(path) {
  if (!path || path === true) return new Map()
  const source = (await readFile(resolve(String(path)), 'utf8')).replace(/^\uFEFF/, '').trim()
  const values = source ? (source.startsWith('[') ? JSON.parse(source) : source.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch { throw new Error(`${path}:${index + 1}: invalid JSON`) }
  })) : []
  const map = new Map()
  for (const value of values) {
    if (!value || typeof value.id !== 'string' || map.has(value.id)) throw new Error(`Duplicate or invalid result id in ${path}: ${value?.id}`)
    map.set(value.id, value)
  }
  return map
}

async function write(path, value) {
  const target = resolve(String(path))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, value, 'utf8')
  return target
}

async function core() {
  try { return await import(pathToFileURL(resolve(root, 'lib/core.js')).href) }
  catch (error) {
    throw new Error(`Build the plugin first (pnpm build); lib/core.js could not be loaded: ${error.message}`)
  }
}

export function requestFor(item) {
  const span = item.operation === 'complete'
    ? { start: item.draft.length, end: item.draft.length, draftRev: 0 }
    : { start: 0, end: item.draft.length, draftRev: 0 }
  return {
    operation: item.operation, requestId: item.id, sessionId: `synthetic-${item.id}`,
    sourceTurnId: null, draft: item.draft, draftRev: 0, span,
    connectionGeneration: 'evaluation', routeKey: 'evaluation',
    ...(item.operation === 'optimize' ? { targetText: item.draft, lockedFragments: item.expect.protected ?? [] } : {}),
  }
}

export function checkOutput(item, text) {
  const failures = []
  if (text !== null && typeof text !== 'string') return { passed: false, abstained: false, failures: ['Output must be string or null'] }
  const abstained = text === null || text.trim().length === 0
  if (item.expect.behavior === 'abstain') {
    if (!abstained) failures.push('Expected abstention')
    return { passed: failures.length === 0, abstained, failures }
  }
  if (abstained) return { passed: false, abstained: true, failures: ['Expected a usable text result'] }
  const maximum = item.operation === 'next' ? 120 : item.operation === 'complete' ? 80 : Infinity
  if (countChars(text) > maximum) failures.push(`Output exceeds ${maximum} Unicode characters`)
  if (item.operation === 'next' && /[\r\n]/.test(text)) failures.push('Next-message suggestion must be one line')
  if (item.operation === 'complete' && item.draft && text.startsWith(item.draft)) failures.push('Completion repeats the existing draft')
  for (const fragment of item.expect.protected ?? []) {
    const before = item.draft.split(fragment).length - 1
    const after = text.split(fragment).length - 1
    if (before !== after) failures.push(`Protected fragment count changed: ${fragment}`)
  }
  for (const fragment of item.expect.required ?? []) if (!text.includes(fragment)) failures.push(`Required fragment missing: ${fragment}`)
  for (const fragment of item.expect.forbidden ?? []) if (text.includes(fragment)) failures.push(`Forbidden addition present: ${fragment}`)
  return { passed: failures.length === 0, abstained: false, failures }
}

function reviewKeys(item) {
  return item.operation === 'optimize'
    ? ['intentAligned', 'noUnsupportedRequirements', 'constraintsPreserved']
    : ['intentAligned', 'noUnsupportedRequirements', 'naturalUserVoice']
}

function validReview(value) {
  if (!value) return { ...Object.fromEntries(humanFields.map(field => [field, null])), editCharacters: null, comment: '' }
  const clean = {}
  for (const field of humanFields) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'boolean') throw new Error(`Review ${field} must be boolean or null`)
    clean[field] = value[field] ?? null
  }
  if (value.editCharacters !== undefined && value.editCharacters !== null
    && (!Number.isFinite(value.editCharacters) || value.editCharacters < 0)) throw new Error('editCharacters must be a non-negative number or null')
  return { ...clean, editCharacters: value.editCharacters ?? null, comment: typeof value.comment === 'string' ? value.comment : '' }
}

function attachBlindReviews(results, role, reviews, key) {
  for (const [id, review] of reviews) {
    const label = key[id]?.[role]
    if (!label || !results.has(id)) continue
    const previous = results.get(id)
    results.set(id, { ...previous, human: validReview(review[label]) })
  }
}

async function normalizeResult(item, result, coreModule) {
  if (result.recorded !== true) return { recorded: false }
  const hasText = Object.hasOwn(result, 'text')
  const hasRaw = Object.hasOwn(result, 'raw')
  if (hasText === hasRaw) throw new Error(`${item.id}: provide exactly one of text or raw`)
  let text = result.text
  let processingError = null
  if (hasRaw) {
    if (typeof result.raw !== 'string') throw new Error(`${item.id}: raw must be a string`)
    try {
      const prepared = coreModule.prepareGeneration(requestFor(item), item.history, coreModule.resolveConfig({}))
      text = coreModule.finishGeneration(result.raw, prepared)
    } catch (error) {
      processingError = error.message
      text = null
    }
  }
  if (text !== null && typeof text !== 'string') throw new Error(`${item.id}: text must be string or null`)
  const automatic = checkOutput(item, text)
  if (processingError) {
    automatic.passed = false
    automatic.failures.push(`Plugin rejected raw output: ${processingError}`)
  }
  const human = validReview(result.human)
  const needsHuman = item.expect.behavior === 'text' && reviewKeys(item).some(field => human[field] === null || human[field] === undefined)
  const humanPassed = item.expect.behavior === 'abstain' || reviewKeys(item).every(field => human[field] === true)
  return {
    recorded: true, text, automatic, human, needsHuman,
    usable: automatic.passed && humanPassed,
    latencyMs: Number.isFinite(result.latencyMs) && result.latencyMs >= 0 ? result.latencyMs : null,
    inputTokens: Number.isFinite(result.inputTokens) && result.inputTokens >= 0 ? result.inputTokens : null,
    outputTokens: Number.isFinite(result.outputTokens) && result.outputTokens >= 0 ? result.outputTokens : null,
  }
}

async function scoreSet(cases, records) {
  const ids = new Set(cases.map(item => item.id))
  for (const id of records.keys()) if (!ids.has(id)) throw new Error(`Unknown result id: ${id}`)
  const requiresCore = [...records.values()].some(value => value.recorded === true && Object.hasOwn(value, 'raw'))
  const module = requiresCore ? await core() : null
  const scored = []
  for (const item of cases) {
    const result = records.get(item.id)
    scored.push({ id: item.id, operation: item.operation, expectation: item.expect.behavior,
      ...(result ? await normalizeResult(item, result, module) : { recorded: false }) })
  }
  const groups = operations.map(operation => {
    const all = scored.filter(item => item.operation === operation)
    const recorded = all.filter(item => item.recorded)
    const explicit = all.filter(item => item.expectation === 'text')
    const ambiguous = all.filter(item => item.expectation === 'abstain')
    const reviewed = recorded.filter(item => !item.needsHuman)
    const useful = explicit.filter(item => item.usable).length
    const correctAbstentions = ambiguous.filter(item => item.recorded && item.automatic.passed).length
    const complete = recorded.length === all.length && reviewed.length === all.length
    const passed = complete && (operation === 'optimize'
      ? useful === explicit.length
      : useful >= 10 && correctAbstentions >= 7)
    const latencies = recorded.flatMap(item => item.latencyMs === null ? [] : [item.latencyMs]).sort((a, b) => a - b)
    const mean = values => values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null
    return {
      operation, total: all.length, recorded: recorded.length, reviewed: reviewed.length,
      expectedText: explicit.length, usableText: useful, expectedAbstentions: ambiguous.length, correctAbstentions,
      displayed: recorded.filter(item => !item.automatic.abstained).length,
      structuralFailures: recorded.filter(item => !item.automatic.passed).length,
      unsupportedAdditions: recorded.filter(item => item.human.noUnsupportedRequirements === false).length,
      meanEditCharacters: mean(recorded.flatMap(item => item.human.editCharacters === null ? [] : [item.human.editCharacters])),
      latencyP50Ms: latencies.length ? latencies[Math.floor((latencies.length - 1) * 0.5)] : null,
      latencyP95Ms: latencies.length ? latencies[Math.ceil((latencies.length - 1) * 0.95)] : null,
      status: complete ? (passed ? 'passed' : 'failed') : recorded.length ? 'incomplete' : 'not_evaluated',
    }
  })
  return { groups, cases: scored, status: groups.every(item => item.status === 'passed') ? 'passed'
    : groups.some(item => item.status === 'failed') ? 'failed'
      : groups.some(item => item.recorded) ? 'incomplete' : 'not_evaluated' }
}

function reportMarkdown(report) {
  const rows = report.candidate.groups.map(group => `| ${group.operation} | ${group.recorded}/${group.total} | ${group.reviewed}/${group.total} | ${group.usableText}/${group.expectedText} | ${group.correctAbstentions}/${group.expectedAbstentions} | ${group.status} |`).join('\n')
  const details = report.candidate.cases.filter(item => item.recorded && (!item.automatic.passed || item.needsHuman))
    .map(item => `- ${item.id}: ${item.automatic.failures.join('; ') || 'awaiting human semantic review'}`).join('\n')
  const localTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(report.generatedAt))
  return `# 输入助手离线质量报告\n\n生成时间：${localTime}（Asia/Shanghai）\n\n状态：**${report.candidate.status}**。只根据导入的真实记录与人工评价计分，未记录项不会视为正确弃权。\n\n| 操作 | 已记录 | 已完成语义评审 | 可用文本 | 正确弃权 | 状态 |\n|---|---:|---:|---:|---:|---|\n${rows}\n\n${details ? `## 未通过或待评审\n\n${details}\n\n` : ''}${report.baseline ? `基线状态：**${report.baseline.status}**。完整逐项与延迟、修改量数据见同名 JSON。\n\n` : '本次没有导入基线结果，不能据此宣称优于基线。\n\n'}${report.blindPreferences ? `匿名偏好：候选 ${report.blindPreferences.candidateWins}，基线 ${report.blindPreferences.baselineWins}，相当 ${report.blindPreferences.ties}，未评分 ${report.blindPreferences.unrated}。\n\n` : ''}自动检查只能覆盖长度、重复前缀和原文片段等机械条件。意图、否定条件和新增任务需要人工评审；本报告不证明语义完全保真，也不支持普遍优于 Claude/Codex 的结论。\n`
}

async function main() {
  const command = process.argv[2] ?? 'help'
  if (command === 'help' || flags.help) {
    console.log('Offline evaluation (no model/network calls):\n  export --out evaluation/requests.jsonl\n  template --out evaluation/results.template.jsonl\n  compare --candidate results.jsonl --baseline baseline.jsonl --out evaluation/blind.jsonl\n  score [--candidate results.jsonl] [--baseline baseline.jsonl] [--reviews blind.jsonl --key blind.key.json] --out evaluation/report.json\n  validate\nOptional: --cases custom-cases.json. export and raw scoring require pnpm build.')
    return
  }
  const cases = await loadCases(flags.cases ? resolve(String(flags.cases)) : undefined)
  if (command === 'validate') {
    console.log(JSON.stringify({ total: cases.length, operations: Object.fromEntries(operations.map(operation => [operation, cases.filter(item => item.operation === operation).length])), abstentions: cases.filter(item => item.expect.behavior === 'abstain').length }))
    return
  }
  if (command === 'export') {
    const module = await core()
    const settings = module.resolveConfig({})
    const rows = cases.map(item => {
      const request = requestFor(item)
      const prepared = module.prepareGeneration(request, item.history, settings)
      return { id: item.id, operation: item.operation, request,
        system: prepared.system, input: prepared.input,
        timeoutMs: prepared.timeoutMs, maxOutputTokens: prepared.maxOutputTokens }
    })
    const target = await write(flags.out ?? resolve(root, 'evaluation/requests.jsonl'), rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    console.log(JSON.stringify({ exported: rows.length, path: target, modelCalls: 0 }))
    return
  }
  if (command === 'template') {
    const rows = cases.map(item => ({ id: item.id, recorded: false, text: null, latencyMs: null,
      human: Object.fromEntries([...humanFields.map(field => [field, null]), ['editCharacters', null], ['comment', '']]) }))
    const target = await write(flags.out ?? resolve(root, 'evaluation/results.template.jsonl'), rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    console.log(JSON.stringify({ rows: rows.length, path: target, note: 'Set recorded:true only for actual model results; reference answers are not model results.' }))
    return
  }
  if (command === 'compare') {
    if (!flags.candidate || !flags.baseline) throw new Error('compare requires --candidate and --baseline')
    const candidate = await readRecords(flags.candidate)
    const baseline = await readRecords(flags.baseline)
    if ([...candidate.values(), ...baseline.values()].some(value => value.recorded && Object.hasOwn(value, 'raw'))) throw new Error('For blind comparison use normalized text results, not raw placeholder responses')
    const key = {}
    const rows = cases.flatMap(item => {
      const left = candidate.get(item.id), right = baseline.get(item.id)
      if (left?.recorded !== true || right?.recorded !== true) return []
      const swap = (createHash('sha256').update(item.id).digest()[0] & 1) === 1
      key[item.id] = { candidate: swap ? 'B' : 'A', baseline: swap ? 'A' : 'B' }
      const blank = () => Object.fromEntries([...humanFields.map(field => [field, null]), ['editCharacters', null], ['comment', '']])
      return [{ id: item.id, operation: item.operation, history: item.history, draft: item.draft,
        A: { text: swap ? right.text : left.text, ...blank() },
        B: { text: swap ? left.text : right.text, ...blank() }, preferred: null }]
    })
    const target = resolve(String(flags.out ?? resolve(root, 'evaluation/blind.jsonl')))
    const keyPath = target.replace(/\.[^.]+$/, '') + '.key.json'
    await write(target, rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    await write(keyPath, JSON.stringify(key, null, 2) + '\n')
    console.log(JSON.stringify({ pairs: rows.length, reviewPath: target, keyPath, note: 'Give reviewers only reviewPath; keep keyPath separate.' }))
    return
  }
  if (command === 'score') {
    const candidate = await readRecords(flags.candidate)
    const baseline = await readRecords(flags.baseline)
    let blindPreferences
    if (flags.reviews) {
      if (!flags.key) throw new Error('--reviews requires --key from compare')
      const reviews = await readRecords(flags.reviews)
      const key = JSON.parse(await readFile(resolve(String(flags.key)), 'utf8'))
      attachBlindReviews(candidate, 'candidate', reviews, key)
      attachBlindReviews(baseline, 'baseline', reviews, key)
      blindPreferences = { candidateWins: 0, baselineWins: 0, ties: 0, unrated: 0 }
      for (const [id, mapping] of Object.entries(key)) {
        const preferred = reviews.get(id)?.preferred
        if (preferred === undefined || preferred === null) blindPreferences.unrated += 1
        else if (preferred === 'equal') blindPreferences.ties += 1
        else if (preferred === mapping.candidate) blindPreferences.candidateWins += 1
        else if (preferred === mapping.baseline) blindPreferences.baselineWins += 1
        else throw new Error(`${id}: preferred must be A, B, equal or null`)
      }
    }
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
      dataKind: 'synthetic', modelCallsByThisTool: 0,
      candidate: await scoreSet(cases, candidate),
      ...(blindPreferences ? { blindPreferences } : {}),
      ...(flags.baseline ? { baseline: await scoreSet(cases, baseline) } : {}) }
    const target = resolve(String(flags.out ?? resolve(root, 'evaluation/report.json')))
    await write(target, JSON.stringify(report, null, 2) + '\n')
    const markdown = target.replace(/\.[^.]+$/, '') + '.md'
    await write(markdown, reportMarkdown(report))
    console.log(JSON.stringify({ status: report.candidate.status, path: target, markdown,
      recorded: report.candidate.cases.filter(item => item.recorded).length, total: cases.length }))
    if (flags.strict && report.candidate.status !== 'passed') process.exitCode = 1
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
