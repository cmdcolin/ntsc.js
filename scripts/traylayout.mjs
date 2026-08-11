// Does anything in the strip move when the text in it changes?
//
// The tray's cards are shrink-to-fit — a card is as wide as its widest line —
// so every label inside one is load-bearing on layout. Step the hold chip from
// `hold` to `≈16 bars` and the card grows by a couple of dozen pixels, which
// pushes every card to its right along the row, under the pointer that is still
// sitting on the chip it just clicked. That is the whole class of bug this
// measures: a control that moves when you use it, and a neighbour that moves
// when you use something else.
//
//   node scripts/traylayout.mjs [port]
//
// Needs a dev server already running on that port (see docs/DEVELOPMENT.md —
// put it on a worktree copy, since an `src/` write mid-run is an HMR reload).
//
// **Nothing here waits on a frame.** Every reading is a synchronous layout
// after a click that React has already handled, so the occluded-window rAF trap
// that `until.mjs` describes does not apply — the sleeps are the "already
// happened by the time the next line runs" kind.
//
// The strip is seeded through `localStorage` rather than captured off the
// board, unlike `traycheck.mjs`. Capture is what that harness is for; here the
// rundown is a fixture, and one written directly is both faster and the same
// every run — which matters when what is being compared is pixel positions.

import puppeteer from 'puppeteer-core'

import { appUp } from './until.mjs'

import process from 'node:process'

const port = process.argv[2] ?? '5199'
const url = `http://localhost:${port}/`

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
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))

const wait = ms => new Promise(r => setTimeout(r, ms))

// Four rows whose names are deliberately different lengths: a card sized by its
// label is the design, so a fixture of four identical names would measure a
// tray that does not exist.
//
// Row 0 is the one every ring below is stepped on, and it carries the *default*
// drift rather than none — which is not a detail. `cycleHold` keeps a row's
// drift, so a row at drift 0 steps through `1 bar … 16 bars` and never draws
// the `≈` that the widest label in the ring has. Measured on such a row the
// hold chip looked two thirds fixed, because the one case its reserve was short
// for was the one the fixture could not reach.
const FIXTURE = {
  seed: 1,
  loop: true,
  rows: [
    {
      id: 'r1',
      name: 'vhs',
      session: 'src=bars',
      hold: { bars: 4, drift: 0.25 },
    },
    { id: 'r2', name: '', session: 'src=bars', hold: { bars: 4, drift: 0 } },
    {
      id: 'r3',
      name: 'the long one, ellipsized',
      session: 'src=bars',
      hold: { bars: 16, drift: 0.25 },
    },
    {
      id: 'r4',
      name: 'x',
      session: 'src=bars',
      hold: { bars: null, drift: 0 },
    },
  ],
}

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.evaluate(strip => {
  localStorage.setItem('ntsc.js.strip', JSON.stringify(strip))
}, FIXTURE)
await page.reload({ waitUntil: 'domcontentloaded' })
await appUp(page, 6000)

const fail = []
const check = (name, ok, detail = '') => {
  console.log(
    `${ok ? '  ok' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`,
  )
  if (!ok) fail.push(name)
}

const clickText = text =>
  page.evaluate(t => {
    const hit = [...document.querySelectorAll('button')].find(b =>
      b.textContent?.includes(t),
    )
    hit?.click()
    return hit !== undefined
  }, text)

// Every position in the tray that a hand can be aiming at, rounded to a tenth
// of a pixel — sub-pixel noise between two identical layouts is not a shift.
const geometry = () =>
  page.evaluate(() => {
    const round = n => Math.round(n * 10) / 10
    const box = el => {
      const r = el.getBoundingClientRect()
      return {
        x: round(r.x),
        y: round(r.y),
        w: round(r.width),
        h: round(r.height),
      }
    }
    const out = {}
    for (const card of document.querySelectorAll('[data-index]')) {
      const i = card.dataset.index
      out[`card${i}`] = box(card)
      for (const act of [
        'hold',
        'arrive',
        'transition',
        'rename',
        'dup',
        'drop',
      ]) {
        const el = card.querySelector(`[data-act="${act}"]`)
        if (el !== null) out[`card${i}.${act}`] = box(el)
      }
    }
    // The tray's own bar, by position rather than by name: it has no `data-act`
    // hooks and does not need them here, since nothing in this file *clicks* a
    // bar control by identity — it only asks whether one moved.
    const bar = document.querySelector('[aria-expanded]')?.parentElement
    for (const [i, el] of [...(bar?.children ?? [])].entries()) {
      out[`bar${i}`] = box(el)
    }
    return out
  })

// What moved between two readings, and by how much. Keys missing from either
// side are reported as such rather than skipped: a control that vanished is the
// worst kind of shift.
const moved = (before, after) => {
  const out = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key]
    const b = after[key]
    if (a === undefined || b === undefined) {
      out.push(`${key}: ${a === undefined ? 'appeared' : 'vanished'}`)
      continue
    }
    const dx = Math.round((b.x - a.x) * 10) / 10
    const dw = Math.round((b.w - a.w) * 10) / 10
    const dh = Math.round((b.h - a.h) * 10) / 10
    if (dx !== 0 || dw !== 0 || dh !== 0) {
      out.push(
        `${key}: ${[
          dx && `x${dx > 0 ? '+' : ''}${dx}`,
          dw && `w${dw > 0 ? '+' : ''}${dw}`,
          dh && `h${dh > 0 ? '+' : ''}${dh}`,
        ]
          .filter(Boolean)
          .join(' ')}`,
      )
    }
  }
  return out
}

