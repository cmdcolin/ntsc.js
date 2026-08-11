// Verification harness for the two public archives: does a random pick roll a
// file, does the ★ put it on the clip shelf, does the shelf play it back, does
// the browser dialog come back with thumbnails from both, and is a roll that
// lands late dropped rather than pushed onto a slot the user has moved on from.
//
// Usage: node scripts/poolcheck.mjs [http://localhost:5199]
//
// Unlike every other harness here this one talks to third parties. That is the
// point of it: `src/sources/commons.test.ts` and `archive.test.ts` hold the
// readers against response shapes that were real *once*, and nothing in the test
// suite would notice commons.wikimedia.org changing its mind about
// `descriptionurl`, dropping `gsrsort=random`, or rendering its transcode ladder
// differently — nor archive.org retiring `services/img/`, which is the endpoint
// the whole browser dialog leans on to show a clip without downloading it.
// A handful of live requests per run, well inside anonymous API etiquette.
//
// It exits non-zero with a line per failed check, so it can be run as a gate. A
// network failure reads as a failure — there is no useful "skipped" here, since
// the whole subject is the network.

import puppeteer from 'puppeteer-core'

// Waiting on the archives rather than on a duration — see until.mjs.
import { appUp, until } from './until.mjs'

const base = (process.argv[2] ?? 'http://localhost:5199').replace(/\/$/, '')
const wait = ms => new Promise(r => setTimeout(r, ms))
const failures = []
const check = (ok, what, saw) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — saw ${saw}`}`)
  if (!ok) failures.push(what)
}

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
// Viewport before goto, never after: see the traps list in docs/DEVELOPMENT.md.
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 950 })
page.on('pageerror', e => {
  const text = String(e).slice(0, 300)
  console.log(`[pageerror] ${text}`)
  failures.push(`pageerror: ${text}`)
})

// **The panel mounts one stage at a time, and Source A's is shut on arrival.**
// Everything this file reads — the picker, the caption under it, the ★, the
// credit link — is inside that stage, so with it shut `state()` answers null to
// all of them and every check below fails at once, which is what this harness
// did until it learned to open it. The chain map's boxes are `<g role=button>`;
// clicking the element rather than a coordinate keeps this independent of the
// diagram's layout. Same approach as `sourcecheck.ensureDeck`.
//
// Idempotent, and asks before it clicks, because the box *toggles*: calling it
// when the stage is already open would shut it.
const ensureSourceA = async () => {
  for (let i = 0; i < 3; i++) {
    const there = await page.evaluate(() =>
      [...document.querySelectorAll('select')].some(s =>
        [...s.options].some(o => o.value === 'wiki-random'),
      ),
    )
    if (there) return true
    const clicked = await page.evaluate(() => {
      const g = [...document.querySelectorAll('g[role=button]')].find(e =>
        (e.textContent ?? '').trim().toLowerCase().startsWith('source a'),
      )
      if (!g) return false
      g.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      )
      return true
    })
    if (!clicked) return false
    await wait(600)
  }
  return false
}

// A's picker, found by what it offers rather than by position: the panel holds
// several <select>s and which one comes first is a layout detail.
const pickA = mode =>
  page.evaluate(m => {
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => o.value === 'wiki-random'),
    )
    if (sel === undefined) throw new Error('no source picker on the page')
    sel.value = m
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }, mode)

const state = () =>
  page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => o.value === 'wiki-random'),
    )
    const buttons = [...document.querySelectorAll('button')]
    // The caption under the picker, whichever of the two draws it: a rolled or
    // browsed source gets FileName's, a slot on the shelf gets the ClipPicker
    // menu's trigger. Both name the picture that is up, which is all this wants.
    const caption = buttons.find(
      b =>
        b.title.includes('roll another') ||
        b.title.includes('search again') ||
        b.title.includes('the rest of the shelf'),
    )
    const star = buttons.find(
      b => b.textContent === '☆' || b.textContent === '★',
    )
    const link = [...document.querySelectorAll('a')].find(
      a => a.textContent === '↗',
    )
    // Bars are seven flat blocks; a photograph is not. Counting distinct colours
    // along one line separates them without knowing which file rolled.
    const cv = document.querySelector('canvas')
    const oc = new OffscreenCanvas(cv.width, cv.height)
    const g = oc.getContext('2d')
    g.drawImage(cv, 0, 0)
    const row = g.getImageData(0, Math.round(cv.height * 0.3), cv.width, 1).data
    const shades = new Set()
    for (let i = 0; i < row.length; i += 4)
      shades.add(`${row[i] >> 5}.${row[i + 1] >> 5}.${row[i + 2] >> 5}`)
    const shelf = JSON.parse(localStorage.getItem('ntsc.js.clips') ?? '{}')
    return {
      mode: sel?.value ?? null,
      // The shelf's trigger reads the clip's name and nothing else; FileName's
      // reads the same. Trimmed because the menu's is a block with whitespace.
      caption: caption?.textContent?.trim() ?? null,
      star: star?.textContent ?? null,
      link: link?.href ?? null,
      shades: shades.size,
      kept: (shelf.clips ?? []).filter(c => c.at && c.at !== 'disk'),
    }
  })

