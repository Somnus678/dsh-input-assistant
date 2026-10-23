import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { placeFloating } from '../src/browser/floating'

let browser: Browser, server: Server, url: string

async function publishedThemeCss(): Promise<string> {
  for (const entry of await readdir('node_modules/.pnpm')) {
    const file = join('node_modules/.pnpm', entry, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js')
    if (!existsSync(file)) continue
    const source = await readFile(file, 'utf8')
    const design = source.match(/var design_platform_css_default = ("(?:\\.|[^"\\])*");/)
    const base = source.match(/var base_css_default = ("(?:\\.|[^"\\])*");/)
    if (design && base) return JSON.parse(base[1]) + '\n' + JSON.parse(design[1])
  }
  throw new Error('The locked DSH theme package must be installed for theme integration tests')
}

beforeAll(async () => {
  const theme = await publishedThemeCss()
  const bundle = await build({ entryPoints: ['tests/support/web-fixture.tsx'], bundle: true, write: false,
    format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2022' })
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>DSH theme regression</title>
    <style>${theme}</style><style>body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
    #clipper{position:fixed;left:20px;right:20px;bottom:20px;height:160px;overflow:hidden;contain:paint}
    .card{height:100%;padding:12px;background:var(--dsw-specific-input-major);border-radius:16px;position:relative}
    #editor{font:16px/26px var(--dsw-font-family);min-height:64px;padding:4px 8px;white-space:pre-wrap;outline:none}
    #right{display:flex;justify-content:flex-end;container-type:inline-size}#overlay{position:absolute;inset:0;pointer-events:none}p{margin:0}</style>
    <style id="styles"></style><main id="clipper"><div class="card" data-composer-card><div id="editor" data-composer-input contenteditable="true" role="textbox" aria-label="测试草稿"></div><div id="right"></div><div id="overlay"></div></div></main><script src="/fixture.js"></script></html>`
  server = createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8')
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await mkdir('.test-runtime/web-theme', { recursive: true })
  browser = await chromium.launch({ channel: 'msedge', headless: true })
}, 30000)
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()) })

async function surfaceContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element)
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(component => {
        const value = component / 255
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      })
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
    }
    const foreground = luminance(style.color), background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
}

describe('published DSH theme and clipped-composer regression', () => {
  it.each(['light', 'dark'] as const)('keeps %s menus, controls, notices and candidate panels readable', async theme => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } })
    try {
      await page.goto(url)
      await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), theme === 'dark')
      await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
      const menu = page.locator('.dsh-ia-menu')
      await browserExpect(menu).toBeVisible()
      expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true)
      expect(await surfaceContrast(page, '.dsh-ia-menu')).toBeGreaterThanOrEqual(4.5)
      expect(await surfaceContrast(page, '.dsh-ia-menu select[aria-label="优化强度"]')).toBeGreaterThanOrEqual(4.5)
      const box = (await menu.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(11)
      expect(box.y + box.height).toBeLessThanOrEqual(709)
      await browserExpect(menu.getByText('输入助手', { exact: true })).toBeInViewport()
      await page.getByLabel('输入续写', { exact: true }).check()
      await browserExpect(menu).toBeVisible()
      await page.getByLabel('显示方式', { exact: true }).selectOption('panel')
      await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
      await page.evaluate(() => { (window as any).fixture.setDraft('请解释这段代码的时间'); (window as any).fixture.focus() })
      await browserExpect(page.locator('.dsh-ia-candidate')).toBeVisible()
      expect(await surfaceContrast(page, '.dsh-ia-candidate')).toBeGreaterThanOrEqual(4.5)
      expect(await page.locator('.dsh-ia-candidate').evaluate(element => element.parentElement === document.body)).toBe(true)
      await page.getByRole('textbox', { name: '测试草稿' }).press('Tab')
      await browserExpect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText('请解释这段代码的时间复杂度。')
      await page.getByRole('button', { name: '优化', exact: true }).click()
      await browserExpect(page.locator('body > .dsh-ia-notice')).toBeVisible()
      expect(await surfaceContrast(page, 'body > .dsh-ia-notice')).toBeGreaterThanOrEqual(4.5)
      await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
      await page.screenshot({ path: `.test-runtime/web-theme/${theme}.png` })
    } finally { await page.close() }
  }, 20000)

  it('keeps the menu title and all controls reachable in a small clipped viewport', async () => {
    const page = await browser.newPage({ viewport: { width: 420, height: 340 } })
    try {
      await page.goto(url)
      await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
      await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
      const menu = page.locator('.dsh-ia-menu')
      await browserExpect(menu.getByText('输入助手', { exact: true })).toBeInViewport()
      const box = (await menu.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(11)
      expect(box.y + box.height).toBeLessThanOrEqual(329)
      expect(await menu.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
      await menu.getByText('辅助模型设置', { exact: true }).click()
      await menu.getByRole('button', { name: '保存模型设置', exact: true }).scrollIntoViewIfNeeded()
      await browserExpect(menu.getByRole('button', { name: '保存模型设置', exact: true })).toBeInViewport()
      await page.screenshot({ path: '.test-runtime/web-theme/small-dark.png' })
    } finally { await page.close() }
  }, 20000)

  it('aligns the ghost with the caret through a paint-contained composer', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } })
    try {
      await page.goto(url)
      await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
      await page.getByLabel('输入续写', { exact: true }).check()
      await page.getByRole('button', { name: '输入助手菜单', exact: true }).click()
      await page.evaluate(() => { (window as any).fixture.setDraft('请解释这段代码的时间'); (window as any).fixture.focus() })
      const ghost = page.locator('.dsh-ia-ghost')
      await browserExpect(ghost).toBeVisible()
      expect(await ghost.evaluate(element => element.parentElement === document.body)).toBe(true)
      const caret = await page.evaluate(() => {
        const range = window.getSelection()!.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        return { left: rect.left, top: rect.top }
      })
      const box = (await ghost.boundingBox())!
      expect(Math.abs(box.x - caret.left)).toBeLessThanOrEqual(2)
      expect(Math.abs(box.y - caret.top)).toBeLessThanOrEqual(2)
      await browserExpect(ghost).toBeInViewport()
      await page.evaluate(() => { document.getElementById('clipper')!.style.height = '20px'; window.dispatchEvent(new Event('resize')) })
      await browserExpect(ghost).toHaveCount(0)
      await page.evaluate(() => { document.getElementById('clipper')!.style.height = '160px'; window.dispatchEvent(new Event('resize')) })
      await browserExpect(ghost).toBeVisible()
      await page.getByRole('textbox', { name: '测试草稿' }).press('Tab')
      await browserExpect(page.getByRole('textbox', { name: '测试草稿' })).toHaveText('请解释这段代码的时间复杂度。')
    } finally { await page.close() }
  }, 20000)
})

describe('floating placement bounds', () => {
  it('clamps the menu to the actual visual viewport including mobile keyboard offsets', () => {
    const placed = placeFloating({ left: 380, top: 410, right: 416, bottom: 438, width: 36 }, 700,
      { left: 0, top: 120, width: 420, height: 340 })
    expect(placed.top).toBeGreaterThanOrEqual(132)
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(448)
    expect(placed.left).toBeGreaterThanOrEqual(12)
    expect(placed.left + placed.width).toBeLessThanOrEqual(408)
  })
})
