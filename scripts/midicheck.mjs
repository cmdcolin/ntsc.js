// Drives the whole MIDI path against a fake Web MIDI device: a knob on the
// motion amount, a knob on a preset weight, a knob on an ordinary control
// (which must still take over softly), and a pad on a bay slot. Nothing here
// needs hardware, which is the point — the alternative regression net for this
// feature is "plug a controller in and remember to try it", which is no net at
// all. Notes are the half no browser this project develops against can even
// deliver: Firefox has no Web MIDI, so the fake device is the only way the note
// path is exercised at all.
//
// Modelled on scripts/shot.mjs: headed Firefox Nightly, because Chrome cannot
// present WebGPU swap chains on this platform.
//
// Usage: node scripts/midicheck.mjs [url]
//
// Point it at a production build (`vite build` + `vite preview`) rather than the
// dev server if anything else is editing the tree — an HMR reload mid-run
// remounts the app and takes the bindings with it. Class names are hashed in a
// build, so every selector below reaches for an id, a title or the text.

import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5199/'

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
await page.setViewport({ width: 1352, height: 1000 })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log(
    `${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`,
  )
  if (!cond) fails.push(name)
}
page.on('console', m => {
  const t = m.text()
  if (!t.includes('[trace]')) console.log('[page]', t.slice(0, 300))
})
page.on('pageerror', e => {
  console.log('[pageerror]', String(e).slice(0, 400))
  fails.push('pageerror')
})

// The routing comes in on the link, so the motion strip is on screen without
// seeding storage — a preload script runs in a sandbox realm under Firefox BiDi,
// and anything it builds there is walled off from the page by Xray vision.
await page.goto(`${url}?mod=hHold:sine:0.35:0.4`, { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 6000))

// A device that is never plugged in: enough of Web MIDI for createMidi to bind
// its listener, plus a hook to push CC messages at it. Installed from the page's
// own realm so every object the app touches (the Map, the message's Uint8Array)
// is one of its own.
await page.evaluate(() => {
  localStorage.removeItem('video_feedback_midi')
  // The note map decides what an *unbound* note does, so a map left behind by an
  // earlier run would silently switch off the blanket this checks for first.
  localStorage.removeItem('video_feedback_midi_notes')
  const input = { onmidimessage: null }
  const access = {
    inputs: new Map([['fake-0', input]]),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  navigator.requestMIDIAccess = () => Promise.resolve(access)
  window.__cc = (controller, value, channel = 0) => {
    input.onmidimessage?.({
      data: new Uint8Array([0xb0 | channel, controller, value]),
    })
  }
  window.__note = (note, velocity = 100, channel = 0) => {
    input.onmidimessage?.({
      data: new Uint8Array([0x90 | channel, note, velocity]),
    })
  }
})

// Turn MIDI on the way a user does: gear over the picture → advanced settings.
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.title?.includes('menu ('))
    ?.click()
})
await new Promise(r => setTimeout(r, 300))
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === 'advanced settings')
    ?.click()
})
await new Promise(r => setTimeout(r, 300))
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === 'enable MIDI')
    ?.click()
})
await new Promise(r => setTimeout(r, 500))
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === 'close' || b.title === 'close')
    ?.click()
  document.querySelector('dialog')?.close()
})
await new Promise(r => setTimeout(r, 300))

// The motion range carries an id for its own <label>, which is the one stable
// handle on the strip.
const strip = '#motion-amount'
const readMotion = () => page.$eval(strip, el => Number(el.value))

// --- the motion amount ---------------------------------------------------
ok('the motion strip is on screen', (await page.$(strip)) !== null)
ok(
  'the MIDI panel came up enabled',
  await page.evaluate(() =>
    [...document.querySelectorAll('h2,h3,button,div')].some(e =>
      e.textContent?.trim().startsWith('MIDI'),
    ),
  ),
)

// Arm the strip's ⚟, then turn a knob.
await page.evaluate(() => {
  const el = [
    ...(document
      .getElementById('motion-amount')
      ?.parentElement?.querySelectorAll('button') ?? []),
  ].find(b => b.textContent?.includes('⚟'))
  el?.click()
})
await new Promise(r => setTimeout(r, 200))
ok(
  'arming the strip says so in the panel',
  await page.evaluate(() =>
    document.body.textContent?.includes('learning motion amount'),
  ),
)

await page.evaluate(() => window.__cc(21, 64))
await new Promise(r => setTimeout(r, 300))
ok(
  'the strip button now reads its CC',
  await page.evaluate(() =>
    [
      ...(document
        .getElementById('motion-amount')
        ?.parentElement?.querySelectorAll('button') ?? []),
    ].some(b => b.textContent?.includes('CC21')),
  ),
)
ok(
  'the binding is listed in the MIDI panel',
  await page.evaluate(() =>
    document.body.textContent?.includes('motion amount · CC21'),
  ),
)

// The first message binds rather than drives, so this is the first turn.
await page.evaluate(() => window.__cc(21, 32))
await new Promise(r => setTimeout(r, 300))
const quarter = await readMotion()
ok(
  'the knob drives the motion amount',
  Math.abs(quarter - 0.25) < 0.02,
  `${quarter}`,
)

