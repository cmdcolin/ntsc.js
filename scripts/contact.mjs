// Candidate screening: render a batch of `?set=` patches in one browser, score
// each one, and lay them out as a contact sheet you can look at all at once.
//
// Authoring a preset is a search, not a derivation — the numbers that read as a
// distinct look are found by looking. Doing that one `scripts/shot.mjs` run at a
// time costs a headed Firefox launch and a settle per guess, which is slow
// enough that you stop guessing. This drives N patches through one browser and
// one page each, and scores every one so the obvious failures (a loop that
// walls out to white, a look that never leaves black, a patch whose picture is
// identical to stock) are rejected without anyone squinting at them.
//
// Usage: node scripts/contact.mjs <candidates.mjs> [outDir] [baseUrl]
//
// The candidates module default-exports:
//   { src, srcb, frames, warm, settle, items: [{ name, blurb, set, ... }] }
// where every top-level key but `items` is a default each item may override.

import puppeteer from 'puppeteer-core'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [specPath, outArg, baseArg] = process.argv.slice(2)
if (specPath === undefined) {
  console.error(
    'usage: node scripts/contact.mjs <candidates.mjs> [outDir] [url]',
  )
  process.exit(1)
}
const outDir = outArg ?? 'docs/contact'
const base = baseArg ?? 'http://localhost:5199/'
const spec = (await import(pathToFileURL(resolve(specPath)).href)).default

const DEFAULTS = {
  src: 'cat',
  srcb: 'none',
  // Where the picture is grabbed. A camera loop needs ~140 frames to develop
  // and a mixer loop stacks much faster, so this is the frame where a look is
  // expected to be *itself* rather than still arriving.
  frames: 420,
  // An early checkpoint, for telling "still developing" from "already settled".
  warm: 140,
  // A late one, for the collapse check: plenty of patches look great at 400
  // frames and are a flat white field at 1000.
  late: 1000,
  settle: 4500,
}

// Downsample to this before scoring. Big enough to keep bar/line structure,
// small enough that the pixel loop and the frame-to-frame diff are free.
const SW = 128
const SH = 96

const slug = name => name.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()

const patchUrl = item => {
  const q = new URLSearchParams()
  q.set('src', item.src)
  if (item.srcb !== 'none') q.set('srcb', item.srcb)
  q.set('set', item.set)
  return `${base}?${q.toString()}`
}

// Everything that runs inside the page, as one string: puppeteer's Firefox BiDi
// transport serializes each `evaluate` separately, so the scorer is installed
// once per page rather than shipped with every checkpoint.
const INSTALL_SCORER = (sw, sh) => `(() => {
  window.__cs = { prev: null }
  window.__csScore = () => {
    const cv = document.querySelector('canvas')
    if (!cv) return { dead: true }
    const oc = new OffscreenCanvas(${sw}, ${sh})
    const g = oc.getContext('2d')
    g.drawImage(cv, 0, 0, ${sw}, ${sh})
    const d = g.getImageData(0, 0, ${sw}, ${sh}).data
    const n = ${sw} * ${sh}
    const luma = new Float32Array(n)
    let sum = 0, sat = 0, black = 0, white = 0
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]
      const y = 0.299 * r + 0.587 * gg + 0.114 * b
      luma[i] = y
      sum += y
      // Distance from grey, as a stand-in for saturation that costs no HSV
      // conversion: a monochrome look and a lurid one are the thing being told
      // apart, and the max-min spread does that fine.
      sat += Math.max(r, gg, b) - Math.min(r, gg, b)
      if (y < 6) black++
      if (y > 248) white++
    }
    const mean = sum / n
    let varc = 0
    for (let i = 0; i < n; i++) varc += (luma[i] - mean) ** 2
    // Mean absolute frame-to-frame change, so a frozen picture is separable
    // from one that is merely calm.
    let delta = 0
    if (window.__cs.prev !== null) {
      for (let i = 0; i < n; i++) delta += Math.abs(luma[i] - window.__cs.prev[i])
      delta /= n
    }
    window.__cs.prev = luma
    return {
      mean,
      sd: Math.sqrt(varc / n),
      sat: sat / n,
      black: black / n,
      white: white / n,
      delta,
    }
  }
})()`

