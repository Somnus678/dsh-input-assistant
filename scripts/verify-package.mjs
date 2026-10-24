import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const files = (await readdir('dist')).filter(f => /^dsh-input-assistant-.*\.tgz$/.test(f)).sort()
assert.ok(files.length, 'Run pnpm pack --pack-destination dist first')
const archive = process.argv[2] || `dist/${files.at(-1)}`
const tar = gunzipSync(await readFile(archive))
const entries = new Map()
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512)
  if (header.every(byte => byte === 0)) break
  const name = header.subarray(0, 100).toString().replace(/\0.*$/, '')
  const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0
  entries.set(name, tar.subarray(offset + 512, offset + 512 + size).toString())
  offset += 512 + Math.ceil(size / 512) * 512
}
for (const path of ['package/package.json', 'package/cordis.patch.yml', 'package/lib/index.js', 'package/lib/index.d.ts', 'package/lib/client.js', 'package/lib/core.js', 'package/README.md', 'package/LICENSE']) assert.ok(entries.has(path), `Missing ${path}`)
assert.ok(![...entries.keys()].some(path => /node_modules|\.research|evaluation\/cases/.test(path)), 'Research/runtime/evaluation fixtures must not ship')
const pkg = JSON.parse(entries.get('package/package.json'))
assert.equal(pkg.engines.dsh, '>=0.2.1-rc.2 <0.3.0-0')
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
let module
vm.runInNewContext(entries.get('package/lib/client.js'), { window: { __ModuleLoader__: { load: value => { module = value } } } })
assert.equal(module.id, 'dsh-input-assistant')
const require = createRequire(import.meta.url)
const client = module.factory(id => require(id))
assert.equal(typeof client.apply, 'function')
assert.equal(typeof client.name, 'string')
const host = await import('../lib/index.js')
assert.equal(typeof host.apply, 'function')
assert.equal(typeof host.name, 'string')
process.stdout.write(`PASS ${archive}: required package files, isolated DSH module factory, host import, version and bundle metadata.\n`)