await page.evaluate(() => window.__cc(21, 0))
await new Promise(r => setTimeout(r, 300))
const zero = await readMotion()
ok('and takes it to a standstill', zero === 0, `${zero}`)
ok(
  'which the freeze button agrees with',
  await page.evaluate(() =>
    [
      ...(document
        .getElementById('motion-amount')
        ?.parentElement?.querySelectorAll('button') ?? []),
    ].some(b => b.textContent?.trim() === '▶'),
  ),
)

await page.evaluate(() => window.__cc(21, 127))
await new Promise(r => setTimeout(r, 300))
ok('and back up', (await readMotion()) === 1)

// The stored map is what a reload reads back.
ok(
  'the binding is persisted under its target name',
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('video_feedback_midi')).motion
        ?.controller === 21,
  ),
)

// --- a preset weight ------------------------------------------------------
const controlsOf = () => page.evaluate(() => ({ ...window.vf.getControls() }))
const clean = await controlsOf()

await page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find(s =>
    [...s.options].some(o => o.value === 'vhs'),
  )
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value',
  ).set
  setter.call(sel, 'vhs')
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})
await new Promise(r => setTimeout(r, 200))
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x =>
    x.textContent?.includes('⚟ preset mix'),
  )
  b?.click()
})
await new Promise(r => setTimeout(r, 200))
ok(
  'arming a preset weight says which one',
  await page.evaluate(() =>
    document.body.textContent?.includes('learning vhs · preset'),
  ),
)

await page.evaluate(() => window.__cc(22, 100))
await new Promise(r => setTimeout(r, 300))
ok(
  'the preset binding is listed',
  await page.evaluate(() =>
    document.body.textContent?.includes('vhs · preset · CC22'),
  ),
)
ok(
  'binding it changed nothing yet',
  JSON.stringify(await controlsOf()) === JSON.stringify(clean),
)

// Half in.
await page.evaluate(() => window.__cc(22, 64))
await new Promise(r => setTimeout(r, 400))
const half = await controlsOf()
const moved = Object.keys(half).filter(k => half[k] !== clean[k])
ok(
  'turning the knob mixes the preset in',
  moved.length > 3,
  `${moved.length} controls moved`,
)

// Full.
await page.evaluate(() => window.__cc(22, 127))
await new Promise(r => setTimeout(r, 400))
const full = await controlsOf()
const deeper = moved.filter(
  k =>
    Math.abs(full[k] - clean[k]) > Math.abs(half[k] - clean[k]) - 1e-9 &&
    full[k] !== half[k],
)
ok(
  'further round is more of it',
  deeper.length > 0,
  `${deeper.length} went further`,
)
ok(
  'the chip fill follows the knob',
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      b =>
        b.textContent?.trim().startsWith('vhs') &&
        b.style.getPropertyValue('--w') === '100%',
    ),
  ),
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter(b => b.textContent?.trim().startsWith('vhs'))
      .map(b => `${b.textContent}|${b.getAttribute('style')}`)
      .join(' ~ '),
  ),
)

// Back off, and the look returns to where it started.
await page.evaluate(() => window.__cc(22, 0))
await new Promise(r => setTimeout(r, 400))
ok(
  'sweeping back to zero returns what was underneath',
  JSON.stringify(await controlsOf()) === JSON.stringify(clean),
)

// --- a pad on the bay -----------------------------------------------------
//
// Watched at the engine rather than in the picture: an envelope fired by a pad
// is applied per frame around the controls and restored, so `getControls` never
// sees it. `fireMod` is the boundary the whole note path exists to reach, and
// its argument is the one conversion in it — the panel numbers slots from 1 and
// the engine indexes them from 0.
await page.evaluate(() => {
  window.__fired = []
  const engine = window.vf
  const real = engine.fireMod.bind(engine)
  engine.fireMod = (id, level) => {
    window.__fired.push([id, level])
    real(id, level)
  }
})

await page.evaluate(() => window.__note(36, 127))
await new Promise(r => setTimeout(r, 300))
ok(
  'with nothing bound, any note fires the whole bay',
  await page.evaluate(
    () => window.__fired.length === 1 && window.__fired[0][0] === undefined,
  ),
  await page.evaluate(() => JSON.stringify(window.__fired)),
)

// Pick a slot off the action picker — the select carrying `fire:2` — and arm it.
await page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find(s =>
    [...s.options].some(o => o.value === 'fire:2'),
  )
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value',
  ).set
  setter.call(sel, 'fire:2')
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})
await new Promise(r => setTimeout(r, 200))
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.textContent?.includes('⚟ pad'))
    ?.click()
})
await new Promise(r => setTimeout(r, 200))
ok(
  'arming a pad says which gesture',
  await page.evaluate(() =>
    document.body.textContent?.includes('learning ⚡ fire slot 2'),
  ),
)

