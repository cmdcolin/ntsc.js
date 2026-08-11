// The rundown, and the walk down it. Pure — nothing here touches React, the
// engine, or the network.
//
// The design is [`docs/EDITOR.md`](../../docs/EDITOR.md) › _The strip_. What
// this file is responsible for is the part that is easy to get subtly wrong and
// expensive to debug in a browser: where the walk is, when a row's hold is up,
// and which numbers a roll draws. `advance` decides; `useStrip` carries out.
//
// **Effects rather than calls** is the whole shape. `advance` returns a list of
// things to do — put this session up, roll a pool, shake the look — and never
// does any of them, so the boundary between "the walk said so" and "the browser
// did it" is a value a test can assert on. Every bug this file could have is
// then a wrong list rather than a wrong picture.

import { randomSeed, rngFor } from '../rng'
import { clipUrl, isClipId } from '../sources/clips'
import { SOURCE_DESC, SOURCE_MODES } from '../sources/modes'
import { MODE_ORIGIN, isPoolMode } from '../sources/pools'
import { parseCue } from './cue'
import { MORPH_SECONDS } from './morph'
import { parseMutateAmount } from './mutate'
import { cleanProfileName } from './savedProfiles'
import { readRecord, writeJSON } from './storage'
import { TRANSITION_NAMES, transitionOf } from './transitions'
import { urlName } from './urlParams'

import type { PoolOrigin } from '../sources/pools'
import type { MorphSeconds } from './morph'
import type { MutateAmount } from './mutate'
import type { TransitionName } from './transitions'

// --- the row ----------------------------------------------------------------

// What resolving a row costs when it fires — the "three kinds of row, one
// shape" of the design.
//
// `clip` is the ordinary one: the session string below says everything, so
// firing is a write. `roll` names a pool rather than a file and resolves it at
// fire time. `jitter` keeps whatever is up and shakes the look instead.
//
// Deliberately stored, not derived. `rowFill` below reads it off a session
// string, and a captured row records the answer so the tray can draw a card
// without parsing four hundred characters of query string per row per render.
// The two cannot drift because `rowFill` is the only thing that ever writes it.
export type RowFill =
  | { kind: 'clip' }
  | { kind: 'roll'; origin: PoolOrigin }
  | { kind: 'jitter'; amount: MutateAmount }

// How long a row holds.
//
// `bars: null` waits for a hand — the row that ends a section, or the whole
// strip used as a bank of scenes with no timing at all. Otherwise it is "≈N
// bars", loosely: `drift` is a fraction of the hold, so 0.25 lands the boundary
// anywhere in ±a quarter of it, and 0 is the exact beat-lock the design keeps
// available per row for the cut that has to land on a hit.
//
// The default being loose is the taste call EDITOR.md names as one, and it is
// worth keeping visible here: a strip whose holds drift is a pattern rather
// than an edit.
export interface Hold {
  bars: number | null
  drift: number
}

export const DEFAULT_HOLD: Hold = { bars: 4, drift: 0.25 }

// Widest a drift can be asked for. Half a hold either way is already the
// difference between three bars and five; past that the hold stops being "≈4
// bars" and becomes a coin toss, which is a different feature and not a better
// one.
export const MAX_DRIFT = 0.5

export interface Row {
  id: string
  // What this row is called, or '' for "read it off the session".
  //
  // A name rather than only a derived label because the derivation cannot tell
  // two rows apart when it matters most: a rundown of look changes over one
  // clip is all "look only", which is accurate and useless. It is also the
  // field that makes a strip legible to someone who did not build it — the
  // rundown a broadcast gallery works from is a list of names, not of sources.
  //
  // Empty rather than optional, and derived on read rather than filled in at
  // capture: a row named after the preset it was captured from would go on
  // claiming that name after its controls had been dragged somewhere else, and
  // a stale name is worse than no name. What is offered at capture is a
  // *suggestion* the caller passes in; the moment someone edits it, it is
  // theirs and nothing overwrites it.
  name: string
  // Everything this row puts up, as a query string: source, cue, look and
  // motion, in the contract `urlParams` already owns.
  //
  // `writeProfileParams`' output rather than `writeSessionParams`', and the
  // difference matters here for exactly the reason that function was split out
  // — a row is read back weeks later, and a live link's `?preset=` would by
  // then re-supply a knob the hand had already put back to stock.
  session: string
  fill: RowFill
  hold: Hold
  // How the row arrives, in the two senses that are genuinely different things.
  //
  // `seconds` is how the *look* arrives: a morph over the resting board, or 0
  // to cut. `transition` is how the *source* arrives: a named fault off the
  // shelf (EDITOR.md › _Transitions_) that breaks the picture, swaps the row in
  // on the frame it is least legible, and heals onto it — or null for the plain
  // cut, which is what every row had before the shelf was reachable from one
  // and is still the default.
  //
  // The two compose rather than competing, which is the pairing _Transitions_
  // asks for: the look glides while the fault does the cutting. That is also
  // why this stayed an object when it held one field — a bare number would have
  // made today a codec migration.
  arrive: { seconds: MorphSeconds; transition: TransitionName | null }
}

