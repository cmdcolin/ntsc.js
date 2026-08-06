// Does an unlayered local rule actually beat the `prim` layer it composes from?
// The whole point of putting ui.module.css's .bare and .range in a layer is that
// a composing module can override any part of them without caring which sheet
// the bundler emitted second — so this reads back the properties where the two
// collide and asserts the local one won.
//
//   node scripts/composecheck.mjs [url]

import puppeteer from 'puppeteer-core'

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
  await new Promise(r => setTimeout(r, 4000))
  await page.mouse.move(1000, 700)
  await new Promise(r => setTimeout(r, 1000))

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
    const track = [...panel.querySelectorAll('input[type=range]')][0]
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