// How far a candidate's picture is from the same source rendered clean.
//
// Every other score is dominated by the source photo rather than by the patch:
// a cat with a little grain over it and a cat run through a feedback loop both
// have plenty of spread and plenty of colour. This is the one number that
// answers "did the patch actually do anything", which is the failure the first
// round of candidates was full of — several read as "the source, slightly
// noisier" and no threshold on sd or saturation would have caught it.
//
// Measured off the saved frames rather than during the run, so it also scores
// results carried over from an earlier one. The frames go into the page as
// data: URIs because a file:// image taints the canvas it is drawn on, and a
// tainted canvas cannot be read back.
async function departures(page, dir, files, refFile) {
  const b64 = async f =>
    `data:image/jpeg;base64,${await readFile(`${dir}/${f}`, 'base64')}`
  const refUri = await b64(refFile)
  const uris = await Promise.all(files.map(f => (f === null ? null : b64(f))))
  return page.evaluate(
    async (refUri, uris, sw, sh) => {
      const luma = async src => {
        const img = new Image()
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
          img.src = src
        })
        const oc = new OffscreenCanvas(sw, sh)
        const g = oc.getContext('2d')
        g.drawImage(img, 0, 0, sw, sh)
        const d = g.getImageData(0, 0, sw, sh).data
        const out = new Float32Array(sw * sh)
        for (let i = 0; i < out.length; i++) {
          out[i] =
            0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
        }
        return out
      }
      const ref = await luma(refUri)
      const out = []
      for (const uri of uris) {
        if (uri === null) {
          out.push(null)
          continue
        }
        const a = await luma(uri)
        let sum = 0
        for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - ref[i])
        out.push(sum / a.length)
      }
      return out
    },
    refUri,
    uris,
    SW,
    SH,
  )
}

// The house rule for a bad candidate. Deliberately loose — this rejects looks
// that are broken, not looks that are boring; picking between the survivors is
// the part a person does.
function verdicts(m) {
  const out = []
  if (m.shot.sd < 6) out.push('flat')
  if (m.shot.white > 0.5 || m.late.white > 0.6) out.push('blown')
  if (m.shot.mean < 8) out.push('dark')
  if (m.motion < 0.4) out.push('still')
  // Structure at the grab frame that is gone by the late one: the loop found a
  // wall. Judged on spread rather than brightness, so a collapse to flat black
  // and one to flat white both land here.
  if (m.shot.sd > 12 && m.late.sd < m.shot.sd * 0.35) out.push('collapses')
  if (m.develops < 1.5) out.push('static-from-start')
  return out
}

// Stepping is cut into short evaluates rather than one long one: a single call
// that runs for minutes trips puppeteer's protocol timeout, and a heavy patch
// (a self-oscillating loop at full resolution) is exactly the case where the
// frames are slowest and the batch is therefore longest.
const STEP_CHUNK = 60

const step = async (page, n) => {
  for (let done = 0; done < n; done += STEP_CHUNK) {
    await page.evaluate(
      async count => {
        for (let i = 0; i < count; i++) {
          window.vf?.step()
          // Yield periodically or the page never services the GPU's callbacks.
          if (i % 10 === 0) await new Promise(r => setTimeout(r, 12))
        }
      },
      Math.min(STEP_CHUNK, n - done),
    )
  }
}

await mkdir(outDir, { recursive: true })

const items = spec.items.map(it => ({
  ...DEFAULTS,
  ...spec,
  ...it,
  items: undefined,
}))

const launch = () =>
  puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    // Stepping a thousand frames of a heavy patch outruns the default.
    protocolTimeout: 600_000,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
    },
  })

// One browser does not survive a long batch: after a handful of WebGPU sessions
// Firefox detaches the frame mid-run and every later page dies with "Target
// closed". So the run is cut into short stints with a fresh browser each — the
// launch costs a few seconds against a render that costs minutes — and any
// failure is treated as the browser being spent, not just that candidate.
const BROWSER_LIFE = 3

// Results carry over between runs, keyed by name. Retuning one candidate and
// rerunning just that one is the whole loop this is for, and it should update
// the sheet rather than replace it with a sheet of one.
const priorPath = `${outDir}/results.json`
const prior = await readFile(priorPath, 'utf8').then(
  t => JSON.parse(t),
  () => [],
)
// Which of the spec's items this run actually renders. The spec stays the whole
// list either way — it is what orders the sheet — so a resumed or single-item
// run still produces the full contact sheet.
const only = process.argv.find(a => a.startsWith('--only='))
const todo =
  only !== undefined
    ? items.filter(it => only.slice(7).split(',').includes(it.name))
    : process.argv.includes('--missing')
      ? items.filter(it => !prior.some(p => p.item.name === it.name))
      : items
const results = prior.filter(p => !todo.some(it => it.name === p.item.name))
console.log(`rendering ${todo.length} of ${items.length} candidates`)

