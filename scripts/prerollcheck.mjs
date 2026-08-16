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

// --- and the same cut for a clip off the shelf --------------------------------
//
// The arms above preroll a *url*, which is what a `?vurl` row and a bundled clip
// are. A shelf clip is neither, and it is what an ordinary rundown of footage is
// made of — so this asks the one question that decides whether preroll reaches
// it at all: **is the url stable?**
//
// It is not, and that is a browser fact rather than a design choice.
// `URL.createObjectURL` mints a fresh string per call, so the File a preroll
// opens and the File a cut opens are two urls for one file, and `playUrl`'s
// identity match — which every other source satisfies for free — can never fire.
// Every cut between two shelf clips therefore loaded from scratch beside an
// element already holding the picture: preroll paying its whole cost and buying
// nothing. `Preroll.clip` is the identity that survives that, and `prerolledClip`
// is how a cut asks which url to open under.
//
// A Blob rather than a picked File, deliberately: what is under test is the
// url minting and the promotion, and a real disk handle would drag the shelf's
// IndexedDB and a permission prompt into a harness that is timing a cut.
const shelfCut = await page.evaluate(async () => {
  const { playUrl, prerollUrl, prerolledClip, stopSlot, dropPreroll } =
    await import('/src/ui/videoSlot.ts')
  const ref = { current: null }
  const next = { current: null }
  const slot = {
    id: 'a',
    ref,
    next,
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
  const file = new File(
    [await (await fetch('/test.mp4')).arrayBuffer()],
    'shelf.mp4',
    { type: 'video/mp4' },
  )
  // The fact the whole mechanism turns on, asserted rather than assumed.
  const twice = [URL.createObjectURL(file), URL.createObjectURL(file)]
  for (const u of twice) URL.revokeObjectURL(u)

  await prerollUrl(slot, URL.createObjectURL(file), 0, 'c7')
  const parkedEl = next.current?.el ?? null
  // What the cut asks before it opens anything — the whole of the addition.
  const under = prerolledClip(slot, 'c7')
  const wrongClip = prerolledClip(slot, 'c9')
  playUrl(slot, under ?? URL.createObjectURL(file))
  await new Promise(resolve => {
    if (ref.current.readyState >= 2) return resolve()
    ref.current.addEventListener('loadeddata', () => resolve(), { once: true })
  })
  const swapped = parkedEl !== null && ref.current === parkedEl
  stopSlot(slot)
  dropPreroll(slot)
  return { sameUrl: twice[0] === twice[1], under, wrongClip, swapped }
})

check(
  'one file opened twice is two urls, so a url cannot identify a shelf clip',
  shelfCut.sameUrl === false,
)
check(
  'a preroll records which shelf clip it parked',
  typeof shelfCut.under === 'string' && shelfCut.under.startsWith('blob:'),
  `answered ${String(shelfCut.under)}`,
)
check(
  'and answers nothing for a clip it is not holding',
  shelfCut.wrongClip === null,
)
check(
  'so a shelf clip’s cut promotes the parked element too',
  shelfCut.swapped === true,
)

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(fail.length === 0 ? '\npreroll ok' : `\n${fail.length} failed`)
process.exit(fail.length === 0 ? 0 : 1)