// A whole rundown.
//
// `seed` is the one field that cannot be added later. Every roll and every
// drifted hold draws from it, so a strip without one is a strip whose takes are
// unreproducible — which is the failure EDITOR.md › _Seeding_ exists to
// prevent, and the reason this is here in the first commit rather than the
// third.
export interface Strip {
  rows: readonly Row[]
  seed: number
  // Whether the walk comes back round. On for a set, off for a piece with an
  // ending — and off is what gives an offline render a natural last frame.
  loop: boolean
}

export const EMPTY_STRIP: Strip = { rows: [], seed: 1, loop: true }

// --- where the walk is ------------------------------------------------------

export interface Walk {
  // Which row is up. -1 is stopped, which is also where a walk starts.
  row: number
  // How many times round. Part of the seed derivation below, so lap two rolls
  // differently from lap one — and does so reproducibly, which is the point.
  lap: number
  // The frame the current row fired on.
  since: number
  // How long it holds, in frames, or null to wait for a hand.
  //
  // Resolved once, when the row fires, rather than recomputed per tick. Drift
  // is rolled per fire, so a hold recomputed every tick would be a boundary
  // that moved every time it was asked about and a row that never ended.
  frames: number | null
}

export const STOPPED: Walk = { row: -1, lap: 0, since: 0, frames: null }

export const walking = (walk: Walk): boolean => walk.row >= 0

// What the walk is measured against. One object because it is the thing that
// differs between the two clocks — live, `frame` comes off the engine's own
// counter at whatever rate it is running; offline, it is the render's frame
// index — and everything else in this file is indifferent to which.
export interface Clock {
  frame: number
  // Already resolved. `useTempo.ensure()` puts a tempo there when there is
  // none, on the rule the bay already follows for patching into a frozen board:
  // asking for the thing is unambiguous, so the ask wins.
  bpm: number
  fps: number
}

// --- what a fire asks for ---------------------------------------------------

// One thing the driver has to do, in the order returned. Everything a row can
// ask for *except* the deferral below, which wraps a list of these rather than
// being one of them.
export type PlainEffect =
  // Put this session up: the source it names, the cue on it, and the look,
  // arriving over `seconds` (0 cuts).
  | { kind: 'session'; session: string; seconds: MorphSeconds }
  // Roll this pool and put what comes back on the deck. The seed is the row's,
  // so re-walking the same strip asks the same questions — though not
  // necessarily of the same file, which is `rng.ts`'s note and EDITOR.md's.
  | { kind: 'roll'; origin: PoolOrigin; seed: number }
  // Shake the live look. Not a stored look: a jitter row is a departure from
  // whatever is on the board when it fires, which is why it carries an amount
  // and a seed rather than controls.
  | { kind: 'jitter'; amount: MutateAmount; seed: number }
  // Load the clip the *next* row will want, and park it at its in-point. Fired
  // with the row that precedes it, so the load has that row's whole hold to
  // finish in — which is the whole of preroll depth 1 (docs/EDITOR.md ›
  // _Performance: the boundary is the only cost_).
  //
  // Carries a url rather than a row or a session, because that is all a slot
  // can act on and all that has to be true for the promotion to be a swap: at
  // the cut, `playUrl` takes the parked element if it is this exact url. A row
  // whose source cannot be named ahead of time — a pool, which is a search
  // rather than a file — simply produces no such effect.
  | { kind: 'preroll'; url: string; start: number }

