// Throwaway: roll ?surprise N times, score each frame, rank them, and montage
// the field so a good gallery set can be picked in one pass instead of one roll
// at a time. Usage: node scripts/_rollsweep.mjs [n=16] [outDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const n = Number(process.argv[2] ?? 16)
const out = process.argv[3] ?? '/tmp/rollsweep'
const base = 'http://localhost:5199/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
mkdirSync(out, { recursive: true })

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})

async function shoot(query, file) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1320, height: 720, deviceScaleFactor: 1 })
  await page.goto(base + query, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas')
  await sleep(4000)
  await page.evaluate(async () => {
    for (let i = 0; i < 150; i++) {
      window.vf?.step()
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 12))
    }
  })
  await page.evaluate(() => {
    const cv = document.querySelector('canvas')
    for (const el of cv.parentElement.children) {
      if (el !== cv) el.style.display = 'none'
    }
  })
  const cv = await page.$('canvas')
  await cv.screenshot({ path: file })
  const url = page.url()
  await page.evaluate(() => window.vf?.destroy()).catch(() => {})
  await page.close()
  return url
}

const num = s => Number(String(s).trim().split(/\s+/)[0])
const metric = (kind, a, b) => {
  try {
    execFileSync('magick', ['compare', '-metric', kind, a, b, 'null:'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return 0
  } catch (e) {
    return num(String(e.stderr))
  }
}

const clean = join(out, 'clean.png')
await shoot('?src=cat', clean)
const cleanBlur = join(out, 'clean-blur.png')
execFileSync('magick', [clean, '-resize', '25%', '-blur', '0x3', cleanBlur])
const [w, h] = execFileSync('magick', ['identify', '-format', '%wx%h', clean])
  .toString()
  .split('x')
  .map(Number)

const rows = []
for (let i = 0; i < n; i++) {
  const file = join(out, `r${String(i).padStart(2, '0')}.png`)
  const url = await shoot('?src=cat&surprise=1', file)
  const blur = join(out, `r${String(i).padStart(2, '0')}-blur.png`)
  execFileSync('magick', [file, '-resize', '25%', '-blur', '0x3', blur])
  // wild: how much of the frame moved off the clean render.
  const wild = metric('AE', file, clean) / (w * h)
  // legible: at a heavy blur the subject should still be roughly where it was —
  // noise mush and a black frame both score badly here.
  const structure = metric('RMSE', blur, cleanBlur) / 65535
  const stats = execFileSync('magick', [
    file,
    '-format',
    '%[fx:mean] %[fx:standard_deviation] %[fx:maxima]',
    'info:',
  ])
    .toString()
    .split(' ')
    .map(Number)
  const [mean, sd] = stats
  const ok = mean > 0.12 && mean < 0.8 && structure < 0.3 && wild > 0.4
  rows.push({ i, file, url, wild, structure, mean, sd, ok })
  console.log(
    `r${i} wild=${wild.toFixed(2)} struct=${structure.toFixed(3)} mean=${mean.toFixed(2)} sd=${sd.toFixed(2)} ${ok ? 'KEEP' : 'drop'}`,
  )
}
await browser.close()

const ranked = rows
  .filter(r => r.ok)
  .toSorted((a, b) => b.wild - a.wild)
  .concat(rows.filter(r => !r.ok))
writeFileSync(join(out, 'rolls.json'), JSON.stringify(ranked, null, 2))
execFileSync('magick', [
  'montage',
  ...ranked.map(r => r.file),
  '-tile',
  '4x',
  '-geometry',
  '300x225+3+3',
  '-background',
  '#111',
  '-label',
  '%f',
  join(out, 'sheet.jpg'),
])
console.log('sheet', join(out, 'sheet.jpg'))
