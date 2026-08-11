// Does an unlayered local rule actually beat the `prim` layer it composes from?
// The whole point of putting ui.module.css's .bare and .range in a layer is that
// a composing module can override any part of them without caring which sheet
// the bundler emitted second — so this reads back the properties where the two
// collide and asserts the local one won.
//
//   node scripts/composecheck.mjs [url]

import puppeteer from 'puppeteer-core'

// Boot waited for rather than slept through — see until.mjs.
import { appUp } from './until.mjs'

const url = process.argv[2] ?? 'http://localhost:5381/'
const fails = []

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1352, height: 900 })
  await page.goto(url, { waitUntil: 'load' })
  await appUp(page, 4000)
  await page.mouse.move(1000, 700)
  await new Promise(r => setTimeout(r, 1000))

  // **The panel mounts one stage at a time, and none of them is open on
  // arrival** — so the control rows this whole check is about are not on screen.
  // What it read instead was the chain map's own zoom slider, which is a plain
  // `input[type=range]` that composes nothing, and it reported `appearance:
  // auto` as the layer having lost. Every collision below needs a control row:
  // `.range` against `ui.range`'s `--thumb-size`, `.bare` against a `⋮` row
  // menu.
  //
  // Opened by *what a stage contains* rather than by name, because a stage
  // being renamed is the kind of change this file must not fail on — the commit
  // before this one renamed one. The boxes are `<g role=button>` and they
  // toggle, so a stage that does not have what is wanted is shut again before
  // the next is tried.
  const opened = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const boxes = [...document.querySelectorAll('g[role=button]')]
    const hit = g =>
      g.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      )
    // A control row, as this file means it: a slider carrying `ui.range`'s own
    // custom property, and a row menu drawn with `.bare`.
    const ready = () => {
      const panel = [...document.querySelectorAll('div')].find(
        d => getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > 400,
      )
      if (!panel) return null
      const slider = [...panel.querySelectorAll('input[type=range]')].find(
        r => getComputedStyle(r).getPropertyValue('--thumb-size').trim() !== '',
      )
      const menu = [...panel.querySelectorAll('button')].some(
        b => b.textContent.trim() === '⋮',
      )
      return slider !== undefined && menu ? true : null
    }
    for (const g of boxes) {
      hit(g)
      await wait(500)
      if (ready() !== null) return (g.textContent ?? '').trim().slice(0, 24)
      hit(g)
      await wait(200)
    }
    return null
  })
  if (opened === null) {
    fails.push('no stage on the chain map shows a control row to compose with')
  } else {
    console.log(`reading the composition off: ${opened}`)
  }

  const got = await page.evaluate(() => {
    const cs = el => (el ? getComputedStyle(el) : null)
    // startsWith, not equality: a section's toggle carries its caret and, when
    // folded, its current setting inside the same button as the title
    const byText = (sel, text) =>
      [...document.querySelectorAll(sel)].find(e =>
        e.textContent.trim().startsWith(text),
      )
    const panel = [...document.querySelectorAll('div')].find(
      d => getComputedStyle(d).overflowY === 'auto' && d.scrollHeight > 400,
    )
    const brand = panel?.querySelector('button')
    // By glyph, not by position: the class names are module hashes and the row's
    // shape is exactly what a refactor here is allowed to change. The last one —
    // the masthead's panel menu wears the same glyph and is the first.
    const rowMenu = [...panel.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === '⋮')
      .at(-1)
    // The one that *composes*, not simply the first in the panel. The chain
    // map's zoom slider is a plain range that inherits nothing from `ui.range`,
    // and reading it reported the layer as having lost when it had not even
    // been consulted. Carrying `--thumb-size` is what makes a slider one of the
    // ones this file is about.
    const track = [...panel.querySelectorAll('input[type=range]')].find(
      r => getComputedStyle(r).getPropertyValue('--thumb-size').trim() !== '',
    )
    return {
      ranges: [...panel.querySelectorAll('input[type=range]')].length,
      // .bare gives `font: inherit`; every one of these overrides part of it
      brandFamily: cs(brand)?.fontFamily ?? null,
      brandBorder: cs(brand)?.borderTopWidth ?? null,
      brandCursor: cs(brand)?.cursor ?? null,
      rowMenuSize: cs(rowMenu)?.fontSize ?? null,
      rowMenuPadLeft: cs(rowMenu)?.paddingLeft ?? null,
      // .headBtn takes the heading's own type through `font: inherit`, which is
      // the layered declaration surviving where nothing overrides it
      headBtnWeight: cs(byText('button', 'Presets'))?.fontWeight ?? null,
      // ui.range's --thumb-size default vs a control row's own height
      trackHeight: cs(track)?.height ?? null,
      trackAppearance: cs(track)?.appearance ?? null,
      trackThumb: cs(track)?.getPropertyValue('--thumb-size').trim() ?? null,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }
  })
  console.log(JSON.stringify(got, null, 2))

  const want = {
    brandBorder: '0px',
    brandCursor: 'pointer',
    // --fs-md, not the 13px `font: inherit` would have given it
    rowMenuSize: '14px',
    rowMenuPadLeft: '5px',
    trackHeight: '14px',
    trackAppearance: 'none',
    trackThumb: '12px',
    colorScheme: 'dark',
    headBtnWeight: '700',
  }
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v) fails.push(`${k}: got ${got[k]}, want ${v}`)
  }
  if (!/system-ui|sans-serif/.test(got.brandFamily ?? ''))
    fails.push(`brandFamily: got ${got.brandFamily}, want the app's own stack`)
} finally {
  await browser.close()
}

if (fails.length) {
  console.error('FAIL (composecheck)')
  for (const f of fails) console.error('  -', f)
  process.exit(1)
}
console.log('composecheck ok')
