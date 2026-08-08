// The share-link contract: everything a session can be configured with from the
// query string, parsed into one plain value. Pure on purpose — this used to be
// ~90 lines inside useEngine's mount effect, where the only way to check that
// `?preset=vhs&set=noiseIre:9` layers the right way round was to load the app.
//
// It is also what `scripts/shot.mjs` and every verification harness drive the
// app with, so a silent change here breaks them with no test to say so.

import { CONTROL_KEYS, DEFAULT_CONTROLS, LANDING_LOOK } from '../controls'
import { SOURCE_B_MODES, SOURCE_MODES } from '../sources/modes'
import { TELETYPE_DEFAULT, clampCardText } from '../sources/teletype'
import {
  N_SLOTS,
  RATE_MAX,
  RATE_MIN,
  modSource,
  modTarget,
  syncDivision,
} from './modSlots'
import { PRESETS, presetControls } from './presets'

import type { Controls } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { ModRouting } from './modSlots'

// Vaporwave playback defaults, shared with VaporwaveSection so each slider's
// reset point matches the initial state. VAPORWAVE_SPEED is the one-click look.
export const SPEED_DEFAULT = 1
export const REVERB_DEFAULT = 0.3
export const VAPORWAVE_SPEED = 0.66

// The generated sources a link can name. `bars` is the default and `file` /
// `youtube` carry their own url params, so neither ever appears as ?src=.
// `teletype` does appear — the mode is the source, and ?text= alongside it
// carries what is on the card.
//
// `screen` is left out for a different reason than `file` is: a share is not a
// thing a link can name at all. The grant dies with the page, the picker needs
// a gesture the loader does not have, and which window was shared is the
// browser's business, not the app's. Webcam still round-trips — ?src=webcam
// names a device class, and its dialog supplies the gesture on the far end.
const LINKABLE = <T extends string>(modes: readonly T[]) =>
  modes.filter(
    m => m !== 'bars' && m !== 'file' && m !== 'youtube' && m !== 'screen',
  )
const SRC_MODES = LINKABLE(SOURCE_MODES)
const SRCB_MODES = LINKABLE(SOURCE_B_MODES)

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
  // Each slot's teletype card: what it reads and whether it rolls. The text is
  // clamped to the length the dialog allows — a link is untrusted input, and
  // the reveal prints it a chunk at a time, so an unbounded string would be an
  // unbounded animation. `?crawl` alone is a card too: the stock words, rolling.
  card: TeletypeCard | null
  cardb: TeletypeCard | null
  vapor: { speedA: number; speedB: number; reverb: number }
  debug: boolean
  // `?surprise` — roll a random preset stack on load, the same one the button
  // rolls. Layered under ?preset/?set, so an explicit control still wins.
  surprise: boolean
  // What the link says about motion: routings to install, or null for "said
  // nothing", which leaves whatever the browser already had patched. A link
  // written by this app always says something, so null means an old link.
  mod: ModRouting[] | null
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

// `target:source:rateHz:depth` pairs, same separator family as ?set=, with a
// fifth `:division` on a routing whose rate is locked to the beat. Every field
// is checked against the live schema and the numbers are clamped, so a link
// outliving a renamed control or carrying a hand-edited depth loses that one
// routing rather than installing something the panel can't show.
//
// The fifth field is optional at both ends: it is written only by a locked
// routing, and a link from before it existed simply has four, which is the same
// thing an unlocked routing writes today.
function parseMod(raw: string): ModRouting[] {
  const out: ModRouting[] = []
  for (const entry of raw.split(',')) {
    if (out.length === N_SLOTS) break
    const [t, s, r, d, v] = entry.split(':')
    const target = modTarget(t)
    const source = modSource(s)
    const rateHz = Number(r)
    const depth = Number(d)
    if (
      target !== null &&
      source !== null &&
      Number.isFinite(rateHz) &&
      Number.isFinite(depth)
    ) {
      out.push({
        target,
        source,
        rateHz: Math.min(RATE_MAX, Math.max(RATE_MIN, rateHz)),
        depth: Math.min(1, Math.max(0, depth)),
        ...(v === undefined ? {} : (syncDivision(Number(v)) ?? {})),
      })
    }
  }
  return out
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
  const card = (textKey: string, crawlKey: string): TeletypeCard | null => {
    const raw = q.get(textKey)
    const crawl = q.has(crawlKey)
    if (raw === null && !crawl) return null
    return {
      text: raw === null ? TELETYPE_DEFAULT.text : clampCardText(raw),
      crawl,
    }
  }

  const setParam = q.get('set')
  const modParam = q.get('mod')
  const presetName = q.get('preset')
  // Gated on the *params*, not on the lookup: a link naming a preset that has
  // since been retired asked for that preset and got nothing, which is not the
  // same as asking for nothing and getting the landing look.
  const bare = setParam === null && presetName === null && !q.has('surprise')
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
    card: card('text', 'crawl'),
    cardb: card('textb', 'crawlb'),
    vapor: {
      speedA: num('speeda', SPEED_DEFAULT),
      speedB: num('speedb', SPEED_DEFAULT),
      reverb: num('reverb', REVERB_DEFAULT),
    },
    debug: q.has('debug'),
    surprise: q.has('surprise'),
    // ?mod= wins over the preset's own motion, atomically: a link that names
    // both is someone who moved the routings after picking the preset.
    mod:
      modParam !== null
        ? parseMod(modParam)
        : (preset?.mod?.map(m => ({ ...m })) ?? null),
  }
}

