// The share-link contract: everything a session can be configured with from the
// query string, parsed into one plain value. Pure on purpose — this used to be
// ~90 lines inside useEngine's mount effect, where the only way to check that
// `?preset=vhs&set=noiseIre:9` layers the right way round was to load the app.
//
// It is also what `scripts/shot.mjs` and every verification harness drive the
// app with, so a silent change here breaks them with no test to say so.

import { CONTROL_KEYS, DEFAULT_CONTROLS, LANDING_LOOK } from '../core/controls'
import { SOURCE_B_MODES, SOURCE_MODES } from '../sources/modes'
import { TELETYPE_DEFAULT, clampCardText } from '../sources/teletype'
import { SLIDER_BY_KEY } from './controls'
import { formatCue, parseCue } from './cue'
import {
  N_SLOTS,
  RATE_MAX,
  RATE_MIN,
  modSource,
  modTarget,
  syncDivision,
} from './modSlots'
import { PRESETS, presetControls } from './presets'

import type { Controls } from '../core/controls'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { Cue } from './cue'
import type { ModRouting } from './modSlots'

// Vaporwave playback defaults, shared with the rows that now carry these —
// speed under each source's own transport at the head of its stage, dry and
// reverb under the audio picker — so each slider's reset point matches the
// initial state.
//
// Dry starts at unity because the tail is a send: a clip is heard whole until
// someone decides otherwise, and the reverb slider on its own only ever adds.
// Pulling dry back is how the clip moves off the front of the room instead.
//
// VAPORWAVE_SPEED and VAPORWAVE_DRY are the one-click look, run from the
// command palette — slowed, and heard from the doorway.
export const SPEED_DEFAULT = 1
export const REVERB_DEFAULT = 0.3
export const DRY_DEFAULT = 1
export const VAPORWAVE_SPEED = 0.66
export const VAPORWAVE_DRY = 0.7

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
//
// `library` is out on the same grounds as `file`, one step further along: the
// shelf is this browser's, so an id from it would name nothing in the reader's
// — and a link that opened someone else's app on *their* clip 14 would be worse
// than one that opened on bars. What the slot was on is remembered locally
// instead (fileStash's `lib` kind), which is where that fact belongs.
//
// `browse` is out for a third reason: it is a dialog with a search field, and
// what it was showing is neither a source nor a thing a link can put back. What
// came *out* of it is a public file that would load for anyone, but a link that
// reopened someone else's app on an empty search box would be worse than one
// that opened on bars. The two random archives do round-trip —
// `?src=wiki-random` hands the reader their own roll out of the same pool, which
// is exactly what that option means.
const LINKABLE = <T extends string>(modes: readonly T[]) =>
  modes.filter(
    m =>
      m !== 'bars' &&
      m !== 'file' &&
      m !== 'library' &&
      m !== 'browse' &&
      m !== 'youtube' &&
      m !== 'screen',
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
  // Each slot's teletype card: what it reads, whether it rolls, and whether an
  // unsteady hand redraws it. The text is clamped to the length the dialog
  // allows — a link is untrusted input, and the reveal prints it a chunk at a
  // time, so an unbounded string would be an unbounded animation. `?crawl` or
  // `?boil` alone is a card too: the stock words, moving.
  card: TeletypeCard | null
  cardb: TeletypeCard | null
  vapor: { speedA: number; speedB: number; reverb: number; dry: number }
  // Each slot's cue point, and the loop on it if there was one. Carried because
  // the loop is half of what a link of a clip is *of* — "this two seconds of this
  // file" is the thing being shared, and a link that restored the clip and lost
  // the loop would land somewhere in the middle of it. Only meaningful next to a
  // source the link also names, so it rides with ?vurl and the shelf modes and is
  // simply ignored by a link that names neither.
  cueA: Cue | null
  cueB: Cue | null
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
//
// And clamped to the control's own range, which finiteness alone does not buy.
// Every link this app writes is already in range — `writeSessionParams` reads
// live controls, and those come from a slider, a preset or `snapToStep` — so
// this is only ever about a hand-edited one, and one of those can stop the app
// dead. Measured: `?set=frameLock:-1` gives the render loop a divisor of 0, and
// `lockPhase % 0` is NaN, so the equality that gates a rendered frame is never
// true and the picture freezes on frame 0 for good. That is indistinguishable
// on screen from the lost rendering step in docs/adr/0004 — the one fault whose
// whole diagnosis is "this is not the signal path" — so a link must not be able
// to counterfeit it.
//
// Clamped rather than snapped to the step grid: clamping is the safety
// property, while snapping would quietly move values in existing links that
// were doing no harm.
function parseSet(raw: string): Partial<Controls> {
  const patch: Partial<Controls> = {}
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split(':')
    const n = Number(v)
    const key = CONTROL_KEYS.find(c => c === k)
    if (key !== undefined && Number.isFinite(n)) {
      const def = SLIDER_BY_KEY.get(key)
      patch[key] =
        def === undefined ? n : Math.min(def.max, Math.max(def.min, n))
    }
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
  const card = (
    textKey: string,
    crawlKey: string,
    boilKey: string,
  ): TeletypeCard | null => {
    const raw = q.get(textKey)
    const crawl = q.has(crawlKey)
    const boil = q.has(boilKey)
    if (raw === null && !crawl && !boil) return null
    return {
      text: raw === null ? TELETYPE_DEFAULT.text : clampCardText(raw),
      crawl,
      boil,
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
    card: card('text', 'crawl', 'boil'),
    cardb: card('textb', 'crawlb', 'boilb'),
    vapor: {
      speedA: num('speeda', SPEED_DEFAULT),
      speedB: num('speedb', SPEED_DEFAULT),
      reverb: num('reverb', REVERB_DEFAULT),
      dry: num('dry', DRY_DEFAULT),
    },
    cueA: parseCue(q.get('cuea')),
    cueB: parseCue(q.get('cueb')),
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
// Why each field is in here belongs *here* rather than beside whoever collects
// it: what a link carries is a decision about the format, and the reader below
// is who has to honour it. `useUrlState` takes this interface whole for the same
// reason — a second hand-kept copy of this list was the drift above waiting to
// happen again.
export interface SessionState {
  controls: Controls
  // What is moving, so a shared link carries the motion and not just the look.
  mod: readonly ModRouting[]
  sourceMode: SourceMode
  sourceBMode: SourceBMode
  // The YouTube source URLs, so a refresh or shared link restores the clips.
  // Audio-out isn't serialized: browsers block unmuted autoplay, so a restored
  // clip must start muted and be un-muted by a click.
  ytUrlA: string
  ytUrlB: string
  // Each slot's teletype card, so a shared link carries the words and the roll
  // as well as the mode.
  teletypeA: TeletypeCard
  teletypeB: TeletypeCard
  // The vaporwave look: each deck slowed down, the room it plays in, and how
  // much of the clip itself is heard in front of that room.
  speedA: number
  speedB: number
  reverb: number
  dry: number
  // Each slot's cue point, so a shared link of a clip carries the loop that was
  // marked on it as well as the clip itself.
  cueA: Cue | null
  cueB: Cue | null
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
  // is what the slot is showing; the text, the crawl and the boil are only how
  // it reads.
  const cardA = state.sourceMode === 'teletype'
  const cardB = state.sourceBMode === 'teletype'
  put('text', cardA && state.teletypeA.text !== '', state.teletypeA.text)
  put('textb', cardB && state.teletypeB.text !== '', state.teletypeB.text)
  put('crawl', cardA && state.teletypeA.crawl, '1')
  put('crawlb', cardB && state.teletypeB.crawl, '1')
  put('boil', cardA && state.teletypeA.boil, '1')
  put('boilb', cardB && state.teletypeB.boil, '1')
  put('speeda', state.speedA !== SPEED_DEFAULT, short(state.speedA))
  put('speedb', state.speedB !== SPEED_DEFAULT, short(state.speedB))
  put('cuea', state.cueA !== null, formatCue(state.cueA))
  put('cueb', state.cueB !== null, formatCue(state.cueB))
  put('reverb', state.reverb !== REVERB_DEFAULT, short(state.reverb))
  put('dry', state.dry !== DRY_DEFAULT, short(state.dry))
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
//
// Never throws, which is the whole of the try. `new URL` rejects a handful of
// strings even with a base — `?vurl=http://` is one — and this is called
// straight from `restoreSession` for ?vurl, where a throw would abandon the
// rest of the restore: the vaporwave settings, the YouTube params, and the
// stash reopen that puts a slot back on last session's clip. A caption is not
// worth any of those, so an unparseable url is simply its own label. It is
// also, at that point, a url the <video> is about to refuse for the same
// reason, and *that* failure has a banner of its own.
export const urlName = (url: string): string => {
  try {
    // The base is only ever needed to resolve a *relative* url, and only a
    // document has one — read off globalThis rather than as a bare `location`
    // so this stays a function about a string, testable without a DOM. Reading
    // the bare global instead made every call throw under the test runner, and
    // the catch above swallowed it: the happy path could not be asserted at all.
    const path = new URL(url, globalThis.location?.href).pathname
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    return name === '' ? url : name
  } catch {
    return url
  }
}
