// Static WGSL validation. Every shader is only compiled at runtime inside the
// browser's WebGPU implementation, so a typo survives until the app runs. Here
// we prepend the same generated PRELUDE the engine uses and hand each shader to
// naga (the wgpu validator) for a real type/borrow/entry-point check at test
// time. Naga is a Rust binary; if it isn't on PATH the suite skips locally but
// CI installs it, so the check is enforced there.

import { describe, expect, it } from 'vitest'

import { PRELUDE } from './prelude'
import blitExt from './shaders/blit_ext.wgsl?raw'
import channel from './shaders/channel.wgsl?raw'
import chromaExtract from './shaders/chroma_extract.wgsl?raw'
import compose from './shaders/compose.wgsl?raw'
import composeB from './shaders/compose_b.wgsl?raw'
import crtFace from './shaders/crt_face.wgsl?raw'
import decode from './shaders/decode.wgsl?raw'
import encodeChromaB from './shaders/encode_chroma_b.wgsl?raw'
import encodeComposite from './shaders/encode_composite.wgsl?raw'
import encodeCompositeB from './shaders/encode_composite_b.wgsl?raw'
import encodeYuv from './shaders/encode_yuv.wgsl?raw'
import enhancer from './shaders/enhancer.wgsl?raw'
import fbComposite from './shaders/fb_composite.wgsl?raw'
import feed from './shaders/feed.wgsl?raw'
import lineAnalyze from './shaders/line_analyze.wgsl?raw'
import mixB from './shaders/mix_b.wgsl?raw'
import present from './shaders/present.wgsl?raw'
import scope_decay from './shaders/scope_decay.wgsl?raw'
import storePrev from './shaders/store_prev.wgsl?raw'
import sync from './shaders/sync.wgsl?raw'
import syncMeasure from './shaders/sync_measure.wgsl?raw'
import tapePlay from './shaders/tape_play.wgsl?raw'
import tapeRec from './shaders/tape_rec.wgsl?raw'
import timebase from './shaders/timebase.wgsl?raw'
import underDown from './shaders/under_down.wgsl?raw'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHADERS: Record<string, string> = {
  blit_ext: blitExt,
  channel,
  chroma_extract: chromaExtract,
  compose,
  compose_b: composeB,
  crt_face: crtFace,
  decode,
  encode_chroma_b: encodeChromaB,
  encode_composite: encodeComposite,
  encode_composite_b: encodeCompositeB,
  encode_yuv: encodeYuv,
  enhancer,
  fb_composite: fbComposite,
  feed,
  line_analyze: lineAnalyze,
  mix_b: mixB,
  present,
  scope_decay,
  store_prev: storePrev,
  sync,
  sync_measure: syncMeasure,
  tape_play: tapePlay,
  tape_rec: tapeRec,
  timebase,
  under_down: underDown,
}

const hasNaga = ((): boolean => {
  try {
    execFileSync('naga', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const dir = hasNaga ? mkdtempSync(join(tmpdir(), 'wgsl-')) : ''

describe('WGSL shaders pass naga validation', () => {
  it('naga must be installed under CI', () => {
    // Locally naga is optional and the per-shader checks below skip without it.
    // CI installs it, so a missing binary there would silently skip the whole
    // validation — fail loudly instead of passing a green build that checked
    // nothing.
    if (process.env.CI !== undefined)
      expect(hasNaga, 'naga not found on PATH in CI').toBe(true)
  })

  it('covers every shader on disk', () => {
    // The map above is hand-kept, so a new .wgsl silently goes unvalidated —
    // exactly how compose_b escaped. Pin it to the directory instead.
    const shaderDir = new URL('./shaders/', import.meta.url)
    const onDisk = readdirSync(shaderDir)
      .filter(f => f.endsWith('.wgsl'))
      .map(f => f.replace(/\.wgsl$/, ''))
    expect(Object.keys(SHADERS).sort()).toEqual(onDisk.sort())
  })

  // Naga cannot catch this one: a shader that declares a binding and never
  // reads it is perfectly valid WGSL, but WebGPU derives the bind group layout
  // from *statically used* resources only, so the unread binding is dropped and
  // a bind group supplying it fails validation against the layout its own
  // pipeline produced. That surfaces at runtime as "BindGroup with '' label is
  // invalid" on set_bind_group, nowhere near the shader that caused it — which
  // is exactly how scope_decay shipped a dead Params binding.
  it('declares no binding it does not read', () => {
    // Comments would otherwise count as uses and mask the very thing this
    // looks for — the dead binding's own explanatory comment names it.
    const stripComments = (text: string) =>
      text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '')
    for (const [name, src] of Object.entries(SHADERS)) {
      const body = stripComments(src)
      const decls = [
        ...body.matchAll(
          /@group\(\d+\)\s*@binding\(\d+\)\s*var(?:<[^>]*>)?\s+(\w+)\s*:/g,
        ),
      ]
      expect(decls.length, `${name} declares no bindings`).toBeGreaterThan(0)
      for (const [decl, binding] of decls) {
        const uses = body
          .replace(decl, '')
          .match(new RegExp(`\\b${binding}\\b`, 'g'))
        expect(
          uses?.length ?? 0,
          `${name}: binding \`${binding}\` is never read`,
        ).toBeGreaterThan(0)
      }
    }
  })

  for (const [name, src] of Object.entries(SHADERS)) {
    it.runIf(hasNaga)(name, () => {
      const file = join(dir, `${name}.wgsl`)
      writeFileSync(file, PRELUDE + src)
      // naga exits non-zero and prints a diagnostic on any validation error;
      // surface that text in the assertion when it throws.
      try {
        execFileSync('naga', [file], { stdio: 'pipe' })
      } catch (e) {
        const err = e as { stderr?: Buffer; stdout?: Buffer }
        expect.fail(
          `${name}.wgsl failed naga validation:\n${err.stderr ?? ''}${err.stdout ?? ''}`,
        )
      }
    })
  }
})