// What the driver is handed. Either a row's step outright, or that same step
// behind a named fault (EDITOR.md › _Transitions_): break the picture, and do
// all of it on the frame the picture is least legible.
//
// **The fault carries the whole step, not only the session**, and that is the
// correction this variant exists in its current shape for. Deferring the
// session alone and letting the rest of the row fire now inverts the order
// `fireEffects` is careful about, in three ways that all bite:
//
//   - a roll would land *before* the session naming its pool, and since
//     `applySession` re-rolls a `?src=…-random` itself, the engine's own
//     unseeded roll would then outrun the seeded one and win. A take stops
//     reproducing, which is the one rule adr/0006 says must not break.
//   - a jitter would be overwritten by the session it was supposed to be a
//     departure *from*.
//   - the lookahead would retire the very element the cut was about to promote.
//     There is one parked element per slot and `prerollUrl` clears it, so a
//     transition row prerolled the *next* row's clip over its own and every cut
//     paid the cold price — the price preroll exists to remove, on the rows it
//     was built for.
//
// So the rule is one sentence: **a transition row does at the cut exactly what
// a plain row does when it fires.** `atCut` is that step, verbatim.
//
// One level deep by construction, since `atCut` holds `PlainEffect`: a fault
// cannot carry a fault, which is the only nesting that would need a policy —
// and it is the type that says so, so there is no runtime check to keep.
export type Effect =
  | PlainEffect
  | { kind: 'fault'; transition: TransitionName; atCut: readonly PlainEffect[] }

// The generator for one fire of one row.
//
// Derived from the three things that identify it rather than drawn off a
// running cursor, which is what makes the walk replayable from any point: state
// is four plain numbers, and re-entering row 3 on lap 2 asks the same question
// whether it was reached by playing from the top or by a hand jumping there.
// The vote page derives its pair seeds the same way and for the same reason.
//
// Mixed rather than added, so (seed 1, row 2) and (seed 2, row 1) are not the
// same draw. The constants are the odd multipliers Knuth-style mixing uses;
// nothing here needs them to be good, only to separate.
export const seedFor = (seed: number, row: number, lap: number): number =>
  (Math.imul(seed | 0, 0x9e3779b1) ^
    Math.imul(row + 1, 0x85ebca6b) ^
    Math.imul(lap + 1, 0xc2b2ae35)) >>>
  0

// How many frames a hold lasts, or null when it waits for a hand.
//
// Four beats to the bar, which is the assumption `useTempo` already makes
// everywhere else. Floored at one frame: a hold of zero would fire every row in
// the strip on one tick, which reads as the strip having emptied itself.
export function holdFrames(
  hold: Hold,
  clock: Clock,
  seed: number,
): number | null {
  if (hold.bars === null) return null
  const beats = hold.bars * 4
  const seconds = (beats * 60) / clock.bpm
  // One draw, at the moment the row fires. `rngFor` is constructed here rather
  // than threaded so the answer depends on the seed alone — the same row on the
  // same lap drifts by the same amount however it was reached.
  const drift = Math.min(MAX_DRIFT, Math.max(0, hold.drift))
  const spread = drift === 0 ? 0 : (rngFor(seed)() * 2 - 1) * drift
  return Math.max(1, Math.round(seconds * (1 + spread) * clock.fps))
}

// What a row does, in the order it does it, with no regard for *when*.
//
// Ordered, and every part of the order is load-bearing. The session goes up
// before the roll or the jitter lands on it, because both are departures *from*
// what the session named. The lookahead comes last, after the row's own
// effects, so the deck is pointed at what is on air before anything starts
// fetching what follows — and, since a slot parks one element, so that a
// promotion of this row's clip has happened before the next row's replaces it.
//
// One list whether or not the row names a transition: `fireEffects` decides
// when it runs, and nothing here has to know which of the two it is.
function stepEffects(
  row: Row,
  seed: number,
  ahead: Lookahead | null,
): PlainEffect[] {
  const out: PlainEffect[] = [
    { kind: 'session', session: row.session, seconds: row.arrive.seconds },
  ]
  if (row.fill.kind === 'roll') {
    out.push({ kind: 'roll', origin: row.fill.origin, seed })
  } else if (row.fill.kind === 'jitter') {
    out.push({ kind: 'jitter', amount: row.fill.amount, seed })
  }
  if (ahead !== null) out.push({ kind: 'preroll', ...ahead })
  return out
}

// What firing one row asks for: the step above, now if the row arrives plainly
// and on the fault's cut frame if it names a transition. The whole of the
// difference between the two is *when*, which is why it is a wrapper around one
// list rather than a different list.
export function fireEffects(
  row: Row,
  seed: number,
  ahead: Lookahead | null = null,
): Effect[] {
  const step = stepEffects(row, seed, ahead)
  // Narrowed here rather than trusted, even though `readArrive` already
  // narrows: a row can also be built by hand — a harness, a test, an object
  // literal that never went through the codec — and `undefined` is not `null`.
  // Tested against null alone this fell into the fault branch and handed the
  // engine an undefined transition, which `scripts/rendercheck.mjs` found by
  // building a rundown the way a caller naturally would. Anything that is not a
  // name this build has arrives plainly, which is the answer `readArrive` gives
  // and the one `useEngine.faultTo` gives at the far end.
  const transition =
    TRANSITION_NAMES.find(t => t === row.arrive.transition) ?? null
  return transition === null
    ? step
    : [{ kind: 'fault', transition, atCut: step }]
}

