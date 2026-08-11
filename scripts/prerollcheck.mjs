// Does loading the next clip during this one make the cut cheaper?
//
//   node scripts/prerollcheck.mjs [port]
//
// Preroll depth 1 (docs/EDITOR.md › _Performance: the boundary is the only
// cost_). Steady-state playback does not care how long a rundown is — the pump
// yields one decode per newly decoded source frame whatever is attached — so
// all of the cost is at the cut: a new element, the network, the first frame.
// A second element already loaded and parked at its in-point is that cost paid
// during the bar before it.
//
// So the measurement is the cut, and it is taken twice over the same clip on
// the same deck: once cold, once with the clip prerolled. What is timed is
// `playUrl` to the element being ready to show a frame — `readyState >= 2`,
// which is HAVE_CURRENT_DATA, the first moment there is a picture to attach.
//
// **The cold arm has to be genuinely cold**, and that is most of what this file
// is careful about: a browser that has already fetched a url serves the second
// load out of its HTTP cache, which would make both arms fast and the check
// meaningless. Each arm therefore uses its own url with a cache-busting query,
// so the two are the same bytes and different cache entries.

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

import process from 'node:process'

const port = process.argv[2] ?? '5199'

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  protocolTimeout: 240_000,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await appUp(page, 6000)
await page.bringToFront()

// One cut, timed. `warm` prerolls first and waits for it to park; both arms
// then time the same `playUrl` the app itself calls at a row boundary.
const cut = warm =>
  page.evaluate(async isWarm => {
    const { playUrl, prerollUrl, stopSlot, dropPreroll } =
      await import('/src/ui/videoSlot.ts')
    // A slot standing in for a deck: the same shape `useEngine.makeSlot` builds,
    // with the engine and React ends stubbed. What is under test is
    // videoSlot.ts, and handing it a real deck would be timing the panel too.
    const ref = { current: null }
    const next = { current: null }
    const slot = {
      id: 'a',
      ref,
      next,
      // Never armed here — this harness times the cut, not the loop — but the
      // field has to exist, because `stopSlot` retires a second read head on the
      // way past. A double that is missing one of the slot's refs fails inside
      // videoSlot.ts, where it reads as a bug in the thing under test.
      head: { current: null },
      typer: { current: null },
      rate: () => 1,
      attach: () => {},
      setImage: () => {},
      setNoise: () => {},
      setLive: () => {},
      setYtUrl: () => {},
      setName: () => {},
      card: () => null,
      setCard: () => {},
      onError: () => {},
      clearCue: () => {},
      release: () => {},
      adopt: () => {},
    }
    // Same bytes, different cache entry per arm — see the header.
    const url = `${new URL('/test.mp4', location.href).href}?arm=${isWarm ? 'warm' : 'cold'}`
    const ready = el =>
      new Promise(resolve => {
        if (el.readyState >= 2) return resolve()
        el.addEventListener('loadeddata', () => resolve(), { once: true })
      })

    if (isWarm) {
      await prerollUrl(slot, url, 0)
      // Parked, at the in-point, and attached to nothing — the three things a
      // preroll claims before the cut it is for.
      if (next.current === null) return { parked: false }
    }
    const parkedEl = next.current?.el ?? null
    const began = performance.now()
    playUrl(slot, url)
    await ready(ref.current)
    const ms = performance.now() - began
    // Was the cut a swap, or a load? The identity of the element on the slot
    // answers it exactly, where the timing only suggests it.
    const swapped = parkedEl !== null && ref.current === parkedEl
    stopSlot(slot)
    dropPreroll(slot)
    return { ms, swapped, parked: true, spent: next.current === null }
  }, warm)

const cold = await cut(false)
const warm = await cut(true)

check('a preroll parks an element the slot can promote', warm.parked)
check(
  'and the cut promotes that very element rather than making one',
  warm.swapped === true && cold.swapped === false,
  `warm swapped ${warm.swapped}, cold ${cold.swapped}`,
)
check(
  'the promotion spends the preroll, so depth stays 1',
  warm.spent === true,
  `next is ${warm.spent ? 'empty' : 'still holding'}`,
)
// The point of the whole feature, and the one arm that is a measurement rather
// than an identity. Generous on purpose: what is being claimed is that the cut
// stopped paying for the load, not a particular number of milliseconds — the
// clip is small and served from localhost, which is the *least* favourable
// case this could be measured in, and it still separates.
check(
  'and a promoted cut is quicker than a cold one',
  warm.ms < cold.ms,
  `${warm.ms.toFixed(1)}ms warm vs ${cold.ms.toFixed(1)}ms cold`,
)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\npreroll ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