const clickTitled = match =>
  page.evaluate(m => {
    const b = [...document.querySelectorAll('button')].find(x =>
      x.title.includes(m),
    )
    b?.click()
    return b !== undefined
  }, match)

// A button inside whichever dialog is open, by exactly what it reads. Two
// presses with a beat between them, never one evaluate: switching tab
// re-renders the preset row, so a node found before the click is one React has
// already thrown away.
const press = label =>
  page.evaluate(text => {
    const dlg = document.querySelector('dialog[open]') ?? document
    const hit = [...dlg.querySelectorAll('button')].find(
      b => b.textContent?.trim() === text,
    )
    if (!hit) return `no button reading ${text}`
    hit.click()
    return 'ok'
  }, label)

// A roll that has landed. The caption is the app saying so: empty while there
// is nothing, one of the two in-flight words while there is a request out, and
// the file's own name once it is back.
//
// **Waited for rather than slept through, and this is the file with the most to
// gain from it** — every roll below is a live fetch against Wikimedia or
// archive.org, so the six-second sleeps these replace were guesses about
// somebody else's network, and a slow archive read as "the picker moved off the
// source". A generous budget rather than the old sleep, because here the thing
// being waited for genuinely can take that long, and the check still fails with
// the caption it saw if the archive is actually down.
//
// This file already argued the point in one arm — `captionsUntilSettled` below
// polls, because that is the arm whose flakiness got noticed. Same answer, now
// applied to the three that had the same problem more quietly.
const ROLL_MS = 15000
const settled = c =>
  c !== null &&
  c !== '' &&
  !c.startsWith('rolling…') &&
  !c.startsWith('fetching…')
const caption = () => state().then(s => s.caption)

// ── a random source rolls, and says what it rolled ───────────────────────────
await page.goto(`${base}/?src=wiki-random`, { waitUntil: 'networkidle0' })
check(
  await ensureSourceA(),
  "source A's stage opens, so its picker is on screen",
)
await until(caption, settled, { budget: ROLL_MS, every: 250 })
let now = await state()
check(now.mode === 'wiki-random', 'the picker stays on the source', now.mode)
check(
  now.caption !== null && now.caption !== '' && now.caption !== 'rolling…',
  'the roll landed and the caption names it',
  JSON.stringify(now.caption),
)
check(
  (now.link ?? '').startsWith('https://commons.wikimedia.org/wiki/File'),
  'the credit link points at the file page',
  now.link,
)
check(now.star === '☆', 'an unkept roll offers the star', now.star)

// ── ★ puts it on the clip shelf, and the next roll does not take it away ─────
const kept = now.caption
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.textContent === '☆')
    ?.click()
})
await wait(400)
now = await state()
check(now.star === '★', 'the star lights', now.star)
check(
  now.kept.length === 1 && now.kept[0].at === 'commons',
  'the shelf holds it, filed under the archive it came from',
  JSON.stringify(now.kept),
)
check(
  now.kept[0]?.ref?.startsWith('File:') === true && now.kept[0]?.size === 0,
  'it is stored as a title and not a copy',
  JSON.stringify(now.kept[0]),
)

await clickTitled('roll another')
// A *different* file, settled — which is also the assertion below, so waiting
// for it is waiting for the roll to finish rather than for it to succeed: a
// pool that hands back the same file twice still fails, 15s later, saying so.
await until(caption, c => settled(c) && c !== kept, {
  budget: ROLL_MS,
  every: 250,
})
now = await state()
check(now.caption !== kept, 'clicking the caption rolls a different file', kept)
check(now.star === '☆', 'the new roll is not kept', now.star)
check(
  now.kept.length === 1,
  'the shelf still holds the kept one',
  now.kept.length,
)

