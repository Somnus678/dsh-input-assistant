import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

await mkdir('lib', { recursive: true })
const shared = ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'react-dom/*', 'zod', 'zod/*']
await build({ entryPoints: { index: 'src/index.ts', core: 'src/core/index.ts' }, outdir: 'lib',
  bundle: true, format: 'esm', platform: 'node', target: 'node22', sourcemap: true, external: shared })
const browserEntry = existsSync('src/browser/index.tsx') ? 'src/browser/index.tsx' : 'src/browser/index.ts'
const client = await build({ entryPoints: [browserEntry], bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  external: shared, plugins: [{ name: 'dsh-module-ids', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/.*\/client$/ }, args => ({ path: args.path.replace(/\/client$/, ''), external: true }))
  }}], metafile: true })
const code = client.outputFiles[0].text
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:"dsh-input-assistant",factory:(require)=>{\nvar module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;\n}});\n`)
await writeFile('lib/client.meta.json', JSON.stringify(client.metafile, null, 2))
const tsc = resolve('node_modules/typescript/bin/tsc')
const declaration = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' })
if (declaration.status !== 0) process.exit(declaration.status || 1)
const bundledShared = Object.keys(client.metafile.inputs).filter(path => /node_modules.*(?:react|@deepseek-ai)/.test(path))
if (bundledShared.length) throw new Error(`Shared runtime accidentally bundled: ${bundledShared.join(', ')}`)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
process.stdout.write(`Built ${pkg.name}@${pkg.version}: host ESM, core ESM, DSH browser module, declarations.\n`)
