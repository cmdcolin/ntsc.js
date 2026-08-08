// Verification harness for the Wikimedia Commons sources: does a channel roll a
// file, does the ★ keep it, does the shelf play it back, and is a roll that lands
// late dropped rather than pushed onto a slot the user has moved on from.
//
// Usage: node scripts/wikiroll.mjs [http://localhost:5199]
//
// Unlike every other harness here this one talks to a third party. That is the
// point of it: `src/sources/commons.test.ts` holds the readers against response
// shapes that were real *once*, and nothing in the test suite would notice
// commons.wikimedia.org changing its mind about `descriptionurl`, dropping
// `gsrsort=random`, or rendering its transcode ladder differently. Two live
// requests per run, which is well inside anonymous API etiquette.
//
// It exits non-zero with a line per failed check, so it can be run as a gate. A
// network failure reads as a failure — there is no useful "skipped" here, since
// the whole subject is the network.

import puppeteer from 'puppeteer-core'

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
await page.setViewport({ width: 1352, height: 900 })
page.on('pageerror', e => {
  const text = String(e).slice(0, 300)
  console.log(`[pageerror] ${text}`)
  failures.push(`pageerror: ${text}`)
})
page.on('console', m => {
  const t = m.text()
  if (/commons|DEBUG/i.test(t)) console.log(`[page] ${t.slice(0, 200)}`)
})

// The Input section starts folded and remembers being opened, so this has to read
// the state rather than toggle it.
const openInput = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-expanded]')].find(el =>
      el.textContent?.trim().startsWith('Input'),
    )
    if (b?.getAttribute('aria-expanded') !== 'true') b?.click()
    return b !== undefined
  })

// A's picker, found by what it offers rather than by position: the panel holds
// several <select>s and which one comes first is a layout detail.
const pickA = mode =>
  page.evaluate(m => {
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => o.value === 'wiki-vapor'),
    )
    if (sel === undefined) throw new Error('no source picker on the page')
    sel.value = m
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }, mode)

const state = () =>
  page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(s =>
      [...s.options].some(o => o.value === 'wiki-vapor'),
    )
    const buttons = [...document.querySelectorAll('button')]
    const caption = buttons.find(
      b => b.title.includes('roll another') || b.title.includes('favorites'),
    )
    const star = buttons.find(
      b => b.textContent === '☆' || b.textContent === '★',
    )
    const link = [...document.querySelectorAll('a')].find(
      a => a.textContent === '↗',
    )
    // Bars are seven flat blocks; a photograph is not. Counting distinct colours
    // along one line separates them without knowing which photo rolled.
    const cv = document.querySelector('canvas')
    const oc = new OffscreenCanvas(cv.width, cv.height)
    const g = oc.getContext('2d')
    g.drawImage(cv, 0, 0)
    const row = g.getImageData(0, Math.round(cv.height * 0.3), cv.width, 1).data
    const shades = new Set()
    for (let i = 0; i < row.length; i += 4)
      shades.add(`${row[i] >> 5}.${row[i + 1] >> 5}.${row[i + 2] >> 5}`)
    return {
      mode: sel?.value ?? null,
      caption: caption?.textContent ?? null,
      star: star?.textContent ?? null,
      link: link?.href ?? null,
      shades: shades.size,
      faves: JSON.parse(localStorage.getItem('ntsc.js.wiki.favorites') ?? '[]'),
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

// ── a channel rolls, and says what it rolled ─────────────────────────────────
await page.goto(`${base}/?src=wiki-vapor`, { waitUntil: 'networkidle0' })
await wait(6000)
await openInput()
await wait(600)
let now = await state()
check(now.mode === 'wiki-vapor', 'the picker stays on the channel', now.mode)
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
check(now.star === '☆', 'an unstarred roll offers the star', now.star)

// ── ★ keeps it, and the next roll does not take it away ──────────────────────
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
  now.faves.length === 1 && now.faves[0].channel === 'wiki-vapor',
  'the favourite is stored with the channel it came out of',
  JSON.stringify(now.faves),
)
check(
  now.faves[0]?.title?.startsWith('File:') === true &&
    !('url' in (now.faves[0] ?? {})),
  'the favourite is a title and not a url',
  JSON.stringify(now.faves[0]),
)

await clickTitled('roll another')
await wait(6000)
now = await state()
check(now.caption !== kept, 'clicking the caption rolls a different file', kept)
check(now.star === '☆', 'the new roll is not starred', now.star)
check(
  now.faves.length === 1,
  'the shelf still holds the kept one',
  now.faves.length,
)

// ── the shelf plays it back ──────────────────────────────────────────────────
await pickA('wiki-faves')
await wait(1500)
const shelf = await page.evaluate(() => {
  const d = document.querySelector('dialog[open]')
  return {
    title: d?.querySelector('h2')?.textContent ?? null,
    // The row itself, not the send-to-the-other-deck button beside it: both
    // titles open with "show", and only the row's says what it costs.
    rows: [...(d?.querySelectorAll('button') ?? [])].filter(b =>
      b.title.includes('one request to Commons'),
    ).length,
  }
})
check(
  shelf.rows === 1,
  'the shelf lists the starred roll',
  JSON.stringify(shelf),
)
await page.evaluate(() => {
  const d = document.querySelector('dialog[open]')
  ;[...(d?.querySelectorAll('button') ?? [])]
    .find(b => b.title.includes('one request to Commons'))
    ?.click()
})
await wait(6000)
now = await state()
check(
  now.mode === 'wiki-faves' && now.caption === kept,
  'a favourite comes back by name, on the shelf entry',
  `${now.mode} / ${JSON.stringify(now.caption)}`,
)
check(now.star === '★', 'and it is still starred', now.star)

// ── a late roll is dropped ───────────────────────────────────────────────────
// The one failure a screenshot cannot show: the request is out for a second or
// two, the user is free to leave, and the reply must not land on what they went
// to. 200ms is comfortably inside the round trip.
await pickA('wiki-timelapse')
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
  '\nCommons: rolls, stars, shelf and the stale-reply guard all hold.',
)