// A clip to park before the cut that wants it: all a slot can act on, and all
// `fireEffects` needs in order to put the ask in the right place in the step.
export interface Lookahead {
  url: string
  start: number
}

// The clip a row will want, when it wants one that can be named in advance.
//
// Two sources answer, and they are the two a row can carry a *file* for: an
// explicit `?vurl`, and a bundled clip named by `?src=clip-…`, which is an id
// this side already resolves to a url. Everything else answers null and means
// it: a pool is a search rather than a file (nothing to load until it is
// rolled), a still needs no element, and a look-only row leaves the deck where
// it is — which is the case preroll exists to make free, since it is the one
// with no boundary cost at all.
//
// `start` comes off the row's own cue, because a row is "this stretch of this
// clip" and parking the element anywhere else would leave the promotion with a
// seek to do on the frame it was supposed to be a cut.
export function prerollFor(row: Row): Lookahead | null {
  const q = new URLSearchParams(row.session)
  const src = q.get('src')
  const url =
    q.get('vurl') ?? (src !== null && isClipId(src) ? clipUrl(src) : null)
  if (url === null) return null
  return { url, start: parseCue(q.get('cuea'))?.in ?? 0 }
}

// Which row a walk will reach next, or null when there is not one — the end of
// a rundown that does not come back round. Its own function because `land`
// wants it and so does a test: "what does this rundown load next" is a question
// about the list, not about the frame it is asked on.
export const nextRow = (strip: Strip, index: number): Row | null =>
  strip.rows[index + 1] ?? (strip.loop ? (strip.rows[0] ?? null) : null)

// --- the walk ---------------------------------------------------------------

export interface Step {
  walk: Walk
  effects: Effect[]
}

// Land on a row: the one place a Walk is built, so every way of getting to a
// row — starting, running on, a hand jumping — resolves its hold and draws its
// seed identically.
function land(strip: Strip, index: number, lap: number, clock: Clock): Step {
  const row = strip.rows[index]
  const seed = seedFor(strip.seed, index, lap)
  // The lookahead, and *which clip* it is belongs here rather than in
  // `fireEffects` because it is a fact about the rundown and not about the row:
  // firing row 3 by hand out of a bank of scenes should still load whatever row
  // 4 would want, since running on is what a walk does next either way.
  //
  // Handed to `fireEffects` rather than appended after it, because where it
  // goes in the step is the row's business: last, and behind the same fault the
  // rest of the step is behind. Appended out here it fired while a transition
  // row's own session was still waiting on the cut, and retired the element
  // that cut was about to promote. A rundown of one looping row prerolls the
  // clip it is already playing, which `playUrl` spends as a swap to a second
  // element parked at the in-point — an odd-looking case that happens to be the
  // loop's best behaviour.
  const ahead = nextRow(strip, index)
  return {
    walk: {
      row: index,
      lap,
      since: clock.frame,
      frames: holdFrames(row.hold, clock, seed),
    },
    effects: fireEffects(row, seed, ahead === null ? null : prerollFor(ahead)),
  }
}

// Start the walk at the top. An empty strip stays stopped rather than pretending
// to run — a transport that says it is playing with nothing to play is the
// worse of the two lies.
export const start = (strip: Strip, clock: Clock): Step =>
  strip.rows.length === 0
    ? { walk: STOPPED, effects: [] }
    : land(strip, 0, 0, clock)

// A hand putting the walk on a particular row. Out-of-range is a no-op rather
// than a clamp: the callers are a click on a row and a MIDI pad bound to one,
// and a pad bound to row 7 of a strip that has since lost three rows should do
// nothing rather than fire row 4.
export function fire(
  strip: Strip,
  walk: Walk,
  index: number,
  clock: Clock,
): Step {
  if (index < 0 || index >= strip.rows.length) return { walk, effects: [] }
  return land(strip, index, Math.max(0, walk.lap), clock)
}

