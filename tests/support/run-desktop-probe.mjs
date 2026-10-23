/** Run only AFTER the production bundle has been installed with quiet settings. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const workspace = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const expectedProfile = resolve(homedir(), '.dsh/profiles/desktop')
const profile = resolve(process.argv[2] ?? expectedProfile)
assert.equal(profile, expectedProfile, 'This probe only supports the confirmed desktop profile')
const patchPath = resolve(profile, 'cordis.patch.yml')
const runId = randomUUID()
const cache = resolve(workspace, '.test-runtime')
const runDir = resolve(cache, `desktop-probe-${runId}`)
assert(runDir.startsWith(cache + sep))
await mkdir(runDir, { recursive: true })
const reportPath = resolve(runDir, 'report.json')
const original = await readFile(patchPath, 'utf8')
await writeFile(resolve(runDir, 'cordis.patch.yml.before'), original, { flag: 'wx' })
const pluginUrl = pathToFileURL(resolve(workspace, 'tests/support/desktop-probe.mjs'))
// Cordis/Node retains imported namespaces after unload. A new query prevents a
// changed test file from silently running an older, cached probe implementation.
pluginUrl.searchParams.set('probe', runId)
const plugin = pluginUrl.href
const installedRoot = resolve(profile, 'node_modules/dsh-input-assistant')
const installedManifest = JSON.parse(await readFile(resolve(installedRoot, 'package.json'), 'utf8'))
assert.equal(installedManifest.name, 'dsh-input-assistant')
const installedMain = resolve(installedRoot, installedManifest.main)
assert(installedMain.startsWith(installedRoot + sep), 'Installed package entry must stay within its package')
const installedMainSha256 = createHash('sha256').update(await readFile(installedMain)).digest('hex')
const block = `\n# BEGIN input-assistant-probe ${runId}\n- insert:\n    - id: input-assistant-probe-${runId}\n      name: ${JSON.stringify(plugin)}\n      config:\n        reportPath: ${JSON.stringify(reportPath)}\n        installedVersion: ${JSON.stringify(installedManifest.version)}\n        installedMainSha256: ${JSON.stringify(installedMainSha256)}\n# END input-assistant-probe ${runId}\n`

async function replaceAtomic(path, content) {
  const temporary = resolve(dirname(path), `.input-assistant-probe-${runId}.tmp`)
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
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); break } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      await delay(200)
    }
  }
  assert(report, 'Current desktop Host did not hot-load the probe within 45 seconds')
} finally {
  if (installed) {
    const current = await readFile(patchPath, 'utf8')
    assert.equal(current.split(block).length, 2, 'Temporary patch block changed; preserve the backup and remove its exact UUID block manually')
    // Preserve edits made by the user or the installer during the probe.
    await replaceAtomic(patchPath, current.replace(block, ''))
    const restored = await readFile(patchPath, 'utf8')
    assert(!restored.includes(`input-assistant-probe-${runId}`))
    await writeFile(resolve(runDir, 'patch-cleanup.json'), JSON.stringify({
      removed: true, originalExactlyRestored: restored === original,
      finishedAt: new Date().toISOString(),
    }, null, 2) + '\n')
  }
}
console.log(JSON.stringify({ reportPath, ...report }, null, 2))
assert.equal(report.passed, true, 'Desktop host probe reported a failure')
