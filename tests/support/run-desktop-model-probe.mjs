import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const workspace = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const mode = process.argv[2] ?? 'catalog'
assert(['catalog', 'benchmark', 'cleanup'].includes(mode))
const profile = resolve(homedir(), '.dsh/profiles/desktop')
const patchPath = resolve(profile, 'cordis.patch.yml')
const runId = randomUUID()
const cache = resolve(workspace, '.test-runtime/benchmark')
const runDir = resolve(cache, `${mode}-${runId}`)
assert(runDir.startsWith(cache + sep))
await mkdir(runDir, { recursive: true })
const reportPath = resolve(runDir, 'report.json')
let planPath
if (mode === 'benchmark') {
  planPath = resolve(process.argv[3] ?? '')
  assert(planPath.startsWith(cache + sep), 'Benchmark needs an explicit plan within the cache')
  const plan = await readFile(planPath, 'utf8')
  await writeFile(resolve(runDir, 'plan.json'), plan, { flag: 'wx' })
}
const original = await readFile(patchPath, 'utf8')
await writeFile(resolve(runDir, 'cordis.patch.yml.before'), original, { flag: 'wx' })
const pluginUrl = pathToFileURL(resolve(workspace, 'tests/support/desktop-model-probe.mjs'))
pluginUrl.searchParams.set('probe', runId)
const block = `\n# BEGIN input-assistant-model-probe ${runId}\n- insert:\n    - id: input-assistant-model-probe-${runId}\n      name: ${JSON.stringify(pluginUrl.href)}\n      config:\n        mode: ${JSON.stringify(mode)}\n        reportPath: ${JSON.stringify(reportPath)}\n${planPath ? `        planPath: ${JSON.stringify(planPath)}\n` : ''}# END input-assistant-model-probe ${runId}\n`
async function replaceAtomic(path, content) {
  const temporary = resolve(dirname(path), `.input-assistant-model-probe-${runId}.tmp`)
  await writeFile(temporary, content)
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, path); return } catch (error) {
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
      await delay(50 * (attempt + 1))
    }
  }
}
let report
let installed = false
try {
  await replaceAtomic(patchPath, original + block)
  installed = true
  const deadline = Date.now() + (mode === 'benchmark' ? 180_000 : 45_000)
  let lastProgress = 0
  while (Date.now() < deadline) {
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); break } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      if (mode === 'benchmark') {
        try {
          const progress = JSON.parse(await readFile(resolve(runDir, 'progress.json'), 'utf8'))
          if (progress.completed > lastProgress) { lastProgress = progress.completed; console.log(JSON.stringify(progress)) }
        } catch (progressError) {
          if (progressError.code !== 'ENOENT' && !(progressError instanceof SyntaxError)) throw progressError
        }
      }
      await delay(200)
    }
  }
  assert(report, 'Current desktop Host did not finish the model probe in time')
} finally {
  if (installed) {
    const current = await readFile(patchPath, 'utf8')
    assert.equal(current.split(block).length, 2, 'Temporary model-probe block changed')
    await replaceAtomic(patchPath, current.replace(block, ''))
    const restored = await readFile(patchPath, 'utf8')
    assert(!restored.includes(`input-assistant-model-probe-${runId}`))
    await writeFile(resolve(runDir, 'patch-cleanup.json'), JSON.stringify({ removed: true,
      originalExactlyRestored: restored === original, finishedAt: new Date().toISOString() }, null, 2) + '\n')
  }
}
console.log(JSON.stringify({ reportPath, ...report }, null, 2))
assert.equal(report.passed, true, 'Desktop model probe reported a failure')
