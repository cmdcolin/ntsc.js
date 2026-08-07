// What does a tab actually run out of, when a WebGPU page stops being given
// animation frames?
//
// Not devices. This measures the four cases that separate the possibilities, and
// the answer is that **destroying a GPUDevice that has been presenting ends the
// tab's rendering step** — permanently, and the next document loaded in that tab
// inherits it. Creating devices, holding several open, and destroying ones that
// never presented all cost nothing.
//
//   node scripts/devicetear.mjs [--arm=all|hold|cycle|reload] [--n=4] [--ms=1000]
//
//   hold    create N devices, present with each, keep them all open.
//           Expected: no loss. Creating and holding is free.
//   cycle   one document, N rounds of {device + swapchain + present + destroy}.
//           Expected: dead by round 2, with no reload anywhere in sight.
//   reload  the same presenting page loaded N times in one tab, in three
//           variants: destroying the device on `pagehide`, abandoning it, and
//           never presenting at all.
//           Expected: destroy dies from load 2 and stays dead; abandon survives
//           every load; nopresent survives. This is the arm that explains why
//           refreshing was unsafe — the app used to do the destroy itself.
//
// Serves its own page, so it needs nothing from this repo and can be handed
// upstream as a bug report unchanged. Each arm gets a fresh browser: a dead tab
// cannot be reused, and one run took the whole browser process with it.
//
// See docs/adr/0004. If a future Firefox makes the `destroy` variants survive,
// this is the file that says so.

import puppeteer from 'puppeteer-core'

import { createServer } from 'node:http'

const flags = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = flags.find(f => f.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const arm = flag('arm', 'all')
const N = Number(flag('n', '4'))
const PRESENT_MS = Number(flag('ms', '1000'))

// One page, three behaviours, chosen by query string so a reload is a whole round
// on its own. `present` draws through a real render pass rather than only calling
// getCurrentTexture: a swapchain the compositor has never been handed is not the
// thing under test.
const HTML = `<!doctype html><title>devicetear</title>
<body style="background:#111;color:#eee;font:13px monospace"><div id=o>ready</div>
<script>
let raf = 0
const tick = () => { raf += 1; requestAnimationFrame(tick) }
requestAnimationFrame(tick)
window.rafCount = () => raf
window.kept = []
const say = m => { document.getElementById('o').textContent = m }

// A device, optionally presenting for \`ms\`, then let go of in one of two ways.
window.round = async ({ present = true, destroy = true, ms = 1000, atUnload = false } = {}) => {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  const device = await adapter.requestDevice()
  if (!present) {
    if (atUnload) addEventListener('pagehide', () => device.destroy())
    else if (destroy) device.destroy()
    say('device, never presented')
    return 0
  }
  const cv = document.createElement('canvas')
  cv.width = 480; cv.height = 320
  document.body.appendChild(cv)
  const ctx = cv.getContext('webgpu')
  ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })
  let frames = 0
  const draw = () => {
    const view = ctx.getCurrentTexture().createView()
    const enc = device.createCommandEncoder()
    const pass = enc.beginRenderPass({ colorAttachments: [{
      view,
      clearValue: { r: (frames % 60) / 60, g: 0.2, b: 0.5, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }] })
    pass.end()
    device.queue.submit([enc.finish()])
    frames += 1
    say('presented ' + frames)
  }
  // Two shapes of presenting: for a bounded round, draw for \`ms\` and stop; for a
  // page that lives until unload, keep drawing like a real app does.
  if (atUnload) {
    const loop = () => { draw(); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    if (destroy) addEventListener('pagehide', () => device.destroy())
    return -1
  }
  const t0 = performance.now()
  await new Promise(done => {
    const loop = () => {
      if (performance.now() - t0 > ms) { done(); return }
      draw()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  if (destroy) { device.destroy(); cv.remove() }
  else window.kept.push({ device, cv, ctx })
  return frames
}

// The reload variants drive themselves on load, so a plain reload is a round.
const auto = new URLSearchParams(location.search).get('auto')
if (auto !== null) {
  window.__auto = window.round({
    present: auto !== 'nopresent',
    destroy: auto !== 'abandon',
    atUnload: true,
  })
}
</script></body>`

const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(HTML)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const wait = ms => new Promise(r => setTimeout(r, ms))
const verdicts = []

const launch = () =>
  puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
    },
  })