// ── the shelf plays it back ──────────────────────────────────────────────────
await pickA('library')
await wait(1500)
const shelf = await page.evaluate(() => {
  const d = document.querySelector('dialog[open]')
  return {
    heads: [...(d?.querySelectorAll('*') ?? [])]
      .filter(e => e.children.length === 0)
      .map(e => e.textContent?.trim())
      .filter(t => t?.startsWith('kept from')),
    rows: [...(d?.querySelectorAll('button') ?? [])].filter(b =>
      b.title.startsWith('play '),
    ).length,
  }
})
check(
  shelf.rows === 1 && shelf.heads.length === 1,
  'the shelf lists it under its own heading',
  JSON.stringify(shelf),
)
await page.evaluate(() => {
  const d = document.querySelector('dialog[open]')
  ;[...(d?.querySelectorAll('button') ?? [])]
    .find(b => b.title.startsWith('play '))
    ?.click()
})
// The kept one coming back by name — a resolve rather than a roll, but the same
// live round trip, and the same caption saying when it has landed.
await until(caption, c => c === kept, { budget: ROLL_MS, every: 250 })
now = await state()
check(
  now.mode === 'library' && now.caption === kept,
  'a kept roll comes back by name, on the shelf entry',
  `${now.mode} / ${JSON.stringify(now.caption)}`,
)
check(now.star === '★', 'and it is still kept', now.star)

// ── the browser searches both, and shows what it found ───────────────────────
// The dialog's whole claim is that you can look before you pick, which rests on
// two endpoints nobody here controls: Commons rendering a poster frame for a
// clip at `iiurlwidth`, and archive.org answering `services/img/<id>` for a bare
// identifier. Either going away turns the grid into a page of empty boxes, and
// nothing else would notice.
await pickA('browse')
await wait(1200)
for (const tab of [
  { name: 'Wikimedia Commons', preset: 'Marble busts' },
  { name: 'archive.org', preset: 'Tape openings' },
]) {
  const onTab = await press(tab.name)
  await wait(500)
  const ran = onTab === 'ok' ? await press(tab.preset) : onTab
  if (ran !== 'ok') {
    check(false, `the browser offers ${tab.name} / ${tab.preset}`, ran)
    continue
  }
  // Polled to a deadline rather than slept at: the search itself is fast on
  // Commons and has been measured stalling for tens of seconds on archive.org,
  // and then two dozen images load off a third origin behind it. A fixed wait
  // long enough for the bad case wastes half a minute in the good one, and one
  // sized for the good case reports an upstream that was merely slow as an
  // upstream that is gone.
  let grid = { results: 0, loaded: 0, first: '' }
  for (let waited = 0; waited < 25_000 && grid.loaded === 0; waited += 1000) {
    await wait(1000)
    grid = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('dialog[open] img')]
      return {
        results: imgs.length,
        loaded: imgs.filter(i => i.naturalWidth > 0).length,
        first: imgs[0]?.src.slice(0, 80) ?? '',
      }
    })
  }
  check(
    grid.loaded > 0,
    `${tab.name} answers the browser with thumbnails`,
    `${grid.loaded}/${grid.results} loaded, first ${grid.first || '(none)'}`,
  )
}
await press('close')
await wait(400)

// ── the download says how big it is, and how far it has got ─────────────────
// archive.org is the one source that makes you wait with no picture, so the
// caption is the only thing standing between a working pick and a hung one. Two
// things have to survive: the size arrives *before* the bytes, off the metadata
// read, and the readout moves. A revert to `r.blob()` would keep the clip
// working and quietly take both away, which nothing else here would notice.
// The caption alone, not `state()`: that one reads the canvas back through an
// OffscreenCanvas every call, which is far too slow to sample a readout that
// moves fifty times in a couple of seconds — polled with it, the whole download
// went past between two looks.
const captionOnly = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      x =>
        x.title.includes('roll another') ||
        x.title.includes('the rest of the shelf'),
    )
    return b?.textContent?.trim() ?? null
  })

// Every distinct caption a slot shows until it settles on a name, bounded by the
// clock rather than by a count: what is being waited on is a search, up to six
// metadata reads at six seconds each, and then a download.
const captionsUntilSettled = async (ms = 90_000) => {
  const seenList = []
  for (let spent = 0; spent < ms; spent += 50) {
    await wait(50)
    const seen = await captionOnly()
    if (seen === null || seen === '' || seen === seenList.at(-1)) continue
    seenList.push(seen)
    // A clip's own name is the end of it, and the only reading that is neither
    // of the two waits. Waiting for it also keeps a roll from landing in the
    // middle of a later check.
    if (seenList.length > 1 && !/^(rolling|fetching|opening)…/.test(seen)) break
  }
  return seenList
}

