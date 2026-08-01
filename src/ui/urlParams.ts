// The share-link contract: everything a session can be configured with from the
// query string, parsed into one plain value. Pure on purpose — this used to be
// ~90 lines inside useEngine's mount effect, where the only way to check that
// `?preset=vhs&set=noiseIre:9` layers the right way round was to load the app.
//
// It is also what `scripts/shot.mjs` and every verification harness drive the
// app with, so a silent change here breaks them with no test to say so.

import { CONTROL_KEYS, DEFAULT_CONTROLS } from '../controls'
import { SOURCE_B_MODES, SOURCE_MODES } from '../sources/modes'
import { PRESETS, presetControls } from './presets'

import type { Controls } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'

// What a bare load (no ?preset/?set) lands on: a whisper of source B summed
// into the composite, so the mixer is visibly doing something on arrival. Kept
// out of DEFAULT_CONTROLS so `clean` and hold-to-compare stay truly clean.
export const LANDING_LOOK: Partial<Controls> = { bGain: 0.16 }

// Vaporwave playback defaults, shared with VaporwaveSection so each slider's
// reset point matches the initial state. VAPORWAVE_SPEED is the one-click look.
export const SPEED_DEFAULT = 1
export const REVERB_DEFAULT = 0.3
export const VAPORWAVE_SPEED = 0.66

// The generated sources a link can name. `bars` is the default and `file` /
// `youtube` carry their own url params, so neither ever appears as ?src=.
const SRC_MODES = SOURCE_MODES.filter(
  m => m !== 'bars' && m !== 'file' && m !== 'youtube',
)
const SRCB_MODES = SOURCE_B_MODES.filter(
  m => m !== 'bars' && m !== 'file' && m !== 'youtube',
)

export interface SessionParams {
  // Every control the link asks for, already layered: the landing look or the
  // named preset, then ?set on top. One patch, so the caller makes one write.
  controls: Partial<Controls>
  src: SourceMode | null
  srcb: SourceBMode | null
  // Still/clip urls, loaded asynchronously by the caller.
  iurl: string | null
  iurlb: string | null
  vurl: string | null
  yt: string | null
  ytb: string | null
  vapor: { speedA: number; speedB: number; reverb: number }
  debug: boolean
}

// `key:value` pairs against the control schema. Anything unrecognised or
// non-finite is dropped rather than poisoning the look — a link outliving a
// renamed control should lose that one knob, not fail to load.
function parseSet(raw: string): Partial<Controls> {
  const patch: Partial<Controls> = {}
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split(':')
    const n = Number(v)
    const key = CONTROL_KEYS.find(c => c === k)
    if (key !== undefined && Number.isFinite(n)) patch[key] = n
  }
  return patch
}

export function parseSessionParams(search: string): SessionParams {
  const q = new URLSearchParams(search)
  const num = (key: string, fallback: number): number => {
    const raw = q.get(key)
    const n = raw === null ? fallback : Number(raw)
    return Number.isFinite(n) ? n : fallback
  }
  const one = <T extends string>(
    key: string,
    allowed: readonly T[],
  ): T | null => allowed.find(m => m === q.get(key)) ?? null

  const setParam = q.get('set')
  const presetName = q.get('preset')
  // Gated on the *params*, not on the lookup: a link naming a preset that has
  // since been retired asked for that preset and got nothing, which is not the
  // same as asking for nothing and getting the landing look.
  const bare = setParam === null && presetName === null
  const preset = PRESETS.find(p => p.name === presetName)
  return {
    controls: {
      ...(bare ? LANDING_LOOK : {}),
      // A preset is a full control set, not a patch — it resets what it does
      // not name — so ?set has to layer on top of it, in that order.
      ...(preset === undefined ? {} : presetControls(preset.patch)),
      ...(setParam === null ? {} : parseSet(setParam)),
    },
    src: one('src', SRC_MODES),
    srcb: one('srcb', SRCB_MODES),
    iurl: q.get('iurl'),
    iurlb: q.get('iurlb'),
    vurl: q.get('vurl'),
    yt: q.get('yt'),
    ytb: q.get('ytb'),
    vapor: {
      speedA: num('speeda', SPEED_DEFAULT),
      speedB: num('speedb', SPEED_DEFAULT),
      reverb: num('reverb', REVERB_DEFAULT),
    },
    debug: q.has('debug'),
  }
}

// Everything a session serializes back out. The mirror image of what
// parseSessionParams reads, and deliberately in the same file: these are two
// halves of one contract, and while they lived apart they drifted — ?srcb=
// wrote only two of B's modes while the reader was happy to take four, so
// sharing a link with B on static handed the reader bars.
export interface SessionState {
  controls: Controls
  sourceMode: SourceMode
  sourceBMode: SourceBMode
  ytUrlA: string
  ytUrlB: string
  speedA: number
  speedB: number
  reverb: number
}

// The value a link records for a control: 4 decimals is lossless, since the
// finest slider step in the schema is 0.001.
const short = (v: number): string => String(+v.toFixed(4))

// Rewrite the managed keys from live state, leaving every other param alone —
// the loader also reads iurl, iurlb, vurl, preset and debug, and a URL-loaded
// source has to survive the user then touching a slider.
export function writeSessionParams(
  existing: URLSearchParams,
  state: SessionState,
): URLSearchParams {
  const q = new URLSearchParams(existing)
  const put = (key: string, on: boolean, value: string) =>
    on ? q.set(key, value) : q.delete(key)
  const set = CONTROL_KEYS.filter(
    k => state.controls[k] !== DEFAULT_CONTROLS[k],
  ).map(k => `${k}:${short(state.controls[k])}`)
  // Always emitted, even empty. A link is a statement about a session, so
  // `?set=` — this look is stock — has to stay distinguishable from no query at
  // all, which is someone arriving for the first time and getting the landing
  // look. Without the marker, copying a link while on `clean` handed the reader
  // source B mixed in rather than the clean picture on screen.
  q.set('set', set.join(','))
  // A mode is worth recording when the reader would accept it back; youtube
  // carries its own yt=/ytb= key (the URL, not just the mode name).
  put(
    'src',
    SRC_MODES.some(m => m === state.sourceMode),
    state.sourceMode,
  )
  put(
    'srcb',
    SRCB_MODES.some(m => m === state.sourceBMode),
    state.sourceBMode,
  )
  put('yt', state.sourceMode === 'youtube' && state.ytUrlA !== '', state.ytUrlA)
  put(
    'ytb',
    state.sourceBMode === 'youtube' && state.ytUrlB !== '',
    state.ytUrlB,
  )
  put('speeda', state.speedA !== SPEED_DEFAULT, short(state.speedA))
  put('speedb', state.speedB !== SPEED_DEFAULT, short(state.speedB))
  put('reverb', state.reverb !== REVERB_DEFAULT, short(state.reverb))
  return q
}

// Last path segment of a URL, for labeling ?iurl/?vurl sources by name.
export const urlName = (url: string): string => {
  const path = new URL(url, location.href).pathname
  const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  return name === '' ? url : name
}