// rAF delivered over 1.5 s. Zero from a visible tab is the failure this whole
// file is about: the page is fine, the browser has stopped scheduling it.
const rate = async page => {
  const a = await page.evaluate(() => window.rafCount())
  await wait(1500)
  const b = await page.evaluate(() => window.rafCount())
  return b - a
}

const line = (label, n, r, extra = '') =>
  console.log(
    `${label.padEnd(18)} ${String(n).padStart(2)}: ${String(r).padStart(3)} rAF/1.5s ${extra}${r === 0 ? '  *** rAF STOPPED ***' : ''}`,
  )

// Everything in one document: rounds of create/present/tear-down, or a pile of
// devices left open, depending on `destroy`.
const inOneDocument = async (label, destroy) => {
  let browser
  let died = 0
  try {
    browser = await launch()
    const page = await browser.newPage()
    await page.setViewport({ width: 700, height: 520 })
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: 'domcontentloaded',
    })
    await page.bringToFront()
    await wait(1000)
    for (let i = 1; i <= N; i++) {
      const frames = await page.evaluate(
        (d, ms) => window.round({ destroy: d, ms }),
        destroy,
        PRESENT_MS,
      )
      const r = await rate(page)
      line(label, i, r, `(presented ${frames})`)
      if (r === 0 && died === 0) died = i
    }
  } catch (e) {
    // A wedged tab stops answering BiDi, so the arm ending early *is* a result.
    console.log(`${label.padEnd(18)}  ended early: ${String(e).slice(0, 70)}`)
    if (died === 0) died = -1
  } finally {
    await browser?.close().catch(() => {})
    await wait(500)
  }
  verdicts.push(
    died === 0
      ? `${label}: survived ${N} rounds`
      : `${label}: lost the tab at round ${died === -1 ? '?' : died}`,
  )
}

// A document boundary between every round, which is what a reload is.
const acrossReloads = async auto => {
  let browser
  let died = 0
  try {
    browser = await launch()
    const page = await browser.newPage()
    await page.setViewport({ width: 700, height: 520 })
    const url = `http://127.0.0.1:${port}/?auto=${auto}`
    for (let i = 1; i <= N; i++) {
      if (i === 1) await page.goto(url, { waitUntil: 'domcontentloaded' })
      else await page.reload({ waitUntil: 'domcontentloaded' })
      await page.bringToFront()
      await wait(PRESENT_MS + 1000)
      const r = await rate(page)
      line(`reload:${auto}`, i, r)
      if (r === 0 && died === 0) died = i
    }
  } catch (e) {
    console.log(
      `reload:${auto}`.padEnd(18) + `  ended early: ${String(e).slice(0, 70)}`,
    )
    if (died === 0) died = -1
  } finally {
    await browser?.close().catch(() => {})
    await wait(500)
  }
  verdicts.push(
    died === 0
      ? `reload:${auto}: survived ${N} loads`
      : `reload:${auto}: lost the tab at load ${died === -1 ? '?' : died}`,
  )
}

if (arm === 'all' || arm === 'hold') await inOneDocument('hold', false)
if (arm === 'all' || arm === 'cycle') await inOneDocument('cycle', true)
if (arm === 'all' || arm === 'reload') {
  for (const auto of ['destroy', 'abandon', 'nopresent']) {
    await acrossReloads(auto)
  }
}

console.log('\n--- verdict ---')
for (const v of verdicts) console.log(' ', v)
console.log(
  '\nExpected on Firefox Nightly / Linux: only the arms that DESTROY a device which',
)
console.log(
  'has been presenting lose the tab. See docs/adr/0004 for what the app does about it.',
)
server.close()
