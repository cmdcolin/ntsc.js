// Documentation screenshots: drive the real app in Firefox Nightly and render
// every image docs/USER-GUIDE.md embeds, so the guide cannot drift from the UI.
// Each shot is declarative (scripts/docshot-specs.mjs): a URL, a list of
// actions, optional callouts, and what to crop to. Nothing is hand-measured —
// crops and callouts resolve against live elements at capture time.
//
// A spec with `video` records the canvas instead, into an mp4 (plus a poster
// still) — some of what this app does only reads in motion.
//
// Usage: node scripts/docshots.mjs [--force] [--base=URL] [--out=DIR]
//                                  [--videos=DIR] [--upload] [name...]
//   needs the dev server (pnpm dev), Firefox Nightly, ImageMagick and ffmpeg,
//   optionally pngquant. Names filter the run: `node scripts/docshots.mjs
//   overview presets`.
//
// Unchanged shots are left alone (a pixel-diff gate below `diff`), so a regen
// touches only what actually moved; --force rewrites everything.
//
// Clips are too big to commit, so they land in a gitignored directory and are
// hosted instead: --upload copies them to S3 under the same prefix the README's
// demo uses (needs the `colin` AWS profile).

import puppeteer from 'puppeteer-core'

import { SPECS } from './docshot-specs.mjs'

import { execFileSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const force = argv.includes('--force')
const upload = argv.includes('--upload')
const freeze = argv.includes('--freeze')
const base = flag('base', 'http://localhost:5199/')
const outDir = flag('out', 'docs/img')
const videoDir = flag('videos', 'clips')
const only = argv.filter(a => !a.startsWith('--'))

// Where uploaded clips are served from — the prefix the README's demo already
// uses, so a guide clip is one more object beside it.
const S3_PREFIX = 's3://cmdcolinphotos/phosphene/'
const CLIP_BASE = 'https://cmdcolinphotos.s3.amazonaws.com/phosphene/'
// Where a figure's "open this in the app" link points: the same params this
// shot was captured with, against the deployed build.
const LIVE_BASE = 'https://cmdcolin.github.io/ntscenery/'

// Captured at 2x so the images stay sharp on a HiDPI screen; JPEG shots are
// then fit to this width, which is still ~2x the column any doc renders them in.
const DPR = 2
const JPEG_WIDTH = 1800
// A shot is rewritten when more than this fraction of its pixels moved. The
// picture is a live GPU render, so two runs of the same spec differ by a
// sub-percent of dithered noise even when nothing changed.
const DIFF_GATE = 0.01

// What the app has stashed in localStorage before a shot loads. Panels remember
// whether they were open, the preset shortlist remembers what you last used, and
// hints remember being dismissed — so without a seed, every shot would show
// whichever state the last one happened to leave behind.
const SEED = {
  ntscenery_overlay_bar_hidden: '0',
  ntscenery_fps_hidden: '0',
  video_feedback_preset_hint_dismissed: '0',
  video_feedback_presets_expanded: '0',
  video_feedback_recent_presets: '[]',
  video_feedback_sections: JSON.stringify({
    Presets: true,
    Input: true,
    'A/B Mix': false,
    Scenes: false,
    Modulation: false,
    'Sound into the picture': false,
  }),
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const pct = n => `${(n * 100).toFixed(2)}%`

// ---------------------------------------------------------------- page side

// Runs before any app script: the app reads these on mount.
function seedStorage(seed) {
  localStorage.clear()
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)
}

// Everything that runs inside the page — element resolution, the callout
// overlay, and the DOM pokes an action needs. Injected as source, so it closes
// over nothing out here.
function installHelpers() {
  const stage = () => document.querySelector('canvas').parentElement
  const ROLES = {
    canvas: () => document.querySelector('canvas'),
    stage,
    panel: () => stage().nextElementSibling,
    // The modal's inner card, not the full-viewport <dialog> backdrop.
    dialog: () => document.querySelector('dialog')?.firstElementChild ?? null,
    // An open Popover (the stage menu). CSS modules hash the class, but the
    // local name survives in it.
    menu: () => document.querySelector('div[class*="menu_"]'),
  }

  // A control by its visible text. Exact match first; failing that the tightest
  // control containing it, which is what reaches a menu row whose label sits
  // beside an icon glyph and a keyboard hint.
  const byText = text => {
    const all = [...document.querySelectorAll('button, a, select, option')]
    const exact = all.filter(el => el.textContent.trim() === text)
    const loose = all
      .filter(el => el.textContent.includes(text))
      .sort((a, b) => a.textContent.length - b.textContent.length)
    return exact.at(-1) ?? loose.at(0) ?? null
  }

  // A collapsible Section, by the title in its header. Header text carries the
  // caret (and a • when something inside is off stock), so match the head.
  const section = title => {
    const btn = [...document.querySelectorAll('h3 button')].find(b =>
      b.textContent.trim().startsWith(title),
    )
    return btn === undefined ? null : btn.closest('h3').parentElement
  }

  const resolve = target => {
    const t = typeof target === 'string' ? { role: target } : target
    return t.union !== undefined
      ? (t.union.map(resolve).find(el => el !== null) ?? null)
      : t.role !== undefined
        ? ROLES[t.role]()
        : t.section !== undefined
          ? section(t.section)
          : t.text !== undefined
            ? byText(t.text)
            : t.title !== undefined
              ? document.querySelector(`[title^=${JSON.stringify(t.title)}]`)
              : document.querySelector(t.selector)
  }

  const need = target => {
    const el = resolve(target)
    if (el === null) throw new Error(`no element for ${JSON.stringify(target)}`)
    return el
  }

  // Viewport rect of a target, scrolled into view first. `union` spans every
  // listed target, which is how a crop covers a run of sections.
  const rectOf = target => {
    const t = typeof target === 'string' ? { role: target } : target
    const els = (t.union ?? [t]).map(need)
    for (const el of els) {
      if (el.getBoundingClientRect().bottom > innerHeight) {
        el.scrollIntoView({ block: 'center' })
      }
    }
    const boxes = els.map(el => el.getBoundingClientRect())
    const pad = t.pad ?? 0
    const x = Math.min(...boxes.map(b => b.left)) - pad
    const y = Math.min(...boxes.map(b => b.top)) - pad
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(
        innerWidth - Math.max(0, x),
        Math.max(...boxes.map(b => b.right)) + pad - x,
      ),
      height: Math.min(
        innerHeight - Math.max(0, y),
        Math.max(...boxes.map(b => b.bottom)) + pad - y,
      ),
    }
  }

  // React owns these inputs' values, so a bare `el.value = x` is reverted on the
  // next render — go through the native setter and let React's own listener see
  // the event.
  const setInputValue = (el, value) => {
    const proto =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // Callout red, the one color nothing in this dark UI already uses — an amber
  // ring reads as one of the app's own "off stock" lamps.
  const RED = '#ff2f45'
  const svgEl = (name, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
    return el
  }

  // Callouts, drawn over the page just before the shutter: a ring around a
  // region, a numbered badge, a labelled pill, an arrow. Geometry comes from
  // the live elements, so a callout can't drift off the thing it names.
  const annotate = notes => {
    document.getElementById('docshot-overlay')?.remove()
    const svg = svgEl('svg', {
      id: 'docshot-overlay',
      width: innerWidth,
      height: innerHeight,
      style: `position:fixed;inset:0;z-index:99999;pointer-events:none;font-family:system-ui,sans-serif`,
    })
    // Where on a resolved rect a badge or label hangs.
    const corner = (r, at) => ({
      x: at.includes('l')
        ? r.x
        : at.includes('r')
          ? r.x + r.width
          : r.x + r.width / 2,
      y: at.includes('t')
        ? r.y
        : at.includes('b')
          ? r.y + r.height
          : r.y + r.height / 2,
    })
    for (const note of notes) {
      const r = note.target === undefined ? null : rectOf(note.target)
      const dx = note.dx ?? 0
      const dy = note.dy ?? 0
      if (note.box === true) {
        svg.append(
          svgEl('rect', {
            x: r.x - 3,
            y: r.y - 3,
            width: r.width + 6,
            height: r.height + 6,
            rx: 6,
            fill: 'none',
            stroke: RED,
            'stroke-width': 3,
          }),
        )
      }
      // An arrow from the label to the thing labelled, when the two can't touch.
      if (note.from !== undefined) {
        const head = corner(r, note.at ?? 'center')
        const tail = { x: head.x + note.from.x, y: head.y + note.from.y }
        const len = Math.hypot(head.x - tail.x, head.y - tail.y)
        const ux = (head.x - tail.x) / len
        const uy = (head.y - tail.y) / len
        // Stop short of the target so the head points at it rather than into it.
        const tip = { x: head.x - ux * 6, y: head.y - uy * 6 }
        svg.append(
          svgEl('line', {
            x1: tail.x,
            y1: tail.y,
            x2: tip.x - ux * 8,
            y2: tip.y - uy * 8,
            stroke: RED,
            'stroke-width': 3,
            'stroke-linecap': 'round',
          }),
        )
        svg.append(
          svgEl('polygon', {
            points: [
              `${tip.x},${tip.y}`,
              `${tip.x - ux * 14 - uy * 6},${tip.y - uy * 14 + ux * 6}`,
              `${tip.x - ux * 14 + uy * 6},${tip.y - uy * 14 - ux * 6}`,
            ].join(' '),
            fill: RED,
          }),
        )
      }
      if (note.n !== undefined) {
        const p = corner(r, note.at ?? 'tl')
        const g = svgEl('g', {})
        g.append(
          svgEl('circle', {
            cx: p.x + dx,
            cy: p.y + dy,
            r: 15,
            fill: RED,
            stroke: '#16161a',
            'stroke-width': 2,
          }),
        )
        const label = svgEl('text', {
          x: p.x + dx,
          y: p.y + dy + 1,
          fill: '#fff',
          'font-size': 18,
          'font-weight': 700,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        })
        label.textContent = String(note.n)
        g.append(label)
        svg.append(g)
      }
      if (note.text !== undefined) {
        const p =
          r === null ? { x: note.x, y: note.y } : corner(r, note.at ?? 'tl')
        const width = note.text.length * 8.6 + 24
        const x = Math.min(Math.max(4, p.x + dx), innerWidth - width - 4)
        const y = p.y + dy
        svg.append(
          svgEl('rect', {
            x,
            y: y - 15,
            width,
            height: 30,
            rx: 15,
            fill: RED,
            stroke: '#16161a',
            'stroke-width': 2,
          }),
        )
        const label = svgEl('text', {
          x: x + width / 2,
          y: y + 1,
          fill: '#fff',
          'font-size': 15,
          'font-weight': 600,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        })
        label.textContent = note.text
        svg.append(label)
      }
    }
    document.body.append(svg)
  }

  window.__ds = {
    rectOf,
    annotate,
    click: target => need(target).click(),
    setValue: (target, value) => setInputValue(need(target), value),
    hide: targets => {
      for (const t of targets) need(t).style.display = 'none'
    },
    // Overlay chrome sits on top of the canvas; a picture-only shot drops it.
    bareCanvas: () => {
      const cv = document.querySelector('canvas')
      for (const el of cv.parentElement.children) {
        if (el !== cv) el.style.display = 'none'
      }
    },
    // The stage's own error banner, and the peak channel across the picture: a
    // frame that is dead black everywhere never rendered, and must not be saved
    // as a successful shot.
    health: () => {
      const cv = document.querySelector('canvas')
      const oc = new OffscreenCanvas(cv.width, cv.height)
      const g = oc.getContext('2d')
      g.drawImage(cv, 0, 0)
      let peak = 0
      for (const [x, y] of [
        [0.2, 0.3],
        [0.5, 0.5],
        [0.8, 0.7],
        [0.5, 0.85],
      ]) {
        const d = g.getImageData(
          Math.round(x * cv.width),
          Math.round(y * cv.height),
          1,
          1,
        ).data
        peak = Math.max(peak, d[0], d[1], d[2])
      }
      const err = [...document.querySelectorAll('div[class*="error_"]')]
        .map(el => el.textContent.trim())
        .filter(t => t !== '')
      return { peak, err: err.join(' | ') }
    },
  }
}

// ---------------------------------------------------------------- node side

const step = (page, frames) =>
  page.evaluate(async n => {
    for (let i = 0; i < n; i++) {
      window.vf?.step()
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 15))
    }
  }, frames)

