import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { readPackageArchive } from './package-archive.mjs'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const archive = process.argv[2] || `dist/${manifest.name}-${manifest.version}.tgz`
const entries = await readPackageArchive(archive)
for (const path of ['package/package.json', 'package/cordis.patch.yml', 'package/lib/index.js', 'package/lib/index.d.ts', 'package/lib/client.js', 'package/lib/core.js', 'package/lib/core/index.d.ts', 'package/README.md', 'package/README.en.md', 'package/CHANGELOG.md', 'package/docs/images/light.png', 'package/docs/images/dark.png', 'package/docs/images/optimize.png', 'package/LICENSE']) assert.ok(entries.has(path), `Missing ${path}`)
assert.ok(![...entries.keys()].some(path => /node_modules|\.research|\.test-runtime|\.archive|MIGRATION\.md|evaluation\/cases/.test(path)), 'Research/runtime/evaluation fixtures must not ship')
const pkg = JSON.parse(entries.get('package/package.json'))
assert.equal(pkg.name, manifest.name, 'Archive must contain this package')
assert.equal(pkg.version, manifest.version, 'Pack the current package version before verification')
assert.equal(pkg.engines.dsh, '>=0.2.1-rc.2 <0.3.0-0')
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
let module
vm.runInNewContext(entries.get('package/lib/client.js'), { window: { __ModuleLoader__: { load: value => { module = value } } } })
assert.equal(module.id, 'dsh-input-assistant')
const require = createRequire(import.meta.url)
const client = module.factory(id => require(id))
assert.equal(typeof client.apply, 'function')
assert.equal(typeof client.name, 'string')
const cacheRoot = resolve('.test-runtime')
await mkdir(cacheRoot, { recursive: true })
const consumer = await mkdtemp(resolve(cacheRoot, 'package-types-'))
try {
  const packageRoot = resolve(consumer, 'node_modules', pkg.name)
  for (const [name, content] of entries) {
    if (name !== 'package/package.json' && !/^package\/lib\/.*\.(?:js|ts)$/.test(name)) continue
    const target = resolve(packageRoot, name.slice('package/'.length))
    assert.ok(target.startsWith(packageRoot + sep), 'Archive entry escapes package directory')
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, content)
  }
  const host = await import(pathToFileURL(resolve(packageRoot, 'lib/index.js')).href)
  assert.equal(typeof host.apply, 'function')
  assert.equal(typeof host.name, 'string')
  // A different nearest package scope is essential: otherwise TypeScript may
  // self-resolve this repository's package name and never inspect the archive.
  await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ name: 'input-assistant-package-consumer', private: true, type: 'module' }))
  const source = resolve(consumer, 'core-consumer.mts')
  const mainSource = resolve(consumer, 'main-consumer.mts')
  await writeFile(source, `import { resolveConfig, type GenerationResult } from '${pkg.name}/core';\nconst settings = resolveConfig({ provider: 'test', model: 'test' });\nconst enabled: boolean = settings.optimizeEnabled;\nconst text: GenerationResult['text'] = null;\n`)
  await writeFile(mainSource, `import { apply, name, type Config } from '${pkg.name}';\nconst config: Config = { provider: 'test', model: 'test' };\nconst install: (ctx: Parameters<typeof apply>[0], options?: Config) => void = apply;\nconst pluginName: string = name;\n`)
  const modes = [
    ['Bundler', ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler],
    ['NodeNext', ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext],
    ['Node16', ts.ModuleKind.Node16, ts.ModuleResolutionKind.Node16],
  ]
  const canonical = path => resolve(path).replaceAll('\\', '/').toLowerCase()
  const format = diagnostics => ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => consumer, getNewLine: () => '\n',
  })
  const optionsFor = ([, module, moduleResolution]) => ({ strict: true, noEmit: true, skipLibCheck: false, types: [],
    // Node >=22 DSH declarations expose Disposable/Symbol.dispose. Supply
    // that standard library explicitly rather than skipping peer checks.
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.esnext.disposable.d.ts'],
    target: ts.ScriptTarget.ES2022, module, moduleResolution })
  const diagnosticsFor = (file, options) => ts.getPreEmitDiagnostics(ts.createProgram([file], options))
  const assertResolution = (specifier, from, options, expected) => {
    const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule
    assert.ok(resolved, `Cannot resolve ${specifier}`)
    assert.equal(canonical(resolved.resolvedFileName), canonical(resolve(packageRoot, expected)), `${specifier} must resolve inside the extracted archive`)
  }
  for (const mode of modes) {
    const options = optionsFor(mode)
    assertResolution(`${pkg.name}/core`, source, options, 'lib/core/index.d.ts')
    const diagnostics = diagnosticsFor(source, options)
    assert.equal(diagnostics.length, 0, `${mode[0]} ESM core consumer:\n` + format(diagnostics))
    assertResolution(pkg.name, mainSource, options, 'lib/index.d.ts')
    const mainDiagnostics = diagnosticsFor(mainSource, options)
    assert.equal(mainDiagnostics.length, 0, `${mode[0]} ESM main consumer:\n` + format(mainDiagnostics))
  }
  // Negative controls prove that a green check depends on the packed mapping
  // and declarations, rather than a workspace self-reference or an implicit any.
  const nodeOptions = optionsFor(modes[1])
  const packageJson = resolve(packageRoot, 'package.json')
  await writeFile(packageJson, JSON.stringify({ ...pkg, exports: { ...pkg.exports, './core': './lib/core.js' } }))
  assertResolution(`${pkg.name}/core`, source, nodeOptions, 'lib/core.js')
  assert.ok(diagnosticsFor(source, nodeOptions).length, 'Missing packed core types mapping must fail the consumer')
  await writeFile(packageJson, JSON.stringify(pkg))
  const declaration = resolve(packageRoot, 'lib/core/config.d.ts'), originalDeclaration = await readFile(declaration, 'utf8')
  await writeFile(declaration, 'export {}\n')
  assert.ok(diagnosticsFor(source, nodeOptions).some(item => item.code === 2305), 'Removing the packed resolveConfig declaration must fail the consumer')
  await writeFile(declaration, originalDeclaration)
  process.stdout.write('Verified isolated archive resolution and both negative type controls.\n')
} finally {
  assert.ok(consumer.startsWith(cacheRoot + sep) && consumer.slice(cacheRoot.length + 1).startsWith('package-types-'), 'Unsafe cleanup target')
  await rm(consumer, { recursive: true })
}
process.stdout.write(`PASS ${archive}: package files, isolated browser factory, packed host import, archive-resolved Bundler/NodeNext/Node16 ESM core/main consumers and negative controls.\n`)
