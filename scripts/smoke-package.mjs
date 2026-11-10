import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { readPackageArchive } from './package-archive.mjs'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const archive = resolve(process.argv[2] || `dist/${manifest.name}-${manifest.version}.tgz`)
const entries = await readPackageArchive(archive)
const pkg = JSON.parse(entries.get('package/package.json'))
assert.equal(pkg.name, manifest.name); assert.equal(pkg.version, manifest.version)
const client = entries.get('package/lib/client.js'), core = entries.get('package/lib/core.js')
assert.ok(client && core, 'The real browser and core artifacts must be present')
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex')
const output = resolve('.test-runtime', `packaged-${pkg.version}`)
await mkdir(output, { recursive: true })
const fixture = await build({ entryPoints: ['tests/support/packaged-web-fixture.tsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', metafile: true })
assert.ok(!Object.keys(fixture.metafile.inputs).some(path => /^src\//.test(path.replaceAll('\\', '/'))),
  'The package fixture must not import plugin source files')
let theme = ''
for (const entry of await readdir('node_modules/.pnpm')) {
  try {
    const source = await readFile(join('node_modules/.pnpm', entry, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
    const design = source.match(/var design_platform_css_default = ("(?:\\.|[^"\\])*");/)
    const base = source.match(/var base_css_default = ("(?:\\.|[^"\\])*");/)
    if (design && base) { theme = JSON.parse(base[1]) + '\n' + JSON.parse(design[1]); break }
  } catch { /* A different installed dependency entry. */ }
}
assert.ok(theme, 'Published DSH theme required')
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Packaged input assistant ${pkg.version}</title>
<style>${theme}</style><style>body{margin:0;padding:28px;font:15px/1.6 system-ui;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
main{max-width:900px;margin:auto}h1{font-size:20px}#settings{max-width:760px;margin:auto}#clipper{position:fixed;left:20px;right:20px;bottom:20px;height:160px;overflow:hidden;contain:paint}
.card{height:100%;position:relative;padding:12px;background:var(--dsw-specific-input-major);border-radius:16px}#editor{font:16px/26px system-ui;min-height:64px;padding:4px 8px;white-space:pre-wrap;outline:none}
#right{display:flex;justify-content:flex-end}#overlay{position:absolute;inset:0;pointer-events:none}p{margin:0}</style>
<main><h1>实际安装包 ${pkg.version} · 浏览器回归</h1><p>client.js 与 core.js 直接来自待发布归档；真实 Lexical、React 与宿主主题；0 次付费模型调用。</p><div id="settings"></div></main>
<div id="clipper"><div class="card" data-composer-card><div id="editor" data-composer-input contenteditable="true" tabindex="0" role="textbox" aria-label="打包草稿"></div><div id="right"></div><div id="overlay"></div></div></div>
<script src="/fixture.js"></script><script src="/client.js"></script><script type="module">import * as core from '/core.js';window.fixture.mount(core)</script></html>`
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url?.endsWith('.js') ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8')
  response.end(request.url === '/client.js' ? client : request.url === '/core.js' ? core : request.url === '/fixture.js' ? fixture.outputFiles[0].text : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const assertions = [], pageErrors = []
let browser
async function scenario(name, run, viewport = { width: 1024, height: 900 }) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', error => pageErrors.push({ name, message: error.message }))
  try {
    await page.goto(url)
    await page.waitForFunction(() => window.fixture?.controller().getSnapshot().connected)
    await run(page)
    assertions.push(name)
  } finally { await page.close() }
}
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  await scenario('preview requires acceptance and one native undo restores the original', async page => {
    const original = '说明缓存，不改接口。'
    await page.evaluate(text => { window.fixture.setDraft(text); window.fixture.focus() }, original)
    await page.getByRole('button', { name: '优化', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '优化预览' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText(original)
    await page.screenshot({ path: join(output, 'optimization-preview.png') })
    await page.getByRole('button', { name: '采纳优化', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请说明缓存机制，保持现有接口不变。')
    await page.getByRole('textbox', { name: '打包草稿' }).press('Control+z')
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText(original)
  })
  await scenario('literal path quotes survive packaged optimization cleanup', async page => {
    const original = '"C:\\Program Files\\Tool\\app.exe"'
    await page.evaluate(text => { window.fixture.setDraft(text); window.fixture.focus(); window.fixture.echoTarget() }, original)
    await page.getByRole('button', { name: '优化', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '优化预览' })).toBeVisible()
    expect(await page.evaluate(() => window.fixture.controller().getSnapshot().preview.text)).toBe(original)
  })
  await scenario('keyboard preview focus survives appearance and returns after invalidation', async page => {
    await page.evaluate(() => { window.fixture.setDraft('保留焦点的草稿'); window.fixture.focus() })
    const optimize = page.getByRole('button', { name: '优化', exact: true })
    await optimize.focus(); await optimize.press('Enter')
    await expect(page.getByRole('button', { name: '采纳优化', exact: true })).toBeFocused()
    await page.evaluate(() => window.fixture.config({ optimizationStrength: 'deep' }))
    await expect(page.getByRole('dialog', { name: '优化预览' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toBeFocused()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('保留焦点的草稿')
  })
  await scenario('interrupted manual prediction does not leave the composer busy', async page => {
    await page.evaluate(() => { window.fixture.setDelay(200); window.fixture.setDraft('请解释时间'); window.fixture.focus() })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await page.waitForFunction(() => window.fixture.requests().length === 1)
    await page.evaluate(() => window.fixture.setDraft('用户自己编辑的新稿'))
    await page.waitForTimeout(260)
    expect(await page.evaluate(() => window.fixture.controller().getSnapshot().busy)).toBeNull()
    expect(await page.evaluate(() => window.fixture.controller().getSnapshot().suggestion)).toBeNull()
    await expect(page.getByRole('button', { name: '预测', exact: true })).toBeEnabled()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('用户自己编辑的新稿')
  })
  await scenario('cancelling clear preserves the draft after the save reply', async page => {
    const original = '取消后应保留的草稿'
    await page.evaluate(text => { window.fixture.setDraft(text); window.fixture.focus(); window.fixture.deferSave() }, original)
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    await page.getByRole('button', { name: '暂存并清空', exact: true }).click()
    await page.getByRole('button', { name: '取消清空', exact: true }).click()
    await page.evaluate(() => window.fixture.releaseSave())
    await page.waitForFunction(() => window.fixture.controller().getSnapshot().busy === null)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText(original)
    expect(await page.evaluate(() => window.fixture.drafts().map(draft => draft.text))).toEqual([original])
  })
  await scenario('provider failures require an explicit retry and leave the draft unchanged', async page => {
    await page.evaluate(() => { window.fixture.setDraft('请解释时间'); window.fixture.focus(); window.fixture.failNext() })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await page.waitForFunction(() => window.fixture.controller().getSnapshot().suggestionStatus === 'failed')
    await page.waitForTimeout(1000)
    expect(await page.evaluate(() => window.fixture.requests().length)).toBe(1)
    await page.getByRole('button', { name: '重试建议', exact: true }).click()
    await expect(page.locator('.dsh-ia-ghost')).toHaveText('复杂度。')
    expect(await page.evaluate(() => window.fixture.requests().length)).toBe(2)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请解释时间')
  })
  await scenario('copy sends the exact saved draft to the Clipboard API without editing the composer', async page => {
    const original = '需要复制的草稿\n保留原始换行。'
    await page.evaluate(text => {
      window.fixture.setDraft(text); window.fixture.focus()
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedText = value } } })
    }, original)
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    await page.getByRole('button', { name: '暂存并清空', exact: true }).click()
    await page.waitForFunction(() => window.fixture.drafts().length === 1)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toBeEmpty()
    await page.evaluate(() => window.fixture.setDraft('现有的新稿'))
    await page.locator('.dsh-ia-draft > summary').filter({ hasText: '需要复制的草稿' }).click()
    await page.getByRole('button', { name: '复制草稿', exact: true }).click()
    expect(await page.evaluate(() => window.copiedText)).toBe(original)
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('现有的新稿')
  })
  await scenario('throttled manual prediction retries once after the supplied deadline', async page => {
    await page.evaluate(() => { window.fixture.setDraft('请解释时间'); window.fixture.focus(); window.fixture.throttleOnce(250) })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await page.waitForFunction(() => window.fixture.requests().length === 2)
    const times = await page.evaluate(() => window.fixture.requestTimes())
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(250)
    await expect(page.locator('.dsh-ia-ghost')).toHaveText('复杂度。')
    await page.getByRole('textbox', { name: '打包草稿' }).press('Tab')
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请解释时间复杂度。')
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.fixture.requests().length)).toBe(2)
  })
  await scenario('IME composition prevents manual generation', async page => {
    await page.evaluate(() => { window.fixture.setDraft('组合输入'); window.fixture.focus(); document.getElementById('editor').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
    await expect(page.getByRole('button', { name: '预测', exact: true })).toBeDisabled()
    await page.evaluate(() => window.fixture.controller().retrySuggestion())
    expect(await page.evaluate(() => window.fixture.requests().length)).toBe(0)
  })
  await scenario('hidden pages suppress automatic generation and visible restoration permits it', async page => {
    await page.evaluate(async () => { await window.fixture.config({ completionEnabled: true, debounceMs: 200, minIntervalMs: 500 }); window.fixture.setDraft('后台输入'); window.fixture.focus(); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.fixture.requests().length)).toBe(0)
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForFunction(() => window.fixture.requests().length === 1)
  })
  await scenario('Escape dismisses suggestions and menu focus returns to its trigger', async page => {
    await page.evaluate(() => { window.fixture.setDraft('请解释时间'); window.fixture.focus() })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await expect(page.locator('.dsh-ia-ghost')).toBeVisible()
    await page.getByRole('textbox', { name: '打包草稿' }).press('Escape')
    await expect(page.locator('.dsh-ia-ghost')).toHaveCount(0)
    const trigger = page.getByRole('button', { name: '输入助手菜单', exact: true })
    await trigger.focus(); await trigger.press('Enter')
    await expect(page.getByLabel('优化强度', { exact: true })).toBeFocused()
    await page.getByLabel('优化强度', { exact: true }).press('Escape')
    await expect(trigger).toBeFocused()
  })
  await scenario('detailed multiline candidates remain visible and respect the configured cap', async page => {
    await page.evaluate(async () => { await window.fixture.config({ predictionDetail: 'detailed', maxCompletionChars: 20 }); window.fixture.setDraft('请整理：'); window.fixture.focus(); window.fixture.output('\n第一点\n第二点') })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await expect(page.locator('.dsh-ia-candidate')).toBeVisible()
    await expect(page.locator('.dsh-ia-candidate-text')).toHaveText('\n第一点\n第二点')
    expect(await page.evaluate(() => window.fixture.controller().getSnapshot().settings.maxCompletionChars)).toBe(20)
    await page.getByRole('textbox', { name: '打包草稿' }).press('Tab')
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请整理：\n第一点\n第二点')
    await page.evaluate(() => { window.fixture.output('长'.repeat(21)); window.fixture.focus() })
    await page.getByRole('button', { name: '预测', exact: true }).click()
    await page.waitForFunction(() => window.fixture.controller().getSnapshot().suggestionStatus === 'abstained')
    await expect(page.locator('.dsh-ia-candidate')).toHaveCount(0)
    expect(await page.evaluate(() => window.fixture.controller().getSnapshot().suggestion)).toBeNull()
    await expect(page.getByRole('textbox', { name: '打包草稿' })).toHaveText('请整理：\n第一点\n第二点')
  })
  await scenario('presets wait for save and exact numeric values and fixed models persist', async page => {
    await page.evaluate(() => window.fixture.showSettings())
    const form = page.getByRole('form', { name: '输入助手设置' })
    await form.getByRole('button', { name: '节流省流', exact: true }).click()
    expect(await page.evaluate(() => window.fixture.controller().getSnapshot().settings.debounceMs)).toBe(600)
    await form.getByLabel('预测详略度', { exact: true }).selectOption('detailed')
    await form.getByText('高级设置', { exact: true }).click()
    await form.getByRole('spinbutton', { name: '续写停顿（毫秒）', exact: true }).fill('601')
    await form.getByRole('spinbutton', { name: '下一句长度上限（字符）', exact: true }).fill('1000')
    await form.getByRole('spinbutton', { name: '续写长度上限（字符）', exact: true }).fill('500')
    await form.getByLabel('辅助模型选择', { exact: true }).selectOption(JSON.stringify(['fixture', 'auxiliary']))
    await form.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(form.getByText('设置已保存并生效', { exact: true })).toBeVisible()
    await page.evaluate(() => window.fixture.controller().refresh())
    const settings = await page.evaluate(() => window.fixture.controller().getSnapshot().settings)
    expect(settings).toMatchObject({ predictionDetail: 'detailed', debounceMs: 601, maxNextChars: 1000, maxCompletionChars: 500, provider: 'fixture', model: 'auxiliary' })
    expect(await page.evaluate(() => window.fixture.mainRoute())).toEqual({ provider: 'fixture', model: 'main' })
    expect(await page.evaluate(() => window.fixture.requests().length)).toBe(0)
    await form.screenshot({ path: join(output, 'settings.png') })
  })
  await scenario('small dark menus remain in the viewport and scroll to every action', async page => {
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
    const menu = page.getByRole('dialog', { name: '输入助手', exact: true }), box = await menu.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(11); expect(box.y).toBeGreaterThanOrEqual(11)
    expect(box.x + box.width).toBeLessThanOrEqual(409); expect(box.y + box.height).toBeLessThanOrEqual(329)
    await menu.getByRole('button', { name: '暂停至下次编辑', exact: true }).scrollIntoViewIfNeeded()
    await expect(menu.getByRole('button', { name: '暂停至下次编辑', exact: true })).toBeInViewport()
    await page.screenshot({ path: join(output, 'small-dark.png') })
  }, { width: 420, height: 340 })
  assert.deepEqual(pageErrors, [], 'The actual packaged client must not raise browser errors')
  const result = { status: 'passed', version: pkg.version, archive, sha256, assertions, browser: browser.version(),
    clientSource: 'unmodified tarball bytes', coreSource: 'unmodified tarball bytes', fullNativeDsh: false, nativeOsIme: false, paidModelCalls: 0 }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} finally { try { await browser?.close() } finally { await new Promise(resolve => server.close(resolve)) } }