// One declarative action against the live page. Anything React can't be poked
// into (a drag) goes through the real mouse.
async function runAction(page, action) {
  if (action.click !== undefined) {
    await page.evaluate(t => window.__ds.click(t), action.click)
  } else if (action.set !== undefined) {
    await page.evaluate(
      (t, v) => window.__ds.setValue(t, v),
      action.set,
      action.value,
    )
  } else if (action.press !== undefined) {
    const keys = action.press.split('+')
    for (const k of keys.slice(0, -1)) await page.keyboard.down(k)
    await page.keyboard.press(keys.at(-1))
    for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k)
  } else if (action.drag !== undefined) {
    const r = await page.evaluate(t => window.__ds.rectOf(t), action.drag)
    const x = r.x + r.width / 2
    const y = r.y + r.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Several steps, not one jump: the app integrates a drag pointer-move by
    // pointer-move, and a single leap past the slop reads as a click.
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(
        x + (action.by.x * i) / 12,
        y + ((action.by.y ?? 0) * i) / 12,
      )
    }
    await page.mouse.up()
    // Park the pointer off the controls: a chip left under it keeps its hover
    // state, and the panel's caption line would report whatever it landed on
    // rather than the look the shot is of.
    await page.mouse.move(4, 4)
  } else if (action.hide !== undefined) {
    await page.evaluate(t => window.__ds.hide(t), action.hide)
  } else if (action.bare === true) {
    await page.evaluate(() => window.__ds.bareCanvas())
  } else if (action.steps !== undefined) {
    await step(page, action.steps)
  } else if (action.wait !== undefined) {
    await sleep(action.wait)
  }
  await sleep(action.settle ?? 250)
}

