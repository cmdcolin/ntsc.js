// Does the intercarrier buzz reach the speakers, and is what arrives there the
// picture? Listens rather than infers: taps the BuzzOut worklet node the app
// builds and measures the real output, so a green run means the whole chain
// worked — GPU tap, readback, worklet module, ring, servo, connection.
//
// Every arm is measured in one page load against the same source, changing one
// control between them, so what the numbers can differ by is that control.
//
// Firefox Nightly / Linux, bars, 48 kHz — the reading the thresholds below are
// set against, and the one to re-mark a later run at:
//
//     arm          rms       peak      50-320Hz   4-12kHz
//     off          <1e-3     --        --         --
//     buzz 0.9     1.10e-1   5.04e-1   1.70e-4    1.85e-5
//     + snow       9.99e-2   5.15e-1   2.97e-4    3.71e-5
//     + mistune    1.79e-1   7.40e-1   4.72e-4    7.04e-5
//
// Read the bands as ratios and not as levels: 4-12 kHz on a clean picture sits
// a hair over the analyser's own -100 dB floor, so what the snow arm shows is
// that the band moved, and by how much relative to itself. The absolute number
// is the floor plus whatever the harmonics of a 60 Hz step leave up there.
//
// Snow costs rms rather than adding to it, which looks wrong for a second and
// is not: `rfSnow` runs the envelope detector down as well as adding noise, so
// the picture structure driving the buzz shrinks while the hiss grows.
//
// Usage: node scripts/buzzsound.mjs [url]

import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:5199/'

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
    // The context is built from a render-loop callback rather than a click, so
    // without this it stays suspended and every arm reads silence.
    'media.autoplay.default': 0,
    'media.autoplay.blocking_policy': 0,
    // Nothing should reach the room while this runs.
    'media.volume_scale': '0.0',
  },
})
const page = await browser.newPage()
await page.setViewport({ width: 1000, height: 700 })
page.on('console', m => console.log('[page]', m.text().slice(0, 300)))
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))

// Catch the node on construction — it is the only handle to a graph that is
// deliberately not reachable from the app's own analyser.
await page.evaluateOnNewDocument(() => {
  const Real = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Real {
    constructor(ctx, name, opts) {
      super(ctx, name, opts)
      if (name === 'buzz') {
        const probe = ctx.createAnalyser()
        probe.fftSize = 32768
        this.connect(probe)
        window.__buzz = probe
      }
    }
  }
})

await page.goto(`${base}?set=buzzLevel:0.9`, { waitUntil: 'networkidle0' })

const settle = ms => new Promise(r => setTimeout(r, ms))

// Say which of the two ways this can be dead before spending four arms finding
// out: no node means the worklet module never loaded, and a suspended context
// means it loaded into a graph nobody started.
await settle(3000)
const alive = await page.evaluate(() => ({
  node: window.__buzz !== undefined,
  state: window.__buzz?.context.state ?? 'no context',
  rate: window.__buzz?.context.sampleRate ?? 0,
}))
console.log(`node ${alive.node}  context ${alive.state}  ${alive.rate} Hz\n`)

// One arm: apply the controls, let the ring refill and the servo settle, then
// read the analyser. Returns overall level plus where the energy sits.
const arm = async (name, patch) => {
  const got = await page.evaluate(
    async (patch, ms) => {
      window.vf?.applyControls(patch)
      await new Promise(r => setTimeout(r, ms))
      const a = window.__buzz
      if (!a) return null
      const t = new Float32Array(a.fftSize)
      a.getFloatTimeDomainData(t)
      let sum = 0
      let peak = 0
      for (const v of t) {
        sum += v * v
        peak = Math.max(peak, Math.abs(v))
      }
      const f = new Float32Array(a.frequencyBinCount)
      a.getFloatFrequencyData(f)
      const hz = a.context.sampleRate / 2 / f.length
      // dB in a band, as a linear mean — enough to say which way the energy moved.
      const band = (lo, hi) => {
        let acc = 0
        let n = 0
        for (let i = Math.round(lo / hz); i < Math.round(hi / hz); i++) {
          acc += 10 ** (f[i] / 20)
          n++
        }
        return acc / Math.max(1, n)
      }
      return {
        rms: Math.sqrt(sum / t.length),
        peak,
        // The field rate and its first few harmonics — the vertical interval.
        buzz: band(50, 320),
        // Well above anything the field structure puts out: snow's territory.
        hiss: band(4000, 12000),
      }
    },
    patch,
    2500,
  )
  if (got === null) {
    console.log(`${name.padEnd(14)} NO BUZZ NODE — the worklet never loaded`)
    return null
  }
  const f = n => n.toExponential(2)
  console.log(
    `${name.padEnd(14)} rms ${f(got.rms)}  peak ${f(got.peak)}  ` +
      `50-320Hz ${f(got.buzz)}  4-12kHz ${f(got.hiss)}`,
  )
  return got
}

// Bars: a fixed, bright, high-contrast picture, so nothing in the source drifts
// between arms.
await page.evaluate(() => window.vf?.applyControls({ noiseIre: 0, rfSnow: 0 }))
await settle(2000)

const off = await arm('off', { buzzLevel: 0 })
const on = await arm('buzz 0.9', { buzzLevel: 0.9 })
const snow = await arm('+ snow', { buzzLevel: 0.9, rfSnow: 0.8 })
const mistune = await arm('+ mistune', { rfSnow: 0, rfMistuneMHz: 2 })

const checks = [
  ['silent with the slider down', off && off.rms < 1e-3],
  ['audible with it up', on && on.rms > 1e-2],
  ['energy sits at the field rate', on && on.buzz > 4 * on.hiss],
  // 2.0x measured. The threshold is under it rather than on it because the
  // baseline is floor-bound and a floor is not a stable thing to divide by.
  ['snow adds hiss', snow && on && snow.hiss > 1.5 * on.hiss],
  [
    'mistuning is louder than the slider alone',
    mistune && on && mistune.rms > on.rms,
  ],
]
let bad = 0
for (const [what, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) bad++
}
console.log(bad === 0 ? '\nall arms passed' : `\n${bad} failed`)
await browser.close()
process.exit(bad === 0 ? 0 : 1)
