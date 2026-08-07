import puppeteer from 'puppeteer-core'

// How many WebGPU sessions can one tab create before Firefox stops giving it
// animation frames?
//
// On this box the answer is two. The third one loads, gets a working GPUDevice,
// renders nothing, and `requestAnimationFrame` is never called again for that
// tab — on a tab that reports `visible` throughout. It does not recover, and it
// survives further reloads, which is exactly the "needs the tab closed, not
// reloaded" freeze this whole line of work started from.
//
// The control is the point. A static page whose entire content is a rAF counter
// takes the same reloads at the same cadence in the same browser and never drops
// a frame, so this is not "reloading fast breaks rAF" and not the harness losing
// the window. Only the page holding a GPUDevice dies.
//
//   node scripts/rafceiling.mjs [--port=5199] [--cycles=8] [--gap=7000]
//                               [--page=app|control]
//
// `--gap` spaces the reloads out; 30000 fails identically to 7000, so the
// ceiling is a count of sessions and not a rate.
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
    : `http://localhost:${devPort}/?set=fbMix:0.3,phosphor:0.5`

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
