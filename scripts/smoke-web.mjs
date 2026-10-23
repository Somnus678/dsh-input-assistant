import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('.test-runtime/web', { recursive: true })
const bundle = await build({ entryPoints: ['tests/support/web-fixture.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2022' })
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>DSH Input Assistant integration fixture</title><style>body{font:15px/1.6 system-ui;background:#f6f7f9;color:#222;margin:0;padding:60px}main{max-width:880px;margin:auto}h1{font-size:22px}small{color:#657184}.card{position:relative;margin-top:340px;padding:18px;background:white;border:1px solid #dfe3ea;border-radius:16px}#editor{font:16px/26px system-ui;min-height:70px;outline:none;white-space:pre-wrap;padding:8px}#right{display:flex;justify-content:flex-end}#overlay{position:absolute;inset:0;pointer-events:none}button{font:inherit}p{margin:0}</style><style id="styles"></style><main><h1>DSH 输入助手 · 浏览器集成验证</h1><small>真实生产组件与 Lexical 编辑器；模型和连接为本地测试替身，消耗 0 个付费模型 token。</small><div class="card" data-composer-card><div id="editor" data-composer-input contenteditable="true" role="textbox" aria-label="测试草稿"></div><div id="right"></div><div id="overlay"></div></div></main><script src="/fixture.js"></script></html>`
const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8'); response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
let browser
const assertions = []
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  await expect(page.getByRole('button', { name: '优化', exact: true })).toBeVisible()
  const original = '说明缓存，不改接口。'
  await page.evaluate(text => { window.fixture.setDraft(text); window.fixture.focus() }, original)
  await expect(page.getByRole('button', { name: '优化', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '优化', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText('请说明缓存机制，保持现有接口不变。')
  await page.getByRole('textbox', { name: '测试草稿' }).press('Control+z')
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText(original)
  assertions.push('production optimize surface writes to real Lexical; one native undo restores original')
  await page.getByRole('button', { name: '优化', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText('请说明缓存机制，保持现有接口不变。')
  await page.getByRole('button', { name: '输入助手菜单' }).click()
  await page.getByText('查看改动', { exact: true }).click()
  await expect(page.locator('ins')).not.toHaveCount(0)
  await page.getByRole('button', { name: '还原', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText(original)
  assertions.push('change inspector and explicit restore use the production controller')
  await page.getByRole('button', { name: '暂存并清空', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText('')
  await page.locator('.dsh-ia-draft > summary').filter({ hasText: original }).click()
  await page.getByRole('button', { name: '替换', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText(original)
  assertions.push('stash saves before clearing and restores only on explicit action')
  await page.getByLabel('输入续写', { exact: true }).check()
  await page.getByRole('button', { name: '输入助手菜单' }).click()
  await page.evaluate(() => { window.fixture.setDraft('请解释这段代码的时间'); window.fixture.focus() })
  await expect(page.locator('.dsh-ia-ghost')).toHaveText('复杂度。')
  await page.getByRole('textbox', { name: '测试草稿' }).press('Tab')
  await expect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText('请解释这段代码的时间复杂度。')
  assertions.push('measured ghost suffix and Tab insert correctly in a real browser')
  await page.getByRole('button', { name: '输入助手菜单' }).click()
  await page.getByText('本次会话统计', { exact: true }).click().catch(() => {})
  await page.screenshot({ path: '.test-runtime/web/input-assistant.png', fullPage: true })
  expect(errors).toEqual([])
  await writeFile('.test-runtime/web/result.json', JSON.stringify({ status: 'passed', assertions, browser: 'Microsoft Edge headless', realDshDesktop: false, paidModelCalls: 0 }, null, 2))
  process.stdout.write(JSON.stringify({ status: 'passed', assertions, paidModelCalls: 0 }, null, 2) + '\n')
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