// Pixels that differ between two same-size images, as a fraction. null when the
// sizes differ, which is always a rewrite.
function diffFraction(a, b) {
  const size = f =>
    execFileSync('magick', ['identify', '-format', '%wx%h', f]).toString()
  if (size(a) !== size(b)) return null
  const [w, h] = size(a).split('x').map(Number)
  let differing = 0
  try {
    execFileSync('magick', ['compare', '-metric', 'AE', a, b, 'null:'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (e) {
    differing = Number(String(e.stderr).trim().split(' ')[0])
  }
  return Number.isFinite(differing) ? differing / (w * h) : null
}

// Quantize a UI screenshot's palette. These are flat colors, so it shrinks them
// by half with nothing visible lost; --nofs keeps two identical renders
// byte-identical, so the diff gate doesn't churn on dither noise.
function optimizePng(file) {
  try {
    execFileSync(
      'pngquant',
      [
        '--nofs',
        '--quality=92-100',
        '--skip-if-larger',
        '--force',
        '--ext',
        '.png',
        file,
      ],
      { stdio: 'ignore' },
    )
  } catch (e) {
    if (e.code === 'ENOENT') console.log('    (pngquant not found; skipping)')
  }
}

function commit(tmpFile, outFile, name) {
  const fresh = !existsSync(outFile)
  const frac = fresh || force ? null : diffFraction(tmpFile, outFile)
  if (!fresh && !force && frac !== null && frac < DIFF_GATE) {
    rmSync(tmpFile)
    console.log(`  ≈ ${name} unchanged (${pct(frac)})`)
  } else {
    // copy + unlink, not rename: the render lands in $TMPDIR, which is often a
    // different filesystem from the repo.
    copyFileSync(tmpFile, outFile)
    rmSync(tmpFile)
    const why = fresh
      ? 'new'
      : force
        ? 'forced'
        : frac === null
          ? 'resized'
          : pct(frac)
    console.log(`  ✓ ${name} written (${why})`)
  }
}

// Record the canvas in the page and hand the webm back as a data url. The page
// steps the render loop itself while recording: a backgrounded window throttles
// rAF, and a clip captured that way plays back in lurches.
function recordCanvas(secs, fps) {
  const canvas = document.querySelector('canvas')
  const type = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find(t => window.MediaRecorder?.isTypeSupported(t))
  // No rate argument: the stream then samples on every canvas paint rather
  // than on a fixed clock, so the clip runs at whatever the render loop
  // actually achieves instead of duplicating or dropping frames against a
  // rate it can't hit.
  const rec = new MediaRecorder(canvas.captureStream(), {
    mimeType: type,
    videoBitsPerSecond: 24_000_000,
  })
  const chunks = []
  rec.ondataavailable = e => e.data.size && chunks.push(e.data)
  const stopped = new Promise(res => (rec.onstop = res))
  rec.start()
  const t0 = performance.now()
  return new Promise(res => {
    // Stepped from rAF rather than a timer: a timer that fires faster than the
    // GPU can finish a frame queues up behind itself, and the clip comes out at
    // two thirds of the frame rate it asked for.
    const tick = async () => {
      window.vf?.step()
      if (performance.now() - t0 < secs * 1000) {
        requestAnimationFrame(tick)
      } else {
        rec.stop()
        await stopped
        const fr = new FileReader()
        fr.onload = () => res(fr.result)
        fr.readAsDataURL(new Blob(chunks, { type: 'video/webm' }))
      }
    }
    requestAnimationFrame(tick)
  })
}

// The picture, in motion, as an mp4 beside a poster still. h264 rather than the
// raw webm: it is a third the size and plays inline everywhere a doc is read.
async function captureVideo(page, spec) {
  const { secs = 7, fps = 30, crf = 25 } = spec.video
  await page.evaluate(() => window.__ds.bareCanvas())
  await page.bringToFront()
  await sleep(400)
  const poster = join(tmpDir, `${spec.name}-poster.png`)
  const clip = await page.evaluate(() => window.__ds.rectOf('canvas'))
  await page.screenshot({ path: poster, clip })
  const posterOut = join(tmpDir, `${spec.name}-poster.jpg`)
  execFileSync('magick', [
    poster,
    '-resize',
    `${JPEG_WIDTH}x>`,
    '-quality',
    '86',
    posterOut,
  ])
  rmSync(poster)
  commit(
    posterOut,
    join(outDir, `${spec.name}-poster.jpg`),
    `${spec.name}-poster.jpg`,
  )

  const dataUrl = await page.evaluate(recordCanvas, secs, fps)
  const webm = join(tmpDir, `${spec.name}.webm`)
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  writeFileSync(webm, buf)
  const mp4 = join(videoDir, `${spec.name}.mp4`)
  mkdirSync(videoDir, { recursive: true })
  // prettier-ignore
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', webm, '-an',
    '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', mp4])
  rmSync(webm)
  // A window that lost focus mid-run throttles rAF to about 1Hz, and the clip
  // comes out technically valid and useless. Check the rate that actually
  // landed rather than the file size, which a long enough stall still passes.
  const probe = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=nb_frames:format=duration',
    '-of',
    'csv=p=0:nk=1',
    mp4,
  ])
    .toString()
    .trim()
    .split('\n')
    .map(Number)
  const rate = probe[0] / probe[1]
  if (!(rate > 15)) throw new Error(`clip stalled at ${rate.toFixed(1)} fps`)
  console.log(
    `  ✓ ${spec.name}.mp4 (${(statSync(mp4).size / 1e6).toFixed(1)} MB, ${rate.toFixed(0)} fps)`,
  )
  if (upload) {
    execFileSync(
      'aws',
      ['s3', 'cp', mp4, `${S3_PREFIX}${spec.name}.mp4`, '--profile', 'colin'],
      { stdio: 'inherit' },
    )
    console.log(`  ↑ ${CLIP_BASE}${spec.name}.mp4`)
  }
}