// One tick. Null when there is nothing to do, which is nearly every tick — the
// caller polls this at whatever rate it likes and only acts when a boundary has
// actually been crossed.
//
// Deliberately advances by one row per call and not by however many holds have
// elapsed. A tick that arrives late (a slow frame, a tab that was hidden, an
// offline render stepping coarsely) would otherwise fire three rows into the
// void to catch up, and every one of them would have loaded a source nobody
// saw. Late means the next row is late, not that the strip skips.
export function advance(strip: Strip, walk: Walk, clock: Clock): Step | null {
  if (!walking(walk) || walk.frames === null) return null
  if (clock.frame - walk.since < walk.frames) return null
  // A row that outlived its strip — the list was edited under a running walk —
  // is the same case as running off the end.
  const next = walk.row + 1
  if (next < strip.rows.length) return land(strip, next, walk.lap, clock)
  if (!strip.loop || strip.rows.length === 0) {
    return { walk: STOPPED, effects: [] }
  }
  return land(strip, 0, walk.lap + 1, clock)
}

// How far through its hold the current row is, 0..1, or null when there is
// nothing to draw — stopped, or holding for a hand. For the row card's fill.
export function holdProgress(walk: Walk, clock: Clock): number | null {
  if (!walking(walk) || walk.frames === null || walk.frames <= 0) return null
  const through = (clock.frame - walk.since) / walk.frames
  return Math.min(1, Math.max(0, through))
}

// --- reading a row off a session string -------------------------------------

// What kind of row a captured session is. The one writer of `Row.fill`.
//
// The pool question is asked through `isPoolMode`/`MODE_ORIGIN` rather than by
// matching `?src=` against a list of this file's own: which modes are pools is
// `sources/pools.ts`'s to say, and a second copy here would go stale the day a
// third source is added — which that file's header says is a module beside the
// other two and four lines in it.
//
// A jitter row is never derived. Nothing about a session string says "and then
// shake it", because that is a statement about the row rather than about the
// session, so it is chosen in the tray and passed in.
export function rowFill(session: string, jitter?: MutateAmount): RowFill {
  if (jitter !== undefined) return { kind: 'jitter', amount: jitter }
  const src = new URLSearchParams(session).get('src')
  return src !== null && isPoolMode(src)
    ? { kind: 'roll', origin: MODE_ORIGIN[src] }
    : { kind: 'clip' }
}

// What a row is called when nobody has said. Here rather than in the component
// because it is the same act as `rowFill` — reading a session string — and
// because a string a pure function derives is a string a test can pin.
//
// `SOURCE_DESC`'s entries read "Color bars — SMPTE test pattern", which is a
// name and then an explanation; a card has room for the name. Splitting on the
// em dash rather than keeping a second table of short names is what stops the
// two drifting when a mode is renamed.
export function derivedLabel(row: Row): string {
  if (row.fill.kind === 'jitter') return `shake · ${row.fill.amount}`
  const q = new URLSearchParams(row.session)
  const url = q.get('vurl') ?? q.get('iurl')
  if (url !== null) return urlName(url)
  if (q.get('yt') !== null) return 'YouTube'
  const src = q.get('src')
  if (src === null) {
    // A row that names no source is not a broken row: it is a look change over
    // whatever is already up, which is a thing a set actually wants — and the
    // one kind of row that costs nothing at the boundary, since there is no
    // load.
    return 'look only'
  }
  // Narrowed through the mode list rather than asserted: `?src=` is a stored
  // string, and a row written by a build that had a mode this one does not
  // should read as its own name rather than index a record with a key that is
  // not in it.
  const mode = SOURCE_MODES.find(m => m === src)
  return mode === undefined ? src : (SOURCE_DESC[mode].split(' — ')[0] ?? src)
}

// What the card actually says. The given name when there is one, and what the
// session says otherwise — so an unnamed rundown still reads, and a named one
// reads as whatever its author called it.
export const rowLabel = (row: Row): string =>
  row.name === '' ? derivedLabel(row) : row.name

// Whether this row is wearing a name of its own, for the card: a given name and
// a derived one are the same kind of string, and drawing them the same way
// would leave no way to tell "the author called this the drop" from "the app
// worked out that this is a sweep".
export const named = (row: Row): boolean => row.name !== ''

// How the hold reads on the card. The `≈` is the whole point of the default —
// it says out loud that the boundary is not where the number says, which is the
// taste call in _Loose holds by default_ made visible rather than hidden in a
// field nobody opens.
export function holdLabel(hold: Hold): string {
  if (hold.bars === null) return 'hold'
  const bars = `${hold.bars} bar${hold.bars === 1 ? '' : 's'}`
  return hold.drift === 0 ? bars : `≈${bars}`
}

// --- editing the rundown ----------------------------------------------------
//
// All pure, and all in terms of whole strips, so the hook's verbs are one line
// each and the arithmetic that can be off by one is tested without a browser.

// What the hold chip steps through. Powers of two up to four bars of four, then
// "wait for a hand" — which belongs in the ring rather than in a menu, because
// the row that ends a section is the one you most often want to reach for
// mid-set.
export const HOLD_BARS = [1, 2, 4, 8, 16, null] as const