// Everything a session serializes back out. The mirror image of what
// parseSessionParams reads, and deliberately in the same file: these are two
// halves of one contract, and while they lived apart they drifted — ?srcb=
// wrote only two of B's modes while the reader was happy to take four, so
// sharing a link with B on static handed the reader bars.
export interface SessionState {
  controls: Controls
  mod: readonly ModRouting[]
  sourceMode: SourceMode
  sourceBMode: SourceBMode
  ytUrlA: string
  ytUrlB: string
  teletypeA: TeletypeCard
  teletypeB: TeletypeCard
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
  // Always emitted too, and for the same reason: a link is a statement about a
  // session, so "nothing is moving" has to be sayable. Without the marker,
  // copying a link while the bay is empty would hand the reader whatever their
  // own browser had patched, over a look that was authored still.
  q.set(
    'mod',
    state.mod
      .map(
        m =>
          `${m.target}:${m.source}:${short(m.rateHz)}:${short(m.depth)}${
            m.syncDiv === undefined ? '' : `:${m.syncDiv}`
          }`,
      )
      .join(','),
  )
  // A one-shot instruction, not part of the look: once the roll has happened,
  // `?set=` above IS what it rolled. Leaving it on would make the link reroll
  // over its own recorded look every time someone opened it.
  q.delete('surprise')
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
  // The card rides alongside ?src=teletype rather than instead of it: the mode
  // is what the slot is showing, the text and the crawl are only how it reads.
  const cardA = state.sourceMode === 'teletype'
  const cardB = state.sourceBMode === 'teletype'
  put('text', cardA && state.teletypeA.text !== '', state.teletypeA.text)
  put('textb', cardB && state.teletypeB.text !== '', state.teletypeB.text)
  put('crawl', cardA && state.teletypeA.crawl, '1')
  put('crawlb', cardB && state.teletypeB.crawl, '1')
  put('speeda', state.speedA !== SPEED_DEFAULT, short(state.speedA))
  put('speedb', state.speedB !== SPEED_DEFAULT, short(state.speedB))
  put('reverb', state.reverb !== REVERB_DEFAULT, short(state.reverb))
  return q
}

// The params a *saved* look carries, as opposed to a shared link. Same writer —
// a saved look is a query string, which is the point of it — but it starts from
// a filtered copy of the live URL rather than from all of it.
//
// `preset=` is what forces the distinction. writeSessionParams leaves unmanaged
// params alone because the loader reads them, and a live address bar that says
// `?preset=vhs` is telling the truth about how this session started. A saved
// look is read back weeks later, and by then it is a lie in a specific way: the
// look records resolved controls in `?set=`, which omits every control resting
// at its default — so a knob the user dragged back to stock after picking vhs is
// absent from `?set=` and supplied again by the preset underneath it. The saved
// look would come back with a value the board did not have when it was saved.
//
// What survives is the addresses: a still, a clip or a YouTube url is the one
// thing about a source that a string can carry, and dropping them would make a
// saved look's link open on bars.
const CARRIED_KEYS = ['iurl', 'iurlb', 'vurl'] as const

export function writeProfileParams(
  existing: URLSearchParams,
  state: SessionState,
): URLSearchParams {
  const base = new URLSearchParams()
  for (const key of CARRIED_KEYS) {
    const value = existing.get(key)
    if (value !== null) base.set(key, value)
  }
  return writeSessionParams(base, state)
}

// Last path segment of a URL, for labeling ?iurl/?vurl sources by name.
export const urlName = (url: string): string => {
  const path = new URL(url, location.href).pathname
  const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  return name === '' ? url : name
}