await page.evaluate(() => {
  window.__fired = []
  window.__note(40, 127)
})
await new Promise(r => setTimeout(r, 300))
ok(
  'the arming note binds rather than firing',
  await page.evaluate(() => window.__fired.length === 0),
)
ok(
  'the pad is listed with its note number',
  await page.evaluate(() =>
    document.body.textContent?.includes('⚡ fire slot 2 · note 40'),
  ),
)
ok(
  'and persisted under its action name',
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('video_feedback_midi_notes'))['fire:2']
        ?.note === 40,
  ),
)

// Slot 2 on the panel is index 1 at the engine, and velocity carries.
await page.evaluate(() => window.__note(40, 64))
await new Promise(r => setTimeout(r, 300))
const struck = await page.evaluate(() => window.__fired)
ok(
  'striking it fires that slot, at that velocity',
  struck.length === 1 &&
    struck[0][0] === 1 &&
    Math.abs(struck[0][1] - 0.5) < 0.02,
  JSON.stringify(struck),
)

// The blanket is off now: the note that used to fire everything does nothing.
await page.evaluate(() => {
  window.__fired = []
  window.__note(36, 127)
})
await new Promise(r => setTimeout(r, 300))
ok(
  'binding one pad stops every other note firing the bay',
  await page.evaluate(() => window.__fired.length === 0),
)

// Handing the pad back brings the blanket with it — otherwise clearing a
// binding would leave the keyboard dead with nothing on screen saying why.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('div')].find(
    d =>
      d.textContent?.startsWith('⚡ fire slot 2 · note 40') &&
      d.querySelector('button'),
  )
  row?.querySelector('button')?.click()
})
await new Promise(r => setTimeout(r, 300))
await page.evaluate(() => {
  window.__fired = []
  window.__note(36, 127)
})
await new Promise(r => setTimeout(r, 300))
ok(
  'clearing the last pad puts the blanket back',
  await page.evaluate(
    () => window.__fired.length === 1 && window.__fired[0][0] === undefined,
  ),
  await page.evaluate(() => JSON.stringify(window.__fired)),
)

// --- a control still behaves like a control -------------------------------
await page.evaluate(() => window.__cc(23, 40))
await new Promise(r => setTimeout(r, 200))
const before = (await controlsOf()).phosphor
// The box is mounted by the ⌕ rather than sitting in the masthead, and has been
// since "give the sidebar back to the controls" — which this script did not
// learn, so from then until now it threw here and the three checks below it
// never ran at all. A harness that stops before its last section is worse than
// none: it prints ok all the way down and then dies of something unrelated.
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === 'filter the controls')
    ?.click()
})
await new Promise(r => setTimeout(r, 300))
ok(
  'the ⌕ opens the filter box',
  (await page.$('input[type="search"]')) !== null,
)
await page.evaluate(() => {
  // Bind CC23 to feedback mix through the row's own ⚟ (the filter box finds it).
  const box = document.querySelector('input[type="search"]')
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set
  setter.call(box, 'phosphor persistence')
  box.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise(r => setTimeout(r, 600))
// The same rework moved the row's ⚟ out of the open and behind the row's ⋮,
// which is a menu that has to be opened before its items exist to click. Same
// story as the box above: the check that "a control row still offers its own ⚟"
// was reading a button that had stopped being rendered.
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(
    x => x.getAttribute('aria-label') === 'more for phosphor persistence',
  )
  b?.click()
  return b !== undefined
})
ok('a control row still carries a ⋮', opened)
await new Promise(r => setTimeout(r, 300))
const armed = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x =>
    x.textContent?.includes('assign a MIDI control'),
  )
  b?.click()
  return b !== undefined
})
ok('and offers ⚟ inside it', armed)
await new Promise(r => setTimeout(r, 200))
// The MIDI panel is hidden while the filter box has text in it (below the box
// is the result set), so the row's own menu is what reports the bind here — and
// the item closes the menu on its way, so getting the CC back means opening it
// again.
await page.evaluate(() => window.__cc(23, 40))
await new Promise(r => setTimeout(r, 400))
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(x => x.getAttribute('aria-label') === 'more for phosphor persistence')
    ?.click()
})
await new Promise(r => setTimeout(r, 300))
ok(
  'and the row reads its CC once bound',
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      b =>
        b.textContent?.includes('relearn this MIDI control') &&
        b.textContent?.includes('CC23'),
    ),
  ),
)
// Left open on purpose. Escape would close it, and would also clear the filter
// box and the search with it (app.tsx's onEscape backs out of every panel mode
// at once) — which takes the row, and the pickup mark checked for below, off
// screen. The menu sits in the top layer and the row stays in the document.
await page.evaluate(() => window.__cc(23, 90))
await new Promise(r => setTimeout(r, 300))
// Soft takeover: the knob was last seen at 40 and the value is at its default,
// so this second message must not have moved it.
const after = (await controlsOf()).phosphor
ok(
  'soft takeover still holds a control back',
  after === before,
  `${before} -> ${after}`,
)
ok(
  'and the row shows where the knob is waiting',
  await page.evaluate(
    () => document.querySelector('span[title^="the knob is here"]') !== null,
  ),
)

await page.evaluate(() => window.vf?.destroy())
await browser.close()
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(', ')}`)
process.exit(fails.length === 0 ? 0 : 1)
