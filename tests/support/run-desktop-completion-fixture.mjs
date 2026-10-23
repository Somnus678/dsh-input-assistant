/** Run only after the operator says the production UI is ready. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const workspace = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const patchPath = resolve(homedir(), '.dsh/profiles/desktop/cordis.patch.yml')
const runId = randomUUID()
const cache = resolve(workspace, '.test-runtime/desktop-fixture')
const directory = resolve(cache, runId)
assert(directory.startsWith(cache + sep))
await mkdir(directory, { recursive: true })
const original = await readFile(patchPath, 'utf8')
await writeFile(resolve(directory, 'cordis.patch.yml.before'), original, { flag: 'wx' })
const pluginUrl = pathToFileURL(resolve(workspace, 'tests/support/desktop-completion-fixture.mjs'))
pluginUrl.searchParams.set('fixture', runId)
const block = `\n# BEGIN input-assistant-completion-fixture ${runId}\n- insert:\n    - id: input-assistant-completion-fixture-${runId}\n      name: ${JSON.stringify(pluginUrl.href)}\n      config:\n        directory: ${JSON.stringify(directory)}\n        runId: ${JSON.stringify(runId)}\n# END input-assistant-completion-fixture ${runId}\n`
async function replaceAtomic(content) {
  const temporary = resolve(dirname(patchPath), `.input-assistant-completion-fixture-${runId}.tmp`)
  await writeFile(temporary, content)
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, patchPath); return } catch (error) {
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
      await delay(50 * (attempt + 1))
    }
  }
}
let installed = false
let ready = false
let finished
try {
  await replaceAtomic(original + block)
  installed = true
  const deadline = Date.now() + 6 * 60_000
  while (Date.now() < deadline) {
    try { finished = JSON.parse(await readFile(resolve(directory, 'finished.json'), 'utf8')); break } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    if (!ready) {
      try { const report = JSON.parse(await readFile(resolve(directory, 'ready.json'), 'utf8'))
        ready = true; console.log(JSON.stringify({ directory, cleanupSignal: resolve(directory, 'cleanup.signal'), ...report }))
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    }
    await delay(200)
  }
  assert(finished, 'Fixture did not finish before the operator deadline')
} finally {
  if (installed) {
    await writeFile(resolve(directory, 'cleanup.signal'), 'cleanup\n')
    const current = await readFile(patchPath, 'utf8')
    assert.equal(current.split(block).length, 2, 'Temporary fixture block changed')
    await replaceAtomic(current.replace(block, ''))
    const restored = await readFile(patchPath, 'utf8')
    await writeFile(resolve(directory, 'patch-cleanup.json'), JSON.stringify({ removed: !restored.includes(runId),
      originalExactlyRestored: restored === original }, null, 2) + '\n')
  }
}
console.log(JSON.stringify({ directory, ...finished }, null, 2))
assert.equal(finished.cleaned, true, 'Fixture settings cleanup did not complete')