let browser = await launch()
let stint = 0
for (const item of todo) {
  if (stint >= BROWSER_LIFE || !browser.connected) {
    await browser.close().catch(() => {})
    browser = await launch()
    stint = 0
  }
  stint++
  const url = patchUrl(item)
  let page = null
  let error = ''
  try {
    // Inside the try with everything else: a browser that has gone away fails
    // here, and losing the whole run to one dead candidate is what made the
    // first long batch worthless.
    page = await browser.newPage()
    // Never page.setViewport after load under Firefox BiDi — it swaps the realm
    // and every later evaluate loses `window.vf`.
    await page.setViewport({ width: 1100, height: 620 })
    page.on('pageerror', err => {
      error ||= String(err).slice(0, 160)
    })
    await page.goto(url, { waitUntil: 'networkidle0' })
    await new Promise(r => setTimeout(r, item.settle))
    // Own the clock: rAF keeps running in a headed window, and a frame count
    // only means something if it is the only thing advancing the sim.
    await page.evaluate(() => window.vf?.loop?.stop())
    await page.evaluate(INSTALL_SCORER(SW, SH))

    // Did the patch this candidate asked for actually land? `?set=` drops any
    // key the schema does not know, silently — so a typo, or a control renamed
    // since the candidate was written, costs a full render and comes back
    // looking merely uninteresting. Asking the engine what it ended up with
    // turns that into a message.
    const missed = await page.evaluate(set => {
      const live = window.vf?.getControls() ?? {}
      return set
        .split(',')
        .filter(p => p !== '')
        .flatMap(pair => {
          const [k, v] = pair.split(':')
          if (!(k in live)) return [`${k}: not a control`]
          return Math.abs(live[k] - Number(v)) < 1e-6
            ? []
            : [`${k}: asked ${v}, got ${live[k]}`]
        })
    }, item.set)
    if (missed.length > 0)
      console.log(`  ! ${item.name}: ${missed.join(' · ')}`)

    await step(page, item.warm)
    const warm = await page.evaluate(() => window.__csScore())
    await step(page, item.frames - item.warm)
    const shot = await page.evaluate(() => window.__csScore())
    // One more frame, alone: the difference against the grab frame is motion.
    await step(page, 1)
    const next = await page.evaluate(() => window.__csScore())

    // Hide the overlay buttons sitting on top of the canvas before the grab.
    await page.evaluate(() => {
      const cv = document.querySelector('canvas')
      for (const el of cv.parentElement.children) {
        if (el !== cv) el.style.display = 'none'
      }
    })
    const file = `${slug(item.name)}.jpg`
    const canvas = await page.$('canvas')
    await canvas.screenshot({
      path: `${outDir}/${file}`,
      type: 'jpeg',
      quality: 82,
    })

    await step(page, Math.max(0, item.late - item.frames))
    const late = await page.evaluate(() => window.__csScore())

    const m = {
      warm,
      shot,
      late,
      motion: next.delta,
      // How much the picture moved between the early checkpoint and the grab:
      // a loop that is identical at 140 and 420 frames is a still image with
      // extra steps.
      develops: shot.delta,
    }
    // The reference is exempt: it is a clean render, so "still" and "not
    // developing" are what it is for, not faults it has.
    const flags =
      item.name === (spec.reference ?? 'ref clean') ? [] : verdicts(m)
    results.push({ item, file, url, m, flags, error })
    console.log(
      `${item.name.padEnd(22)} sd=${shot.sd.toFixed(1)} mean=${shot.mean.toFixed(0)} sat=${shot.sat.toFixed(0)} motion=${m.motion.toFixed(1)} ${flags.join(',') || 'ok'}`,
    )
  } catch (err) {
    console.log(`${item.name.padEnd(22)} FAILED ${String(err).slice(0, 120)}`)
    results.push({
      item,
      file: null,
      url,
      m: null,
      flags: ['failed'],
      error: String(err).slice(0, 160),
    })
    // Whatever went wrong, this browser is not to be trusted with the next
    // candidate — the failures come in runs otherwise.
    stint = BROWSER_LIFE
  }
  if (page !== null) {
    // Release the device before teardown; otherwise the close SIGKILLs
    // Firefox's GPU process mid-frame and it leaves a minidump behind.
    await page.evaluate(() => window.vf?.destroy()).catch(() => {})
    await page.close().catch(() => {})
  }
  // Written after every candidate, not at the end: a batch is an hour of GPU
  // time, and a crash on the last one used to throw away all of it.
  await writeFile(priorPath, JSON.stringify(results, null, 1))
}
await browser.close().catch(() => {})

// Ordered as the spec lists them, with anything carried over from an earlier
// run behind — so a sheet reads in authoring order rather than in run order.
const order = new Map(items.map((it, i) => [it.name, i]))
results.sort(
  (a, b) => (order.get(a.item.name) ?? 1e6) - (order.get(b.item.name) ?? 1e6),
)
// Scored against the reference frame before the sheet is written, so the tiles
// can carry it. Skipped entirely when the spec has no reference item — the
// number is a comparison, and there is nothing honest to compare against.
const refItem = spec.reference ?? 'ref clean'
const ref = results.find(r => r.item.name === refItem && r.file !== null)