// The widest the hold chip can ever read, in characters.
//
// A property of the *ring* rather than of the hold sitting in it, which is the
// rule `Slider`'s `--reading-ch` already states for a readout and is here for
// the same failure: a row card is as wide as its widest line, so a chip that
// grew as it stepped grew the card, slid every card to its right along the row,
// and moved the ✎ and the ⧉ out from under the pointer that was stepping it.
// `scripts/traylayout.mjs` measured it at 6.6px — one character — per step.
//
// Derived rather than counted by hand, and drawn with a drift so the `≈` is in
// it: adding a longer hold to the ring above should widen the chip, not start a
// shift that nobody connects to this line.
export const HOLD_LABEL_CHARS = Math.max(
  ...HOLD_BARS.map(bars => holdLabel({ bars, drift: MAX_DRIFT }).length),
)

export const cycleHold = (hold: Hold): Hold => {
  // `indexOf` answers -1 for a hold not on the ring — a hand-edited file, an
  // older build's list — and -1 + 1 is 0, so an unrecognised hold steps to the
  // head rather than sticking. No branch needed, and none wanted: the obvious
  // `?? HOLD_BARS[0]` guard against an out-of-range index also swallows the
  // *legitimate* null at the end, which quietly deleted "wait for a hand" from
  // the ring. The modulo cannot go out of range, so there is nothing to guard.
  // `findIndex` rather than `indexOf`, which would want a cast: a stored hold is
  // any number, and the ring holds six particular ones.
  const at = HOLD_BARS.findIndex(b => b === hold.bars)
  return { ...hold, bars: HOLD_BARS[(at + 1) % HOLD_BARS.length] }
}

export const cycleArrive = (seconds: MorphSeconds): MorphSeconds => {
  const at = MORPH_SECONDS.indexOf(seconds)
  return MORPH_SECONDS[(at + 1) % MORPH_SECONDS.length]
}

