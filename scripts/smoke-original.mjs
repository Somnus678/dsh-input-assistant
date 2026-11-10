import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { readPackageArchive } from './package-archive.mjs'

const base = resolve('.test-runtime/original-ui-smoke')
await mkdir(base, { recursive: true })
const archive = process.argv.includes('--package') ? await readPackageArchive(`dist/dsh-input-assistant-${JSON.parse(await readFile('package.json', 'utf8')).version}.tgz`) : null
const original = (await readFile('tests/fixtures/original-client.js', 'utf8')).replaceAll('\r\n', '\n')
const client = (archive ? archive.get('package/lib/client.js') : await readFile('lib/client.js', 'utf8')).replaceAll('\r\n', '\n')
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)))
assert.equal(section(client, '  const preserveSelection = (event)', '// src/core/types.ts'), section(original, '  const preserveSelection = (event)', '// src/core/types.ts'), 'Original controls and layout must remain intact')
assert.equal(section(client, '// src/browser/styles.ts', '// src/browser/settings.tsx'), section(original, '// src/browser/styles.ts', '// src/browser/settings.tsx'), 'Original styles must remain intact')
assert.equal(section(client, '// src/browser/settings.tsx', '// src/browser/index.ts\nvar name'), section(original, '// src/browser/settings.tsx', '// src/browser/index.ts\nvar name'), 'Original settings UI must remain intact')
const core = archive ? archive.get('package/lib/core.js') : await readFile('lib/core.js', 'utf8')
const fixture = await build({ entryPoints: ['tests/support/original-fixture.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2022' })
let theme = ''
for (const entry of await readdir('node_modules/.pnpm')) {
  try {
    const source = await readFile(join('node_modules/.pnpm', entry, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
    const a = source.match(/var design_platform_css_default = ("(?:\\.|[^"\\])*");/), b = source.match(/var base_css_default = ("(?:\\.|[^"\\])*");/)
    if (a && b) { theme = JSON.parse(b[1]) + '\n' + JSON.parse(a[1]); break }
  } catch {}
}
assert.ok(theme)
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>${theme}</style><style>body{margin:0;padding:28px;font:15px/1.6 system-ui}#clipper{position:fixed;left:20px;right:20px;bottom:20px;height:160px;overflow:hidden;contain:paint}.card{height:100%;position:relative;padding:12px}#editor{min-height:64px;white-space:pre-wrap}#right{display:flex;justify-content:flex-end}#overlay{position:absolute;inset:0;pointer-events:none}</style><div id="settings"></div><div id="clipper"><div class="card" data-composer-card><div id="editor" data-composer-input contenteditable="true" tabindex="0" role="textbox" aria-label="打包草稿"></div><div id="right"></div><div id="overlay"></div></div></div><script src="/fixture.js"></script><script src="/client.js"></script><script type="module">import * as core from '/core.js';window.fixture.mount(core)</script></html>`
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url?.endsWith('.js') ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8'); res.end(req.url === '/client.js' ? client : req.url === '/core.js' ? core : req.url === '/fixture.js' ? fixture.outputFiles[0].text : html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser; const passed = [], errors = []
async function scenario(name, run, query = '') {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  try { await page.goto(`http://127.0.0.1:${server.address().port}/${query}`); await page.waitForFunction(() => window.fixture?.controller().getSnapshot().connected); await run(page); passed.push(name) } finally { await page.close() }
}
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  await scenario('optimization writes immediately as in the original', async page => {
    await page.evaluate(() => { window.fixture.setDraft('说明缓存，不改接口。'); window.fixture.focus() })
    await page.getByRole('button', { name: '优化', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请说明缓存机制，保持现有接口不变。')
    await expect(page.getByRole('dialog', { name: '优化预览' })).toHaveCount(0)
  })
  await scenario('manual prediction inserts immediately as in the original', async page => {
    await page.evaluate(() => { window.fixture.setDraft('请解释时间'); window.fixture.focus() })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请解释时间复杂度。')
  })
  await scenario('editing cancels a manual request without wedging the original buttons', async page => {
    await page.evaluate(() => { window.fixture.setDelay(250); window.fixture.setDraft('旧草稿'); window.fixture.focus() })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await page.waitForFunction(() => window.fixture.requests().length === 1)
    await page.evaluate(() => window.fixture.setDraft('用户新草稿'))
    await expect(page.getByRole('button', { name: '预测', exact: true })).toBeEnabled()
    await page.waitForTimeout(300)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('用户新草稿')
    assert.equal(await page.evaluate(() => window.fixture.controller().getSnapshot().busy), null)
  })
  await scenario('cancelled stash does not clear the draft after save', async page => {
    await page.evaluate(() => { window.fixture.setDraft('取消后保留的草稿'); window.fixture.focus(); window.fixture.deferSave() })
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    await page.getByRole('button', { name: '暂存并清空', exact: true }).click()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.evaluate(() => window.fixture.releaseSave())
    await page.waitForFunction(() => window.fixture.drafts().length === 1)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('取消后保留的草稿')
  })
  await scenario('settings changes while stashing retain the current draft', async page => {
    await page.evaluate(() => { window.fixture.setDraft('设置变更后保留'); window.fixture.focus(); window.fixture.deferSave() })
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    await page.getByRole('button', { name: '暂存并清空', exact: true }).click()
    await page.evaluate(async () => { await window.fixture.config({ stashEnabled: false }); await window.fixture.config({ stashEnabled: true }); window.fixture.releaseSave() })
    await page.waitForFunction(() => window.fixture.drafts().length === 1)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('设置变更后保留')
  })
  await scenario('composition blocks unsafe manual prediction', async page => {
    await page.evaluate(() => { window.fixture.setDraft('输入法候选'); window.fixture.focus(); document.getElementById('editor').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 0)
  })
  await scenario('hidden page does not start automatic prediction', async page => {
    await page.evaluate(async () => { await window.fixture.config({ completionEnabled: true, debounceMs: 200 }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); window.fixture.setDraft('后台页面'); window.fixture.focus() })
    await page.keyboard.type('a')
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 0)
  })
  await scenario('a throttled automatic completion retries without caching a false abstention', async page => {
    await page.evaluate(async () => { await window.fixture.config({ completionEnabled: true, debounceMs: 200, minIntervalMs: 500 }); window.fixture.throttleOnce(250); window.fixture.setDraft('请解释时间'); window.fixture.focus() })
    await page.keyboard.type('a')
    await page.waitForFunction(() => window.fixture.requests().length === 2)
    await expect(page.locator('.dsh-ia-ghost')).toHaveText('复杂度。')
    await page.getByRole('textbox', { name: '打包草稿' }).press('Escape')
    await expect(page.locator('.dsh-ia-ghost')).toHaveCount(0)
    await page.waitForTimeout(550)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 2)
  })
  await scenario('entering a conversation with an old response never starts prediction', async page => {
    await page.evaluate(() => window.fixture.focus())
    await page.waitForTimeout(1300)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 0)
    await page.evaluate(() => window.fixture.setTurn('2'))
    await page.waitForFunction(() => window.fixture.requests().length === 1)
    assert.equal(await page.evaluate(() => window.fixture.requests()[0].operation), 'next')
  }, '?auto=1')
  await scenario('loading an existing draft is quiet until a real user edit', async page => {
    await page.waitForTimeout(1300)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 0)
    await page.evaluate(() => window.fixture.focus())
    await page.keyboard.type('x')
    await page.waitForFunction(() => window.fixture.requests().length === 1)
    assert.equal(await page.evaluate(() => window.fixture.requests()[0].operation), 'complete')
  }, '?auto=1&draft=1')
  await scenario('late hydration of an old draft is not mistaken for user input', async page => {
    await page.evaluate(() => { window.fixture.setDraft('稍后加载的旧草稿'); window.fixture.focus() })
    await page.waitForTimeout(1300)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 0)
    await page.keyboard.type('x')
    await page.waitForFunction(() => window.fixture.requests().length === 1)
  }, '?auto=1')
  await scenario('late loading an old completed turn does not start prediction', async page => {
    await page.evaluate(() => window.fixture.focus())
    await page.evaluate(() => window.fixture.setTurn('1'))
    await page.waitForTimeout(1300)
    assert.equal(await page.evaluate(() => window.fixture.requests().length), 0)
  }, '?auto=1&noTurn=1')
  await scenario('the fixed provider and model survive a status refresh', async page => {
    await page.evaluate(() => window.fixture.config({ provider: 'fixture', model: 'auxiliary' }))
    await page.evaluate(() => window.fixture.controller().refresh())
    const settings = await page.evaluate(() => window.fixture.controller().getSnapshot().settings)
    assert.equal(settings.provider, 'fixture'); assert.equal(settings.model, 'auxiliary')
  })
  await scenario('an obsolete failed status response does not disconnect newer settings', async page => {
    await page.evaluate(async () => {
      const controller = window.fixture.controller()
      window.fixture.deferStatusFailure()
      const pending = controller.refresh()
      await new Promise(resolve => setTimeout(resolve, 30))
      await window.fixture.config({ optimizationStrength: 'deep' })
      window.fixture.releaseStatus()
      await pending
    })
    const snapshot = await page.evaluate(() => window.fixture.controller().getSnapshot())
    assert.equal(snapshot.connected, true)
    assert.equal(snapshot.settings.optimizationStrength, 'deep')
  })
  await scenario('original menu and presets remain available', async page => {
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    await expect(page.getByLabel('预测详略度', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(base, 'restored-menu.png') })
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    await page.evaluate(() => window.fixture.showSettings())
    const form = page.getByRole('form', { name: '输入助手设置' })
    for (const name of ['敏捷模式', '标准平衡', '节流省流']) await expect(form.getByRole('button', { name, exact: true })).toBeVisible()
  })
  assert.deepEqual(errors, [])
  const result = { status: 'passed', passed, originalMarkupAndStyles: true, paidModelCalls: 0, nativeOsIme: false, fullNativeDsh: false }
  await writeFile(join(base, 'smoke-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { try { await browser?.close() } finally { await new Promise(resolve => server.close(resolve)) } }