const shooter = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: true,
})
const sp = await shooter.newPage()
await sp.setViewport({ width: 1600, height: 1200 })

if (ref !== undefined) {
  await sp.goto('about:blank')
  const d = await departures(
    sp,
    outDir,
    results.map(r => r.file),
    ref.file,
  )
  results.forEach((r, i) => {
    r.depart = d[i]
    // Calibrated against shipped presets, not guessed: `mixer loop` — which
    // nobody thinks is subtle — departs about 9, because line echoes are
    // structurally obvious while being pixel-wise small. So this only catches
    // patches well under that. Read it alongside the rest, too: a look that
    // collapsed to black departs enormously and is not thereby interesting.
    if (r.depart !== null && r.depart < 5 && r.item.name !== refItem) {
      r.flags = [...r.flags, 'subtle']
    }
  })
}

await writeFile(priorPath, JSON.stringify(results, null, 1))

// The sheet itself. Plain HTML on disk rather than a generated image only, so
// every tile's patch is one click from the picture that scored it.
const tile = r => `
  <figure class="${r.flags.length === 0 ? 'ok' : 'flagged'}">
    ${r.file === null ? '<div class="miss">no frame</div>' : `<img src="${r.file}" alt="">`}
    <figcaption>
      <b>${r.item.name}</b>
      ${r.flags.map(f => `<span class="flag">${f}</span>`).join('')}
      <span class="blurb">${r.item.blurb ?? ''}</span>
      <span class="metrics">${
        r.m === null
          ? r.error
          : `depart ${r.depart === null || r.depart === undefined ? '—' : r.depart.toFixed(1)} · sd ${r.m.shot.sd.toFixed(1)} · mean ${r.m.shot.mean.toFixed(0)} · sat ${r.m.shot.sat.toFixed(0)} · motion ${r.m.motion.toFixed(1)} · late sd ${r.m.late === null || r.m.late === undefined ? '—' : r.m.late.sd.toFixed(1)}`
      }</span>
      <a href="${r.url}">open ↗</a>
    </figcaption>
  </figure>`

const sheet = `<!doctype html><meta charset="utf-8"><title>candidates</title>
<style>
  body { background: #14161a; color: #d8dce2; font: 13px/1.45 system-ui, sans-serif; margin: 0; padding: 16px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 12px; color: #9aa4b2; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  figure { margin: 0; background: #1b1e24; border: 1px solid #262b33; border-radius: 6px; overflow: hidden; }
  figure.flagged { border-color: #6b3a3a; }
  img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; }
  .miss { display: grid; place-items: center; aspect-ratio: 4/3; color: #6b3a3a; }
  figcaption { padding: 7px 9px 9px; display: flex; flex-direction: column; gap: 3px; }
  b { font-size: 14px; color: #e8ecf2; }
  .flag { color: #e8946a; font-family: ui-monospace, monospace; font-size: 11px; }
  .blurb { color: #8b95a3; }
  .metrics { color: #5f6875; font-family: ui-monospace, monospace; font-size: 11px; }
  a { color: #6a9fd8; font-size: 11px; text-decoration: none; }
</style>
<h1>${results.length} candidates · src ${items[0].src} · grabbed at ${items[0].frames} frames</h1>
<div class="grid">${results.map(tile).join('')}</div>`

await writeFile(`${outDir}/index.html`, sheet)

// Paged PNGs of the sheet: one image per two rows, because a single tall strip
// of twenty tiles is downsampled past the point of being able to judge one.
await sp.goto(pathToFileURL(resolve(`${outDir}/index.html`)).href, {
  waitUntil: 'networkidle0',
})
const pages = Math.ceil(results.length / 8)
for (let p = 0; p < pages; p++) {
  await sp.evaluate(
    (from, to) => {
      document.querySelectorAll('figure').forEach((f, i) => {
        f.style.display = i >= from && i < to ? '' : 'none'
      })
    },
    p * 8,
    p * 8 + 8,
  )
  await sp.screenshot({ path: `${outDir}/sheet-${p + 1}.png`, fullPage: true })
}
await shooter.close()

const bad = results.filter(r => r.flags.length > 0)
console.log(
  `\nsheet: ${outDir}/index.html (${pages} png page${pages === 1 ? '' : 's'})`,
)
console.log(
  `${results.length - bad.length}/${results.length} clean; flagged: ${bad.map(r => r.item.name).join(', ') || 'none'}`,
)
