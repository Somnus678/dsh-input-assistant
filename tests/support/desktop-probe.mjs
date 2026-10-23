/**
 * Test-only plugin for the CURRENT desktop Host. No imported DSH/React copies,
 * no credentials, no Agent, and no generation endpoints. Loaded only through a
 * temporary, UUID-labelled profile patch by run-desktop-probe.mjs.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'input-assistant-desktop-probe'
export const inject = ['inputAssistant', 'typertGateway', 'connection', 'sessions', 'loader']

const cache = resolve(fileURLToPath(new URL('../../', import.meta.url)), '.test-runtime')
const allowed = new Set(['settings/get', 'status', 'drafts/list', 'drafts/save', 'drafts/delete', 'drafts/clear'])

export async function apply(ctx, config) {
  const reportPath = resolve(config.reportPath)
  if (!reportPath.startsWith(cache + sep) || !/desktop-probe-[a-f0-9-]+/i.test(reportPath.slice(cache.length + 1))) {
    throw new Error('Probe report must stay inside its workspace cache')
  }
  const report = {
    kind: 'current-desktop-profile-hotload', probeVersion: 1,
    pid: process.pid, ppid: process.ppid, execPath: process.execPath,
    startedAt: new Date().toISOString(), operations: [], checks: {},
    generatedRequests: 0, cleaned: false, passed: false,
  }
  let session
  let detach
  let peer
  const call = async (method, data) => {
    assert(allowed.has(method), 'Probe cannot invoke a generation or settings mutation endpoint')
    report.operations.push(method)
    return ctx.typertGateway.invoke({
      namespace: 'input-assistant', method: 'call', args: { payload: { method, data } }, peer,
    })
  }
  try {
    const production = [...ctx.loader.entries()].filter(entry => entry.options.name === 'dsh-input-assistant')
    assert.equal(production.length, 1, 'Exactly one production bundle entry must be active')
    assert(production[0].fiber, 'Production entry must own a live fiber')
    assert(ctx.inputAssistant instanceof production[0].moduleNamespace.InputAssistantService,
      'Injected service must come from the actually loaded production entry')
    report.loadedService = { entryId: production[0].id, packageName: production[0].options.name,
      moduleName: production[0].moduleNamespace.name, installedVersion: config.installedVersion,
      installedMainSha256: config.installedMainSha256 }
    report.checks.productionServiceIdentity = true
    // enter without announce: no Agent, user session publication or model request.
    session = ctx.sessions.prepare(`input-assistant-probe-${randomUUID()}`)
    detach = ctx.sessions.enter(session)
    peer = ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
    const initialSeq = session.seq
    const settings = await call('settings/get', {})
    assert.equal(settings.nextEnabled, false, 'Quiet configuration is required')
    assert.equal(settings.completionEnabled, false, 'Quiet configuration is required')
    report.checks.quietSettings = true
    const status = await call('status', { sessionId: session.id })
    assert.equal(status.running, false)
    assert.equal(status.sourceTurnId, null)
    assert.equal(typeof status.generation, 'string')
    report.checks.emptySessionStatus = true
    assert.deepEqual(await call('drafts/list', { sessionId: session.id }), [])
    const text = '桌面宿主零 token 探测 😀\n只读状态与独立草稿'
    const saved = await call('drafts/save', { sessionId: session.id, text })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].text, text)
    assert.deepEqual(await call('drafts/list', { sessionId: session.id }), saved)
    report.checks.durableDraftRoundTrip = true
    assert.deepEqual(await call('drafts/delete', { sessionId: session.id, id: saved[0].id }), [])
    assert.deepEqual(await call('drafts/list', { sessionId: session.id }), [])
    report.checks.singleDelete = true
    await call('drafts/save', { sessionId: session.id, text: '待清理的测试草稿' })
    assert.deepEqual(await call('drafts/clear', { sessionId: session.id }), [])
    assert.deepEqual(await call('drafts/list', { sessionId: session.id }), [])
    report.checks.clearDrafts = true
    assert.equal(session.seq, initialSeq, 'The probe must not append to even its temporary conversation')
    report.checks.noSessionEvents = true
    report.passed = true
  } catch (error) {
    // Never serialize arbitrary nested provider/storage diagnostics.
    report.error = { name: error?.name ?? 'Error', code: error?.code ?? 'PROBE_FAILED',
      message: error?.name === 'AssertionError' ? String(error.message).slice(0, 800) : 'Desktop host probe failed; inspect its non-sensitive runtime diagnostics.' }
  } finally {
    let cleared = !session
    let detached = !detach
    let peerDisposed = !peer
    if (session && peer) {
      try {
        await call('drafts/clear', { sessionId: session.id })
        cleared = (await call('drafts/list', { sessionId: session.id })).length === 0
      } catch { /* Cleanup failure is reported, never hidden by a success. */ }
    }
    if (detach) {
      try { detach(); detached = ctx.sessions.get(session.id) === undefined } catch { /* reported */ }
    }
    if (peer) {
      try { await peer.dispose(); peerDisposed = true } catch { /* reported */ }
    }
    report.cleanup = { cleared, detached, peerDisposed }
    report.cleaned = cleared && detached && peerDisposed
    report.passed &&= report.cleaned
    report.finishedAt = new Date().toISOString()
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  }
}
