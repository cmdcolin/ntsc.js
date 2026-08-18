import { expect, test } from 'vitest'

import { TAPE_FRAMES } from '../signal/constants'
import { TAPS } from '../signal/filters'
import { PRELUDE, TILE_WG } from './prelude'

import { readdirSync, readFileSync } from 'node:fs'

// docs/OPTIMIZATIONS.md is a hand-maintained view of what the shaders and the
// engine actually do, which is the shape that falls behind silently —
// pipeline-graph.test.ts exists because `enhancer` went missing from the
// diagram for several releases, and this page shipped its first draft claiming
// five FIR passes when there are six.
//
// So the countable claims are pinned here. What is deliberately NOT pinned is
// every millisecond in that file: those are measurements of one box on one day,
// they are labelled as such, and a test that demanded they still reproduce
// would fail for the weather.
//
// Read as text, like pipeline-graph.test.ts, for the claims whose source is a
// module needing a GPUDevice or a constant nobody exports.
//
// The doc is whitespace-flattened first, and that is load-bearing rather than
// tidy: oxfmt reflows markdown to 80 columns, so every phrase matched below
// sits one stray word away from being split over a line break. Matching the
// prose as written would make each assertion here a hostage to the wrap.
// ARCHITECTURE.md is read raw, because the one thing wanted from it is inside
// a fenced block where the line structure is the data.
const flat = (text: string) => text.replaceAll(/\s+/g, ' ')
const doc = flat(readFileSync('docs/OPTIMIZATIONS.md', 'utf8'))
const architecture = readFileSync('docs/ARCHITECTURE.md', 'utf8')
const pipeline = readFileSync('src/gpu/pipeline.ts', 'utf8')

const SHADERS = 'src/gpu/shaders'
const shader = (name: string) => readFileSync(`${SHADERS}/${name}`, 'utf8')
const shaderNames = readdirSync(SHADERS).filter(f => f.endsWith('.wgsl'))

// The doc counts small things in words. Spelled out rather than parsed from a
// numeral, because "Six passes filter the waveform" is how the sentence reads
// and rewriting it as "6" to please a test would be the test winning.
const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]
const TENS = ['', '', 'twenty', 'thirty']
const word = (n: number): string => {
  if (n < WORDS.length) return WORDS[n]
  const tens = TENS[Math.floor(n / 10)]
  if (tens === '') throw new Error(`no word for ${n}`)
  return n % 10 === 0 ? tens : `${tens}-${WORDS[n % 10]}`
}

// A `const NAME = 42` the module keeps to itself.
const privateConst = (file: string, name: string) => {
  const m = new RegExp(`const ${name} = (\\d+)`).exec(
    readFileSync(file, 'utf8'),
  )
  if (m === null) throw new Error(`no ${name} in ${file}`)
  return Number(m[1])
}

test('the doc names exactly the passes that filter through the tap bank', () => {
  const filtering = shaderNames
    .filter(f => shader(f).includes('filters['))
    .map(f => f.replace('.wgsl', ''))
    .toSorted()
  const sentence = /(\w+) passes filter the waveform \(([^)]+)\)/.exec(doc)
  if (sentence === null) throw new Error('no FIR-pass sentence in the doc')
  const named = [...sentence[2].matchAll(/`([\w_]+)`/g)]
    .map(m => m[1])
    .toSorted()

  expect(named).toEqual(filtering)
  expect(sentence[1].toLowerCase()).toBe(word(filtering.length))
})

test('the doc counts the shaders that stage workgroup memory', () => {
  const staging = shaderNames.filter(f => shader(f).includes('var<workgroup>'))
  const sentence = /(\w+) shaders stage something in `var<workgroup>`/.exec(doc)
  if (sentence === null) throw new Error('no workgroup-staging sentence')

  expect(sentence[1].toLowerCase()).toBe(word(staging.length))
})

test('the doc quotes the tap range the filter bank actually designs', () => {
  const taps = Object.values(TAPS)
  expect(doc).toContain(`run ${Math.min(...taps)} to ${Math.max(...taps)} taps`)
})

// A WGSL `const NAME = 42u;` out of the generated prelude, which is what every
// shader in the directory actually reads.
const preludeConst = (name: string) => {
  const m = new RegExp(`const ${name} = (\\d+)u;`).exec(PRELUDE)
  if (m === null) throw new Error(`no ${name} in the prelude`)
  return Number(m[1])
}

test('the doc quotes the tile width and the halo the kernels have to fit', () => {
  const halo = preludeConst('HALO')
  // A symmetric kernel centred in the tile reaches `halo` samples either side.
  expect(preludeConst('TILE')).toBe(TILE_WG + 2 * halo)
  expect(Math.max(...Object.values(TAPS))).toBeLessThanOrEqual(2 * halo + 1)

  expect(doc).toContain(`${TILE_WG}-sample span plus a **${halo}-sample halo`)
  expect(doc).toContain(`${TILE_WG}-thread width`)
  expect(doc).toContain(`inside the ${2 * halo + 1} a ${halo}-sample halo`)
})

test('the doc names exactly the controls that rebuild the filter bank', () => {
  const keys = [
    .../const FILTER_KEYS[^[]+\[([^\]]+)\]/
      .exec(pipeline)![1]
      .matchAll(/'(\w+)'/g),
  ].map(m => m[1])
  const sentence = /Only (\w+) control keys touch it \(([^)]+)\)/.exec(doc)
  if (sentence === null) throw new Error('no filter-key sentence in the doc')

  expect([...sentence[2].matchAll(/`(\w+)`/g)].map(m => m[1])).toEqual(keys)
  expect(sentence[1].toLowerCase()).toBe(word(keys.length))
})

test('the doc quotes the readback pool depth', () => {
  const pool = privateConst('src/gpu/buzzread.ts', 'POOL')
  expect(doc).toContain(`a pool of ${word(pool)}`)
})

test('the doc quotes the morph step count and the tape ring depth', () => {
  const steps = privateConst('src/signal/glide.ts', 'COARSE_STEPS')
  expect(doc).toContain(`\`COARSE_STEPS\` (${steps})`)
  expect(doc).toContain(`${TAPE_FRAMES}-frame loop`)
})

test('the doc quotes how many dispatches a frame can run', () => {
  // Counted off ARCHITECTURE.md's pass-order block rather than off pipeline.ts:
  // pipeline-graph.test.ts already holds that block to the engine's arrays, so
  // this asks the count without re-implementing the parser that answers it.
  const passes = ['prePasses', 'loopPasses', 'postPasses'].reduce(
    (n, stage) =>
      n +
      new RegExp(`^${stage} +(.+)$`, 'm')
        .exec(architecture)![1]
        .replace(/\([^)]*\)\s*$/, '')
        .split('→').length,
    0,
  )
  expect(doc).toContain(`up to ${word(passes)} compute`)
})

test('the extraction is non-trivial, so a broken parse fails loudly', () => {
  expect(shaderNames.length).toBeGreaterThan(20)
  expect(doc.length).toBeGreaterThan(10000)
})