// A roll can legitimately come back with nothing: an archive.org item often
// holds no rendition this app can use, and six attempts still fail about one
// time in eight on Prelinger, whose reels sit just under the byte cap
// (sources/archive.ts, ATTEMPTS). That is the app working as designed and
// documented, so it is not a failure here — but it does leave nothing to check,
// so roll again rather than report a red that says nothing about the code.
let readings = []
for (let attempt = 0; attempt < 3; attempt += 1) {
  await pickA('bars')
  await wait(400)
  await pickA('ia-random')
  readings = await captionsUntilSettled()
  if (readings.some(r => r.startsWith('fetching…'))) break
  console.log(`     (a roll came back with nothing usable; rolling again)`)
}
const sized = readings.filter(r => /^fetching….*\d/.test(r))
check(
  readings[0] === 'rolling…',
  'the search and the metadata read say so first',
  JSON.stringify(readings.slice(0, 2)),
)
check(
  sized.length >= 2,
  'the download names a size and then counts it out',
  JSON.stringify(readings.slice(0, 6)),
)
check(
  /^fetching… [\d.]+ [kM]B$/.test(sized[0] ?? ''),
  'and names it before the first byte, not after',
  JSON.stringify(sized[0]),
)

// ── and a clip already fetched is not fetched twice ──────────────────────────
// Reusing the download the section above just paid for. A kept clip played back
// comes off the in-session cache (archive.ts), so the readout says nothing at
// all — there is no wait to report. Without the cache this is a second full
// download, which is the failure the readout above would make *more* glaring
// rather than less.
const rolled = readings.at(-1)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.textContent === '☆')
    ?.click()
})
await wait(400)
await pickA('bars')
await wait(800)
await pickA('library')
await wait(1500)
// `rolled` crosses into the page as an argument: an evaluate runs in the
// browser and closes over nothing on this side.
await page.evaluate(name => {
  const d = document.querySelector('dialog[open]')
  ;[...(d?.querySelectorAll('button') ?? [])]
    .find(b => b.title.startsWith(`play ${name}`))
    ?.click()
}, rolled)
const replay = await captionsUntilSettled(40_000)
check(
  replay.at(-1) === rolled,
  'a kept archive.org clip plays back off the shelf',
  JSON.stringify(replay),
)
check(
  !replay.some(r => r.startsWith('fetching…')),
  'and comes off the cache rather than down the wire again',
  JSON.stringify(replay),
)

// ── and survives the page going away ─────────────────────────────────────────
// The memory tier cannot answer this one: a reload empties it, and what is left
// is the disk tier, which is the whole reason "kept" means ready rather than
// remembered. A browser with no `caches`, a private window or a full quota all
// degrade to a download, so this failing is a real regression and not a flake —
// the harness runs in an ordinary profile on localhost, which is a secure
// context.
await page.goto(base, { waitUntil: 'networkidle0' })
await appUp(page, 5000)
// A fresh document, so the stage is shut again.
check(await ensureSourceA(), "source A's stage opens after the reload")
await pickA('library')
await wait(1500)
await page.evaluate(name => {
  const d = document.querySelector('dialog[open]')
  ;[...(d?.querySelectorAll('button') ?? [])]
    .find(b => b.title.startsWith(`play ${name}`))
    ?.click()
}, rolled)
const reloaded = await captionsUntilSettled(40_000)
check(
  reloaded.at(-1) === rolled,
  'the shelf still plays it after a reload',
  JSON.stringify(reloaded),
)
check(
  !reloaded.some(r => r.startsWith('fetching…')),
  'and off the disk cache, without downloading it a second time',
  JSON.stringify(reloaded),
)

// ── a late roll is dropped ───────────────────────────────────────────────────
// The one failure a screenshot cannot show: the request is out for a second or
// two, the user is free to leave, and the reply must not land on what they went
// to. 200ms is comfortably inside the round trip.
await pickA('wiki-random')
await wait(200)
await pickA('bars')
const onBars = await state()
await wait(9000)
now = await state()
check(
  now.mode === 'bars' && now.caption === null,
  'a roll that lands after the slot moved on is dropped',
  `${now.mode} / ${JSON.stringify(now.caption)}`,
)
check(
  Math.abs(now.shades - onBars.shades) < 20,
  'and the picture is still the one the user picked',
  `${onBars.shades} shades then, ${now.shades} now`,
)

await browser.close()
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log(
  '\nPools: rolls, the shelf, the browser, the download readout and the' +
    ' stale-reply guard all hold.',
)