async function captureStill(page, spec) {
  const jpeg = spec.format === 'jpeg'
  const name = `${spec.name}.${jpeg ? 'jpg' : 'png'}`
  // Whatever the actions clicked last is still focused, and its focus ring
  // reads as a highlight the shot didn't ask for.
  await page.evaluate(() => document.activeElement?.blur())
  if (spec.annotations !== undefined) {
    await page.evaluate(n => window.__ds.annotate(n), spec.annotations)
  }
  const clip =
    spec.crop === undefined
      ? undefined
      : await page.evaluate(t => window.__ds.rectOf(t), spec.crop)
  const shot = join(tmpDir, `${spec.name}.png`)
  await page.screenshot({ path: shot, clip })

  const tmpOut = join(tmpDir, name)
  if (jpeg) {
    execFileSync('magick', [
      shot,
      '-resize',
      `${spec.maxWidth ?? JPEG_WIDTH}x>`,
      '-quality',
      '88',
      tmpOut,
    ])
    rmSync(shot)
  } else {
    optimizePng(shot)
  }
  commit(jpeg ? tmpOut : shot, join(outDir, name), name)
}

async function capture(browser, spec) {
  const page = await browser.newPage()
  try {
    await page.setViewport({
      width: spec.width ?? 1280,
      height: spec.height ?? 880,
      // Clips are played at their own size, so 2x would only cost bitrate.
      deviceScaleFactor: spec.dpr ?? (spec.video === undefined ? DPR : 1),
    })
    await page.evaluateOnNewDocument(seedStorage, { ...SEED, ...spec.seed })
    const url = `${base}?${new URLSearchParams(spec.params ?? {})}`
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('canvas')
    // The engine builds its pipeline and fetches the source asynchronously;
    // there is no ready event to wait on, so give it real time.
    await sleep(spec.settleMs ?? 4000)
    await page.evaluate(installHelpers)
    // An occluded window throttles rAF, so frames are stepped rather than
    // waited for. Feedback looks need the frames to develop.
    await step(page, spec.warm ?? 90)
    for (const action of spec.actions ?? []) await runAction(page, action)

    const health = await page.evaluate(() => window.__ds.health())
    if (health.err !== '') throw new Error(`stage error: ${health.err}`)
    if (health.peak <= 0) throw new Error('dead frame — nothing rendered')

    if (spec.video === undefined) await captureStill(page, spec)
    else await captureVideo(page, spec)
    // The app mirrors the live look into the address bar, so this is the exact
    // patch that was captured — which matters for a shot whose look came from
    // "surprise me" rather than from its own params.
    liveUrls.set(spec.name, page.url().replace(base, LIVE_BASE))
  } finally {
    await page.evaluate(() => window.vf?.destroy()).catch(() => {})
    await page.close().catch(() => {})
  }
}

