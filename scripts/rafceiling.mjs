import puppeteer from 'puppeteer-core'

// How many times can one tab load a WebGPU page before Firefox stops giving it
// animation frames?
//
// It used to be two. The third load got a working GPUDevice, rendered nothing, and
// `requestAnimationFrame` was never called again for that tab — on a tab that
// reported `visible` throughout, and across further reloads. That was the "needs
// the tab closed, not reloaded" freeze this whole line of work started from.
//
// The cause turned out not to be the count: **destroying a device that has been
// presenting** ends the tab's rendering step, and the app was doing that on
// `pagehide`. It no longer does (docs/adr/0004, scripts/devicetear.mjs), so the app
// arm below is now a **regression test**: it takes 8 loads in one tab at
// 69-81 rAF/1.5s with `firstDeadSession: null`. If it starts dying again, something
// has started handing devices back.
//
// The control is the point. A static page whose entire content is a rAF counter
// takes the same reloads at the same cadence in the same browser and never drops
// a frame, so this is not "reloading fast breaks rAF" and not the harness losing
// the window. Only a page that handed a presenting GPUDevice back ever died.
//
//   node scripts/rafceiling.mjs [--port=5199] [--cycles=8] [--gap=7000]
//                               [--page=app|control]
//
// `--gap` spaces the reloads out. Back when this died, 30000 failed identically to
// 7000 — which ruled out a rate and pointed at a count, and the count turned out to
// be counting teardowns.
//
// The app arm carries `gpubudget=ignore` so that what it measures is the browser
// and never the app's own gate: a tab that has destroyed a presenting device is
// declined its next one and shown a screen offering a new tab instead (see
// outOfGpuBudget in src/core/gpu/context.ts). A page that never asks for a device cannot
// demonstrate anything about devices, and this harness's whole job is to ask.
// Belt and braces now — the gate no longer counts creations, and this arm destroys
// nothing — but the flag is what keeps the measurement independent of app policy.
import { createServer } from 'node:http'

const flags = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = flags.find(f => f.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const devPort = flag('port', '5199')
const cycles = Number(flag('cycles', '8'))
const gap = Number(flag('gap', '7000'))
const which = flag('page', 'app')

// Served from here rather than from the app's own `public/`, so the control
// shares nothing with the app but the browser and the tab — and so this file is
// a complete reproducer on its own if it is ever handed to someone upstream.
const CONTROL_HTML = `<!doctype html><title>raf probe</title>
<body style="background:#111;color:#eee;font:14px monospace"><div id=o>starting</div>
<script>
let n = 0, t0 = performance.now()
const step = () => {
  n += 1
  document.getElementById('o').textContent = n + ' rAF in ' + Math.round(performance.now() - t0) + 'ms'
  requestAnimationFrame(step)
}
requestAnimationFrame(step)
</script></body>`

const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(CONTROL_HTML)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const controlUrl = `http://127.0.0.1:${server.address().port}/`
const url =
  which === 'control'
    ? controlUrl
    : `http://localhost:${devPort}/?gpubudget=ignore&set=fbMix:0.3,phosphor:0.5`

const t0 = Date.now()
const at = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4)
const log = m => console.log(`${at()}s ${m}`)
const settle = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 640 })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.bringToFront()
await settle(5000)

// Raw delivery, counted by the page's own requestAnimationFrame so the app's
// bookkeeping cannot flatter it — the fallback pump advances the frame counter
// on a tab getting no callbacks at all, which is how this stayed hidden.
// `visibilityState` rides along because a covered window reads hidden here and
// would explain a dead rAF with no bug in it.
const rafRate = () =>
  page
    .evaluate(
      () =>
        new Promise(res => {
          let n = 0
          const t = performance.now()
          const step = () => {
            n += 1
            if (performance.now() - t < 1500) requestAnimationFrame(step)
            else res({ n, vis: document.visibilityState })
          }
          requestAnimationFrame(step)
          setTimeout(() => res({ n, vis: document.visibilityState }), 2500)
        }),
    )
    .catch(e => ({ dead: String(e).slice(0, 100) }))

const rows = []
let firstDead = null
for (let i = 0; i <= cycles; i++) {
  if (i > 0) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(Math.max(0, gap - 2500))
  }
  const r = await rafRate()
  rows.push({ session: i + 1, ...r })
  if (r.dead === undefined && r.n < 5 && firstDead === null) firstDead = i + 1
  log(
    `${which} session ${String(i + 1).padStart(2)}: ${String(r.n ?? '?').padStart(3)} rAF/1.5s  vis=${r.vis ?? '?'}${r.dead ? ` DEAD ${r.dead}` : ''}${(r.n ?? 99) < 5 ? '   *** rAF STOPPED ***' : ''}`,
  )
  if (
    rows.slice(-3).length === 3 &&
    rows.slice(-3).every(x => (x.n ?? 0) < 5)
  ) {
    log('!! three dead sessions running — stopping')
    break
  }
}

console.log('\n===== RESULT =====')
console.log(
  JSON.stringify(
    {
      page: which,
      gapMs: gap,
      sessionsRun: rows.length,
      firstDeadSession: firstDead,
      rows,
    },
    null,
    1,
  ),
)
await browser.close().catch(() => {})
server.close()
