import { describe, expect, it, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/evaluate.mjs')
const fixture = JSON.parse(readFileSync(join(root, 'evaluation/cases.json'), 'utf8')) as {
  cases: { id: string; operation: string; tags: string[]; draft: string; expect: { behavior: string; reference: string | null; protected?: string[] } }[]
}
const temporary = mkdtempSync(join(tmpdir(), 'dsh-input-assistant-evaluation-'))
let serial = 0
function path(name: string) { return join(temporary, `${serial++}-${name}`) }
function run(...args: string[]) { return JSON.parse(execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' }).trim()) }
function output(name: string, rows: object[]) {
  const file = path(name)
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  return file
}
function recorded(reviewed = true) {
  return fixture.cases.map(item => ({ id: item.id, recorded: true, text: item.expect.reference,
    ...(reviewed ? { human: { intentAligned: true, noUnsupportedRequirements: true, naturalUserVoice: true, constraintsPreserved: true } } : {}) }))
}
afterAll(() => {
  // The sole recursive delete is the verified mkdtemp directory created by this test.
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + '\\') && !resolve(temporary).startsWith(resolve(tmpdir()) + '/')) throw new Error('Unexpected evaluation temp location')
  if (!temporary.includes('dsh-input-assistant-evaluation-')) throw new Error('Unexpected evaluation temp prefix')
  rmSync(temporary, { recursive: true, force: true })
})

describe('offline evaluation records and quality gates', () => {
  it('contains 60 distinct synthetic cases with the promised clear/abstention split', () => {
    const summary = run('validate')
    expect(summary).toEqual({ total: 60, operations: { optimize: 20, next: 20, complete: 20 }, abstentions: 16 })
    expect(new Set(fixture.cases.map(item => item.id)).size).toBe(60)
    for (const operation of ['next', 'complete']) {
      expect(fixture.cases.filter(item => item.operation === operation && item.expect.behavior === 'text')).toHaveLength(12)
      expect(fixture.cases.filter(item => item.operation === operation && item.expect.behavior === 'abstain')).toHaveLength(8)
    }
    for (const tag of ['en', 'ja', 'ko', 'negation', 'injection', 'path', 'emoji']) expect(fixture.cases.some(item => item.tags.includes(tag))).toBe(true)
  })

  it('reports zero supplied model results as not evaluated, never as successful abstention', () => {
    const reportPath = path('empty.json')
    const summary = run('score', '--out', reportPath)
    expect(summary.status).toBe('not_evaluated')
    expect(summary.recorded).toBe(0)
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.modelCallsByThisTool).toBe(0)
    expect(report.candidate.groups.every((group: { correctAbstentions: number }) => group.correctAbstentions === 0)).toBe(true)
  })

  it('keeps generated result templates unrecorded until a real run is explicitly recorded', () => {
    const resultPath = path('template.jsonl')
    run('template', '--out', resultPath)
    const summary = run('score', '--candidate', resultPath, '--out', path('template-report.json'))
    expect(summary.status).toBe('not_evaluated')
    expect(summary.recorded).toBe(0)
  })

  it('requires human semantic review even when synthetic reference strings pass structural checks', () => {
    const candidate = output('unreviewed.jsonl', recorded(false))
    const reportPath = path('unreviewed.json')
    expect(run('score', '--candidate', candidate, '--out', reportPath).status).toBe('incomplete')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.candidate.groups.every((group: { structuralFailures: number }) => group.structuralFailures === 0)).toBe(true)
    expect(report.candidate.cases.filter((item: { needsHuman?: boolean }) => item.needsHuman)).toHaveLength(44)
  })

  it('detects a changed protected path instead of trusting a positive human label', () => {
    const rows = recorded()
    const item = rows.find(row => row.id === 'optimize-04')!
    item.text = '检查 C:\\other\\app.ts。'
    const candidate = output('changed-path.jsonl', rows)
    const reportPath = path('changed-path.json')
    expect(run('score', '--candidate', candidate, '--out', reportPath).status).toBe('failed')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.candidate.cases.find((row: { id: string }) => row.id === item.id).automatic.failures.join(' ')).toContain('Protected fragment')
  })

  it('fails the optimize gate when a reviewer identifies an invented requirement', () => {
    const rows = recorded()
    rows.find(row => row.id === 'optimize-01')!.human!.noUnsupportedRequirements = false
    const candidate = output('invented-task.jsonl', rows)
    const reportPath = path('invented-task.json')
    expect(run('score', '--candidate', candidate, '--out', reportPath).status).toBe('failed')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.candidate.groups.find((group: { operation: string }) => group.operation === 'optimize').unsupportedAdditions).toBe(1)
  })

  it('rejects duplicate result ids and unknown ids with a clear error', () => {
    const duplicate = output('duplicate.jsonl', [{ id: 'next-01' }, { id: 'next-01' }])
    expect(() => run('score', '--candidate', duplicate, '--out', path('duplicate-report.json'))).toThrow()
    const unknown = output('unknown.jsonl', [{ id: 'not-in-fixtures', recorded: true, text: 'x' }])
    expect(() => run('score', '--candidate', unknown, '--out', path('unknown-report.json'))).toThrow()
  })

  it('separates anonymous review material from the candidate/baseline mapping', () => {
    const candidate = output('candidate.jsonl', recorded())
    const baseline = output('baseline.jsonl', recorded())
    const summary = run('compare', '--candidate', candidate, '--baseline', baseline, '--out', path('blind.jsonl'))
    expect(summary.pairs).toBe(60)
    const reviews = readFileSync(summary.reviewPath, 'utf8')
    expect(reviews).not.toContain('"candidate"')
    expect(reviews).not.toContain('"baseline"')
    const key = JSON.parse(readFileSync(summary.keyPath, 'utf8'))
    expect(Object.keys(key)).toHaveLength(60)
    expect(key['next-01'].candidate).not.toBe(key['next-01'].baseline)
  })
})