// What the app's address bar said when each shot was taken, so a randomized
// look ("surprise me") still links to the exact patch behind the picture.
const liveUrls = new Map()

// Every shot's live URL against the hosted app, so a figure in the docs can be
// opened and played with rather than only looked at. Merged into whatever is
// already on disk, so a filtered run doesn't drop the shots it skipped.
function writeManifest() {
  const file = join(outDir, 'shots.json')
  const previous = new Map(
    (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []).map(s => [
      s.name,
      s.live,
    ]),
  )
  const manifest = SPECS.map(spec => ({
    name: spec.name,
    file:
      spec.video === undefined
        ? `${spec.name}.${spec.format === 'jpeg' ? 'jpg' : 'png'}`
        : `${spec.name}-poster.jpg`,
    mp4: spec.video === undefined ? null : `${CLIP_BASE}${spec.name}.mp4`,
    live:
      liveUrls.get(spec.name) ??
      previous.get(spec.name) ??
      `${LIVE_BASE}?${new URLSearchParams(spec.params ?? {})}`,
  }))
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

const launchBrowser = () =>
  puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
    },
  })

const reachable = () =>
  fetch(base)
    .then(r => r.ok)
    .catch(() => false)

// Run it against whatever is already serving the app; start a dev server when
// nothing is, so a regen is one command from a cold checkout.
async function ensureServer() {
  if (await reachable()) return null
  console.log(`starting a dev server for ${base}`)
  const server = spawn('pnpm', ['dev'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    if (await reachable()) return server
  }
  server.kill()
  throw new Error(`no dev server at ${base}`)
}

const tmpDir = mkdtempSync(join(tmpdir(), 'ntscenery-docshots-'))
const shots = SPECS.filter(s => only.length === 0 || only.includes(s.name))
if (shots.length === 0) {
  console.error(`no specs match ${only.join(' ')}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const server = await ensureServer()
// One browser for the stills, and a fresh one per clip: MediaRecorder samples
// the canvas as it paints, and a window that isn't the frontmost one paints at
// about 1Hz — so a clip has to own the only window on screen.
const shared = shots.some(s => s.video === undefined)
  ? await launchBrowser()
  : null
const failed = []
for (const spec of shots) {
  console.log(`▸ ${spec.name}`)
  // One retry: a cold pipeline occasionally misses the frame budget, and the
  // health checks catch that — worth a second try before failing a run.
  let error = null
  for (let attempt = 0; attempt < 2 && error !== 'ok'; attempt++) {
    const browser = spec.video === undefined ? shared : await launchBrowser()
    error = await capture(browser, spec).then(
      () => 'ok',
      e => String(e.message ?? e).slice(0, 200),
    )
    if (browser !== shared) await browser.close().catch(() => {})
  }
  if (error !== 'ok') {
    console.log(`  ✗ ${spec.name}: ${error}`)
    failed.push(spec.name)
  }
}
await shared?.close()
// --freeze pins the looks this run landed on: a spec that rolls the dice
// ("surprise me") becomes a spec with the exact params behind the picture, so
// the next regen reproduces it instead of rolling again.
if (freeze) {
  const file = 'scripts/docshot-frozen.json'
  const kept = JSON.parse(readFileSync(file, 'utf8'))
  for (const [name, url] of liveUrls) {
    kept[name] = Object.fromEntries(new URL(url).searchParams)
  }
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`)
  console.log(`froze ${liveUrls.size} shot(s) into ${file}`)
}
writeManifest()
rmSync(tmpDir, { recursive: true, force: true })
if (server !== null) process.kill(-server.pid)
console.log(
  failed.length === 0
    ? `\n${shots.length} shots done`
    : `\n${failed.length} failed: ${failed.join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