// Unique within this strip, which is all a row id has to be — nothing else keys
// on it, unlike the shelf's ids, which key IndexedDB records. Taken from the
// highest already present rather than from a counter on the strip, so a row
// pasted in from somewhere else cannot collide with one already here.
const nextId = (rows: readonly Row[]): string => {
  const highest = rows.reduce((max, r) => {
    const n = Number(r.id.slice(1))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `r${highest + 1}`
}

// Capture the board. `session` is `writeProfileParams`' output — see `Row`.
//
// `name` is a suggestion from the caller, not something derived here: what a
// board should be called is the app's question (the preset it matches, the
// profile being worked in), and `strip.ts` can see none of that. Blank is the
// ordinary answer and leaves the row reading off its session.
export function addRow(
  strip: Strip,
  session: string,
  opts: { jitter?: MutateAmount; name?: string } = {},
): Strip {
  const row: Row = {
    id: nextId(strip.rows),
    // Deduped against the rows already there, the way a saved look is deduped
    // against the library: two rows called "vhs" in one rundown is exactly the
    // case a name exists to prevent.
    name: uniqueName(strip.rows, cleanProfileName(opts.name ?? '')),
    session,
    fill: rowFill(session, opts.jitter),
    hold: DEFAULT_HOLD,
    arrive: NO_ARRIVE,
  }
  return { ...strip, rows: [...strip.rows, row] }
}

// A name no other row is using, by appending a count — `suggestProfileName`'s
// rule, applied to a rundown instead of a library. Blank stays blank: "unnamed"
// is not a name, and three unnamed rows are not a collision.
function uniqueName(rows: readonly Row[], want: string): string {
  if (want === '') return ''
  const taken = new Set(rows.map(r => r.name))
  if (!taken.has(want)) return want
  for (let n = 2; n < 1000; n++) {
    const candidate = `${want} ${n}`
    if (!taken.has(candidate)) return candidate
  }
  return want
}

// Rename, or clear the name by passing a blank one — which puts the row back on
// its derived label rather than leaving it nameless, so there is no state where
// a card says nothing.
//
// Not deduped, unlike a capture: a hand typing the same name onto two rows has
// said what it meant, and silently appending a "2" to something someone just
// typed is the kind of help that reads as a bug.
export const renameRow = (strip: Strip, index: number, name: string): Strip =>
  patchRow(strip, index, { name: cleanProfileName(name) })

export const removeRow = (strip: Strip, index: number): Strip => ({
  ...strip,
  rows: strip.rows.filter((_, i) => i !== index),
})

// The same row again, next to itself. The cheapest thing an editor gives you —
// a row you have dialled in is worth several with different holds, and building
// the second one by hand means finding that board again.
//
// Inserted after the original rather than appended, because "again" means here:
// a duplicate that landed at the end of a forty-row strip would be a scroll away
// from the thing it was a copy of.
export function duplicateRow(strip: Strip, index: number): Strip {
  const row = strip.rows[index]
  if (row === undefined) return strip
  const copy: Row = {
    ...row,
    id: nextId(strip.rows),
    // Numbered off the original, so a rundown reads "drop, drop 2" rather than
    // two rows claiming the same name. Blank stays blank.
    name: uniqueName(strip.rows, row.name),
  }
  const rows = [...strip.rows]
  rows.splice(index + 1, 0, copy)
  return { ...strip, rows }
}

// Reorder. Out-of-range at either end is a no-op rather than a clamp: a drag
// that ended outside the tray should put the row back, not park it at an end
// the hand never went to.
export function moveRow(strip: Strip, from: number, to: number): Strip {
  const n = strip.rows.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return strip
  const rows = [...strip.rows]
  const [row] = rows.splice(from, 1)
  rows.splice(to, 0, row)
  return { ...strip, rows }
}

// Patch one row in place. Out-of-range is a no-op by construction, which is
// what makes the two chip verbs below safe to call from a card whose index the
// rundown may have shrunk past between the render and the click.
export const patchRow = (
  strip: Strip,
  index: number,
  patch: Partial<Row>,
): Strip => ({
  ...strip,
  rows: strip.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
})

// The two chips, as whole-strip verbs. Guarded here rather than in the hook so
// the bounds check is tested with everything else — a missing row is the
// ordinary case after an edit, not an exceptional one.
export const stepHold = (strip: Strip, index: number): Strip => {
  const row = strip.rows[index]
  return row === undefined
    ? strip
    : patchRow(strip, index, { hold: cycleHold(row.hold) })
}

export const stepArrive = (strip: Strip, index: number): Strip => {
  const row = strip.rows[index]
  return row === undefined
    ? strip
    : patchRow(strip, index, {
        arrive: { ...row.arrive, seconds: cycleArrive(row.arrive.seconds) },
      })
}

// The shelf, plus the plain cut at the head of the ring — which is where it
// belongs rather than at the end: a cut is the ordinary arrival and the one a
// hand steps *back* to when a fault turns out to be too much for the moment.
export const TRANSITION_RING: readonly (TransitionName | null)[] = [
  null,
  ...TRANSITION_NAMES,
]

export const cycleTransition = (
  at: TransitionName | null,
): TransitionName | null => {
  // `indexOf` answers -1 for a name off the ring — a hand-edited file, an older
  // build's shelf — and -1 + 1 is 0, which is the plain cut. Nothing to guard.
  const i = TRANSITION_RING.indexOf(at)
  return TRANSITION_RING[(i + 1) % TRANSITION_RING.length]
}

export const stepTransition = (strip: Strip, index: number): Strip => {
  const row = strip.rows[index]
  return row === undefined
    ? strip
    : patchRow(strip, index, {
        arrive: {
          ...row.arrive,
          transition: cycleTransition(row.arrive.transition),
        },
      })
}

// What the transition chip says: one glyph, whichever way the ring is set.
//
// The plain cut draws as the arrow the chip is about rather than as the word
// "cut", which the arrival chip beside it already uses for a look that does not
// glide — two chips reading "cut" and meaning different things is the one
// confusion this row cannot afford. And an armed one draws as the shelf's
// `glyph` rather than its `label`, for the reason that field exists: the words
// are a deck button's width and the card has 190px holding six controls, so
// "collapse" pushed the ✕ out past `overflow: hidden` and made it unclickable.
//
// One character either way is the other half of it. A chip that changed width
// as it stepped moved the ✎ and the ⧉ under the pointer that was stepping it,
// which is the rule the card's own `.field` states and this broke.
export const transitionLabel = (at: TransitionName | null): string =>
  at === null ? '↷' : (transitionOf(at)?.glyph ?? '↷')

// --- the codec --------------------------------------------------------------

// A strip is JSON beside the shelf rather than a query string. One row is a
// link — that is what `session` above is for — but twenty of them is past what
// an address bar carries, so the rundown is a file and the rows inside it are
// strings.

const KEY = 'ntsc.js.strip'

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function readHold(raw: unknown): Hold {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_HOLD
  const bars = 'bars' in raw ? raw.bars : undefined
  const drift = 'drift' in raw ? raw.drift : undefined
  return {
    // Null and a number are both meaningful, so anything else falls back to the
    // default rather than to null: a corrupt field reading as "waits for a
    // hand" would give a strip that silently stopped at its first bad row.
    bars:
      bars === null
        ? null
        : typeof bars === 'number' && Number.isFinite(bars) && bars > 0
          ? bars
          : DEFAULT_HOLD.bars,
    drift: Math.min(MAX_DRIFT, Math.max(0, num(drift, DEFAULT_HOLD.drift))),
  }
}

function readFill(raw: unknown): RowFill {
  if (typeof raw !== 'object' || raw === null) return { kind: 'clip' }
  const kind = 'kind' in raw ? raw.kind : undefined
  if (kind === 'roll') {
    const origin = 'origin' in raw ? raw.origin : undefined
    return origin === 'commons' || origin === 'archive'
      ? { kind: 'roll', origin }
      : { kind: 'clip' }
  }
  if (kind === 'jitter') {
    const amount = parseMutateAmount('amount' in raw ? raw.amount : undefined)
    return amount === undefined ? { kind: 'clip' } : { kind: 'jitter', amount }
  }
  return { kind: 'clip' }
}

const NO_ARRIVE: Row['arrive'] = { seconds: 1, transition: null }

// A stored arrival. The transition is narrowed through `TRANSITION_NAMES`
// rather than cast, on the rule every other stored name here follows: a rundown
// written by a build with an entry this one does not have should arrive by a
// plain cut rather than hand an unknown name to the shelf. A row from before
// the field existed reads as null, which is exactly what it did.
const readArrive = (raw: unknown): Row['arrive'] => {
  if (typeof raw !== 'object' || raw === null) return NO_ARRIVE
  const seconds = 'seconds' in raw ? raw.seconds : undefined
  const name = 'transition' in raw ? raw.transition : undefined
  return {
    seconds: MORPH_SECONDS.find(s => s === seconds) ?? 1,
    transition: TRANSITION_NAMES.find(t => t === name) ?? null,
  }
}

// One stored row, or undefined when it is not one. Same contract as the shelf's
// reader (`clipLibrary.readLibrary`): stored JSON is a claim rather than a
// fact, and a row that cannot be drawn or fired is dropped rather than kept as
// something the tray would render as a blank card.
//
// `session` is the only field with no fallback. A row whose session is missing
// or empty names nothing to put up, and firing it would be a no-op the user
// would read as a dead row.
function readRow(raw: unknown, index: number): Row | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const session = 'session' in raw ? raw.session : undefined
  if (typeof session !== 'string' || session === '') return undefined
  const id = 'id' in raw ? raw.id : undefined
  const name = 'name' in raw ? raw.name : undefined
  return {
    // Anything that is not a string reads as unnamed, which is a state the card
    // already handles — so a stale-schema row loses its name rather than
    // rendering an object into the tray. Cleaned on the way in as well as on
    // the way out: this is stored JSON, and a hand-edited 400-character name
    // would push every other card off the row.
    name: typeof name === 'string' ? cleanProfileName(name) : '',
    // A row that lost its id gets one from its position. Ids only have to be
    // unique within the strip — nothing else keys on them, unlike the shelf's,
    // which key IndexedDB records — so minting one here is safe in a way it is
    // not there.
    id: typeof id === 'string' && id !== '' ? id : `r${index}`,
    session,
    fill: readFill('fill' in raw ? raw.fill : undefined),
    hold: readHold('hold' in raw ? raw.hold : undefined),
    arrive: readArrive('arrive' in raw ? raw.arrive : undefined),
  }
}

export function readStrip(raw: unknown): Strip {
  const known = typeof raw === 'object' && raw !== null
  const rows = (
    known && 'rows' in raw && Array.isArray(raw.rows) ? raw.rows : []
  ).flatMap((v: unknown, i: number) => {
    const row = readRow(v, i)
    return row === undefined ? [] : [row]
  })
  const seed = known && 'seed' in raw ? raw.seed : undefined
  const loop = known && 'loop' in raw ? raw.loop : undefined
  return {
    rows,
    // A stored strip with no usable seed gets a fresh one rather than a fixed
    // fallback. Every strip in every browser sharing one constant would mean
    // every user's rolls were the same rolls, which is the one way this could
    // come out worse than unseeded.
    seed:
      typeof seed === 'number' && Number.isFinite(seed) ? seed : randomSeed(),
    loop: typeof loop === 'boolean' ? loop : true,
  }
}

export const loadStrip = (): Strip => readStrip(readRecord<object>(KEY, {}))

export const saveStrip = (strip: Strip): void => writeJSON(KEY, strip)
