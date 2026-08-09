// Verification harness for the archive.org sources, the counterpart to
// wikiroll.mjs and there for the same reason: src/sources/archive.test.ts holds
// the readers against response shapes that were real *once*, and nothing in the
// test suite would notice archive.org changing its derivative ladder, retiring
// a collection, or stopping serving /cors/.
//
// Usage: node scripts/iaroll.mjs [http://localhost:5199] [rolls-per-channel=2]
//
// What it checks that a unit test cannot: the clip arrives as a `blob:` and is
// therefore *seekable end to end*, which is the whole reason the module
// downloads the file rather than pointing the element at the url — archive.org
// refuses byte ranges, and a seek against the raw url is silently clamped. It
// also rolls each channel more than once, because `sort[]=random` on
// archive.org is stably seeded: a regression there does not fail, it just
// returns the same clip forever.
//
// A pool is sparse enough that the odd roll legitimately comes back empty, so
// this reports per-roll and judges a channel on whether *any* roll landed.
import puppeteer from 'puppeteer-core'

const base = (process.argv[2] ?? 'http://localhost:5199').replace(/\/$/, '')
const wait = ms => new Promise(r => setTimeout(r, ms))
const failures = []
// A roll that came back empty is not a broken channel — the pools are sparse
// enough that one legitimately misses — so a check is recorded against the
// current roll and the channel is judged at the end on whether any roll landed.
let roll = { ok: true }
const check = (ok, what, saw = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — saw ${saw}`}`)
  if (!ok) roll.ok = false
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
const page = await browser.newPage()
await page.setViewport({ width: 1352, height: 900 })
page.on('pageerror', e => {
  const t = String(e).slice(0, 200)
  console.log(`[pageerror] ${t}`)
  failures.push(`pageerror: ${t}`)
})
page.on('console', m => {
  const t = m.text()
  if (/archive|DEBUG video|error/i.test(t))
    console.log(`[page] ${t.slice(0, 180)}`)
})

const REPEATS = Number(process.argv[3] ?? 2)
const modes = ['ia-openings', 'ia-adverts', 'ia-industrial']
const landed = Object.fromEntries(modes.map(m => [m, 0]))
for (const mode of modes.flatMap(m => Array(REPEATS).fill(m))) {
  console.log(`\n===== ${mode}`)
  roll = { ok: true }
  await page.goto(`${base}/?src=${mode}`, { waitUntil: 'domcontentloaded' })

  // The roll is a search, a metadata read and a whole-file download, so this
  // waits on the element rather than on a fixed sleep.
  let state = null
  for (let i = 0; i < 90; i++) {
    await wait(1000)
    state = await page.evaluate(() => {
      // The slot's element is never appended to the document — it is created
      // and handed straight to the engine — so it is reached through the pump.
      const v = window.vf?.pump?.a?.el
      if (!v) return { none: true }
      const seekable = Array.from({ length: v.seekable.length }, (_, i) => [
        +v.seekable.start(i).toFixed(1),
        +v.seekable.end(i).toFixed(1),
      ])
      return {
        src: v.src.slice(0, 12),
        readyState: v.readyState,
        duration: Number.isFinite(v.duration) ? +v.duration.toFixed(1) : null,
        w: v.videoWidth,
        h: v.videoHeight,
        time: +v.currentTime.toFixed(2),
        seekable,
      }
    })
    if (state && !state.none && state.readyState >= 2) break
  }
  console.log('   ', JSON.stringify(state))

  if (!state || state.none) {
    // A roll that gave up says so in the app's own error banner; without this
    // the failure reads as a hang rather than as an empty pool.
    const banner = await page.evaluate(() => {
      const t = document.body.innerText
      const line = t.split('\n').find(l => /archive:/i.test(l))
      return line ?? ''
    })
    check(
      false,
      `${mode}: a video element got a source`,
      banner || '(no banner, still rolling)',
    )
    continue
  }
  check(true, `${mode}: a video element got a source`)
  check(
    state.src === 'blob:http://',
    `${mode}: source is a blob, not the /cors/ url`,
    state.src,
  )
  check(state.readyState >= 2, `${mode}: has decoded frames`, state.readyState)
  check(
    state.w > 0 && state.h > 0,
    `${mode}: has real dimensions`,
    `${state.w}x${state.h}`,
  )

  // The point of the blob: seekable covers the whole clip, and a far seek lands.
  const dur = state.duration ?? 0
  const covered = state.seekable.some(([s, e]) => s <= 0.5 && e >= dur - 1)
  check(
    covered,
    `${mode}: seekable covers the whole clip`,
    JSON.stringify(state.seekable),
  )

  const seek = await page.evaluate(async () => {
    const v = window.vf.pump.a.el
    const target = +(v.duration * 0.8).toFixed(1)
    v.currentTime = target
    await new Promise(r => {
      v.addEventListener('seeked', r, { once: true })
      setTimeout(r, 8000)
    })
    return { target, landed: +v.currentTime.toFixed(1) }
  })
  check(
    Math.abs(seek.landed - seek.target) < 1.5,
    `${mode}: a far seek lands where it was asked`,
    JSON.stringify(seek),
  )

  // The caption names the clip, which is the only thing saying what rolled.
  const caption = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => /roll another/i.test(x.title ?? ''))
    return b?.textContent?.trim() ?? ''
  })
  check(
    caption.length > 0 && caption !== 'rolling…',
    `${mode}: caption names the clip`,
    `"${caption}"`,
  )
  console.log(`    caption: "${caption}"`)

  // And the credit link points at the item page.
  const credit = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find(x =>
      x.href.includes('archive.org/details/'),
    )
    return a?.href ?? ''
  })
  check(
    credit.startsWith('https://archive.org/details/'),
    `${mode}: carries a credit link`,
    credit,
  )
  if (roll.ok) landed[mode] += 1
}

// The verdict: a channel has to have produced at least one good clip. Anything
// less means the pool, the derivative filter or /cors/ has moved.
console.log('')
for (const mode of modes) {
  const ok = landed[mode] > 0
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${mode}: ${landed[mode]}/${REPEATS} rolls landed`,
  )
  if (!ok) failures.push(mode)
}
console.log(
  failures.length
    ? `\n${failures.length} CHANNEL(S) FAILED`
    : '\nevery channel rolled a clip',
)
await browser.close()
process.exit(failures.length ? 1 : 0)