const stepChip = (index, act) =>
  page.evaluate(
    (i, a) => {
      const card = document.querySelectorAll('[data-index]')[i]
      card?.querySelector(`[data-act="${a}"]`)?.click()
    },
    index,
    act,
  )

// Step one chip all the way round its ring, and report the worst thing that
// moved anywhere in the tray at any point on the way. A ring is the right unit:
// what a hand does is click the same chip repeatedly, and a chip that is stable
// for four steps and jumps on the fifth is not a stable chip.
const ring = async (act, steps) => {
  const start = await geometry()
  const seen = []
  const labels = []
  for (let n = 0; n < steps; n++) {
    await stepChip(0, act)
    await wait(120)
    labels.push(
      await page.evaluate(
        a =>
          document
            .querySelector(`[data-index="0"] [data-act="${a}"]`)
            ?.textContent?.trim(),
        act,
      ),
    )
    seen.push(...moved(start, await geometry()))
  }
  return { seen: [...new Set(seen)], labels }
}

await clickText('strip')
await wait(500)

const open = await geometry()
check('the tray opened with four cards', open['card3'] !== undefined)
console.log(
  `\n  card widths: ${[0, 1, 2, 3].map(i => open[`card${i}`]?.w).join(', ')}`,
)

// The other half of reserving width, and the reason it is checked here rather
// than assumed: the card has a ceiling and `overflow: hidden`, so widening the
// chips is exactly the move that once pushed the ✕ out past the edge, where it
// was invisible, unclickable, and the only way to remove a row.
// `traycheck.mjs` measures this too — worth having on both sides of the same
// coin, since this is the file that makes the chips wider.
const outside = Object.entries(open).filter(([key, box]) => {
  const card = open[key.split('.')[0]]
  return (
    key.startsWith('card') &&
    key.includes('.') &&
    (box.x < card.x || box.x + box.w > card.x + card.w)
  )
})
check(
  'every control on a card is still inside it',
  outside.length === 0,
  outside.map(([k]) => k).join(', '),
)

for (const [act, steps] of [
  ['hold', 6],
  ['arrive', 5],
  ['transition', 6],
]) {
  const { seen, labels } = await ring(act, steps)
  console.log(`\n  ${act} ring: ${labels.join(' → ')}`)
  check(
    `stepping ${act} moves nothing in the tray`,
    seen.length === 0,
    seen.slice(0, 8).join('; '),
  )
}

// --- the rename field -------------------------------------------------------
//
// The one swap in the card that replaces its whole face, and the one the CSS
// makes a promise about: the field is supposed to sit where the name was, so
// the card does not resize under the pointer that opened it.
const beforeEdit = await geometry()
await stepChip(0, 'rename')
await wait(200)
const editing = await geometry()
const shifted = moved(beforeEdit, editing).filter(m => !m.startsWith('card0.'))
check(
  'opening the rename field moves no other card',
  shifted.length === 0,
  shifted.slice(0, 6).join('; '),
)
check(
  'and does not resize the card it opened in',
  beforeEdit['card0'].w === editing['card0'].w &&
    beforeEdit['card0'].h === editing['card0'].h,
  `${beforeEdit['card0'].w}x${beforeEdit['card0'].h} → ${editing['card0'].w}x${editing['card0'].h}`,
)
await page.keyboard.press('Escape')
await wait(200)

// --- the bar ----------------------------------------------------------------
//
// The same question one surface up. The bar is a flex row, so any control whose
// label changes width pushes everything between it and the `margin-left: auto`
// along — and two of its labels change without anybody asking: ▶/■ every time
// the walk is started or stopped, and the render readout on its own, ~a hundred
// times over a render, while a hand is nowhere near it.
const beforePlay = await geometry()
console.log(
  `\n  bar widths: ${Object.entries(beforePlay)
    .filter(([k]) => k.startsWith('bar'))
    .map(([, b]) => b.w)
    .join(', ')}`,
)
// What the reserves in `.transport` and `.readout` have to cover, measured in
// the bar's own face rather than guessed: both hold a label the bar is not
// currently wearing, and a floor that turns out to be under the widest of them
// is a reserve that quietly does nothing.
console.log(
  `  widest labels: ${JSON.stringify(
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        b.textContent?.includes('play'),
      )
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${getComputedStyle(btn).font}`
      document.body.append(probe)
      const w = s => {
        probe.textContent = s
        // The button's own padding and border, which its min-width includes:
        // a <button> is border-box in every UA stylesheet.
        const cs = getComputedStyle(btn)
        const pad =
          parseFloat(cs.paddingLeft) +
          parseFloat(cs.paddingRight) +
          2 * parseFloat(cs.borderLeftWidth)
        return Math.ceil(probe.getBoundingClientRect().width + pad)
      }
      const out = {
        '▶ play': w('▶ play'),
        '■ stop': w('■ stop'),
        '⎙ render 10s': w('⎙ render 10s'),
        '100% · cancel': w('100% · cancel'),
      }
      probe.remove()
      return out
    }),
  )}`,
)
await clickText('▶ play')
await wait(300)
const playing = moved(beforePlay, await geometry()).filter(m =>
  m.startsWith('bar'),
)
check(
  'starting the walk moves nothing else in the bar',
  playing.length === 0,
  playing.slice(0, 6).join('; '),
)
await clickText('■ stop')
await wait(300)

console.log(
  errors.length === 0
    ? '\n  no page errors'
    : `\nerrors: ${errors.join(' | ')}`,
)
console.log(fail.length === 0 ? '\nall ok' : `\nFAILED: ${fail.join(', ')}`)
await browser.close()
process.exit(fail.length === 0 && errors.length === 0 ? 0 : 1)
