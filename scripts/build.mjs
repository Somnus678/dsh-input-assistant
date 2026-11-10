import { build } from 'esbuild'
import { mkdir, readFile, copyFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

await mkdir('lib', { recursive: true })
const shared = ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'react-dom/*', 'zod', 'zod/*']
await build({ entryPoints: { index: 'src/index.ts', core: 'src/core/index.ts' }, outdir: 'lib',
  bundle: true, format: 'esm', platform: 'node', target: 'node22', sourcemap: true, external: shared })
// The supplied 0.1.4 artifact did not contain browser TypeScript/sourcemaps.
// Its original, unminified browser bundle is the canonical client source;
// keep its original UI and apply only reviewed fixes directly in that file.
await copyFile('src/browser/original-client.js', 'lib/client.js')
const tsc = resolve('node_modules/typescript/bin/tsc')
const declaration = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' })
if (declaration.status !== 0) process.exit(declaration.status || 1)
await mkdir('lib/browser', { recursive: true })
for (const file of await readdir('src/browser/declarations')) if (file.endsWith('.d.ts')) await copyFile(`src/browser/declarations/${file}`, `lib/browser/${file}`)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
process.stdout.write(`Built ${pkg.name}@${pkg.version}: host ESM, core ESM, DSH browser module, declarations.\n`)
