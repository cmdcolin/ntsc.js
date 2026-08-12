import { useEffect, useRef, useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import {
  gpuAtRisk,
  gpuBuilds,
  gpuReleases,
  outOfGpuBudget,
} from '../gpu/context'
import { debugLog } from '../gpu/env'
import { Engine } from '../gpu/pipeline'
import { MAX_SRC_EDGE } from '../gpu/sources'
import { reportPreviousTrace, trace } from '../gpu/trace'
import { clipUrl, isClipId } from '../sources/clips'
import { smpteBars, sweep } from '../sources/pattern'
import {
  MODE_ORIGIN,
  POOL_MODE_FOR,
  isPoolMode,
  poolCaption,
  releasePick,
  resolvePool,
  rollPool,
} from '../sources/pools'
import { TELETYPE_DEFAULT } from '../sources/teletype'
import { ytId } from '../sources/youtube'
import { backingStoreSize } from './canvasSize'
import { openClipById } from './clipLibrary'
import {
  cueLooping,
  cueRegion,
  dropLoop,
  insideCue,
  wrapCostMs,
  tapCue,
} from './cue'
import { clearStash, readStash, stashClip, stashFile } from './fileStash'
import { formatBytes, reason } from './format'
import { openPullFromUrl } from './framePull'
import { canPickHandle, pickHandle } from './fsAccess'
import { morphTo } from './morph'
import { randomPresetMix, rollControls } from './presets'
import { RebuildPolicy } from './rebuildPolicy'
import { printCard } from './teletypeSlot'
import { faultPlan, transitionOf } from './transitions'
import {
  REVERB_DEFAULT,
  SPEED_DEFAULT,
  VAPORWAVE_SPEED,
  parseSessionParams,
  urlName,
} from './urlParams'
import { isPrompt, useSourcePrompt } from './useSourcePrompt'
import {
  armHead,
  dropHead,
  playStream,
  playUrl,
  prerollUrl,
  promoteHead,
  stopSlot,
  stopTyping,
} from './videoSlot'

import type { FrameStats } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type { FrozenKind } from '../gpu/renderloop'
import type { Rand } from '../rng'
import type { SharedMode, SourceBMode, SourceMode } from '../sources/modes'
import type {
  OnProgress,
  PoolMode,
  PoolOrigin,
  PoolPick,
  PoolRef,
} from '../sources/pools'
import type { TeletypeCard } from '../sources/teletype'
import type { Cue } from './cue'
import type { Fatal } from './FatalScreen'
import type { StashSlot, Stashed } from './fileStash'
import type { PickedFileHandle } from './fsAccess'
import type { SlotView } from './slotView'
import type { RowClip } from './strip'
import type { TransitionName } from './transitions'
import type { SessionParams } from './urlParams'
import type { Preroll, SlotKind, VideoSlot } from './videoSlot'
import type { RefObject } from 'react'

// Capped to the same long edge the engine's texture is, and for the same
// reason — past it the raster cannot show the detail. Doing it here too keeps
// the *decode* cheap, which happens before the engine ever sees the bitmap, so
// a phone photo never lands as a ~200 MB one.
const decodeImage = (src: Blob | File): Promise<ImageBitmap> =>
  createImageBitmap(src).then(bmp => {
    const s = Math.min(1, MAX_SRC_EDGE / Math.max(bmp.width, bmp.height))
    return s === 1
      ? bmp
      : createImageBitmap(bmp, {
          resizeWidth: Math.round(bmp.width * s),
          resizeQuality: 'high',
        }).then(small => {
          bmp.close()
          return small
        })
  })

// The one photograph the app ships with, offered as a source in its own right:
// the patterns show what a mechanism does to a known signal, a real picture
// shows what the look does to a face-sized subject — and it needs no file pick.
const CAT_URL = `${import.meta.env.BASE_URL}sample.jpg`

// Load an image source from a URL, for the ?iurl / ?iurlb query params and the
// bundled cat.
const loadImage = (url: string): Promise<ImageBitmap> =>
  fetch(url)
    .then(r => r.blob())
    .then(decodeImage)

// Fetch a YouTube clip as a blob through the dev yt-dlp bridge
// (vite-plugin-ytdlp). On failure the endpoint returns the yt-dlp error text.
const fetchYouTube = (url: string): Promise<Blob> =>
  fetch(`/yt?url=${encodeURIComponent(url)}`).then(r =>
    r.ok
      ? r.blob()
      : r.text().then(t => Promise.reject(new Error(t || `${r.status}`))),
  )

// Backing out of a browser permission surface — the screen picker's Cancel, a
// dismissed camera prompt. The user made a choice and it was "no", so there is
// nothing to report; a real failure (no such device, blocked by policy) still
// carries a different name and reaches the banner.
const isAbort = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === 'AbortError' || e.name === 'NotAllowedError')

declare global {
  interface Window {
    vf?: Engine
  }
}

// What a slot was last handed, so a rebuilt engine can be given the same picture
// back. Only three things ever reach a slot, and they come back differently
// after a lost device: a live <video> is the browser's rather than the device's
// and kept playing right through the loss, so it needs re-attaching and nothing
// else; a still and a noise field were held in a texture that went away with the
// device, so they have to be re-issued. The still is kept by reference — an
// ImageBitmap or the teletype's own canvas, neither of which the GPU owns.
type SlotSource =
  | { kind: 'none' }
  | { kind: 'video' }
  | { kind: 'still'; source: OffscreenCanvas | ImageBitmap; aspect?: number }
  | { kind: 'noise'; noise: number }

// Where a slot's playhead is, for its seek bar. A zero duration is the "no
// timeline here" reading, and every slot that isn't a loaded clip gives it: an
// empty slot, a still, a noise field, and a live stream — whose element reports
// a duration of Infinity or NaN and cannot be seeked at all. The bar renders on
// a non-zero duration alone, so that one number is the whole gate.
interface Playhead {
  time: number
  duration: number
}
const NO_CLIP: Playhead = { time: 0, duration: 0 }

const readPlayhead = (el: HTMLVideoElement | null): Playhead =>
  el === null || !Number.isFinite(el.duration) || el.duration === 0
    ? NO_CLIP
    : { time: el.currentTime, duration: el.duration }

const samePlayhead = (a: Playhead, b: Playhead): boolean =>
  a.time === b.time && a.duration === b.duration

// Tries per rebuild, and the wait between them. requestAdapter can fail outright
// in the moments after a driver reset — the GPU stack is still coming back — so
// a failed create is worth re-asking before calling the session over.
const CREATE_TRIES = 3
const CREATE_RETRY_MS = 700

// The two ways the GPU half of a session ends, and the reason they are handled
// by one path rather than two.
//
// `lost` is a device that said so — driver reset, sleep/wake, a compositor that
// took it back. `hung` is a device that said nothing and stopped completing
// submitted work, which used to go straight to a fatal screen on the grounds
// that a wedged GPU process outlives the page and a fresh device would land on
// the same one. That is one cause of a hang and, on Linux, not the common one.
// The common one is a discrete card that runtime-suspended underneath a live
// device — a hidden tab submits nothing, the card's autosuspend delay expires
// (5 s on the dev box), and coming back re-initialises a card the device was
// still open on. Nothing is wedged there; the device is simply stale, and a
// replacement works.
//
// The two are indistinguishable at the moment of the fault, so the rebuild
// decides it by trying: a hang gets a fresh device like a loss does, and the
// verdict the old code reached immediately is reached only after `RebuildPolicy`
// has spent its fresh devices on one that never completed any work — which is
// the wedged process, and nothing else. The cost of guessing wrong is now one
// rebuild instead of the session, which is also what makes it safe to probe on
// every lifecycle transition rather than only on the watchdog's beat.
type GpuFault = 'lost' | 'hung'

// Hand a slot's picture to a freshly-built engine. The element check comes first
// and on purpose: a clip, a webcam, a screen share and a YouTube blob all survive
// a lost device untouched — the <video> is the browser's — so the whole recovery
// for them is one setter. Only a still or a noise field has to be re-issued, and
// re-issuing goes back through the slot's own setters, so the record stays true.
const restoreSlot = (slot: VideoSlot, last: SlotSource): void => {
  const el = slot.ref.current
  if (el !== null) slot.attach(el)
  else if (last.kind === 'still') slot.setImage(last.source, last.aspect)
  else if (last.kind === 'noise') slot.setNoise(last.noise)
}

// Print a card on a slot. A patch, not a whole card, because the two ways in
// speak to different halves of it: the dialog sets the text and the crawl
// together, the row under the picker only ever retypes the words.
//
// `live` is an edit to a card already on screen — a keystroke, a painted block.
// It skips the reveal, and it leaves an empty card empty: the fallback to the
// stock words is there so that *arriving* at this source always shows
// something, but applied to an edit it would refill the box the moment someone
// cleared it, and there would be no way to start over.
const printOn = (
  slot: VideoSlot,
  patch: Partial<TeletypeCard>,
  live = false,
) => {
  const card = { ...slot.card(), ...patch }
  slot.setCard(!live && card.text.trim() === '' ? TELETYPE_DEFAULT : card)
  printCard(slot, slot.card(), !live)
}

// The frame rate as useSyncExternalStore's pair, so the readout subscribes to it
// alone. Declared here because this is what builds it; the same shape as
// `ControlStore` and `MorphStore`, and for the same reason — a value that moves
// on its own clock belongs to whichever component draws it, not to the app.
export interface StatsStore {
  subscribe: (fn: () => void) => () => void
  get: () => FrameStats
}

// useSyncExternalStore's pair for the window before an engine exists. The empty
// reading is a module constant because a snapshot getter must return the same
// reference every call — build the object inside the getter and React sees a new
// value on every read and re-renders forever.
const NO_STATS: FrameStats = { fps: 0, lock: 1 }
const subscribeNever = () => () => {}
const getNoStats = (): FrameStats => NO_STATS

// Keep what lets a slot reopen its file after a reload (fileStash.ts). Never a
// banner: the source is loaded and playing either way, and all that is lost is
// getting it back next session.
//
// Out here rather than inside the hook because it closes over nothing — the
// slot it acts on is an argument, which is what `dropFile` beside it cannot say.
const keepFile = (
  key: StashSlot,
  file: File,
  handle: PickedFileHandle | undefined,
) => {
  stashFile(key, file, handle).then(
    kept => {
      if (!kept) debugLog('DEBUG stash skipped, too large', file.name)
    },
    (e: unknown) => debugLog('DEBUG stash failed', reason(e)),
  )
}

// The caption while an archive.org clip is coming down, which is the one wait
// in this app that has no picture behind it — up to twenty seconds of it, and
// it used to read `rolling…` throughout. Written as the slot's name because
// that line is already the only thing on screen about this pick.
//
// The size is in it from the first call, before a byte is asked for: the
// metadata read that chose the rendition knows how big it is, so the wait can
// announce its own length rather than reveal it. `total` is 0 only when
// nothing upstream would say, and then bytes-so-far still beats an ellipsis.
const downloading =
  (slot: VideoSlot, fresh: () => boolean): OnProgress =>
  (loaded, total) => {
    if (!fresh()) return
    // Three readings, because the first call is the announcement and has no
    // progress to report yet: the size alone, then bytes against it, and just
    // bytes where the transfer would not say how many there are in total.
    slot.setName(
      loaded === 0 && total > 0
        ? `fetching… ${formatBytes(total)}`
        : total === 0
          ? `fetching… ${formatBytes(loaded)}`
          : `fetching… ${formatBytes(loaded)} of ${formatBytes(total)}`,
    )
  }

// One deck's half of a paired `{a, b}` state, written without disturbing the
// other's. An updater rather than a value, and that is the whole point of it
// existing: the boot path sets both decks in one synchronous body (`?src=` then
// `?srcb=`), where two direct-object updates would each read the same
// render-time record and the second would silently drop the first — a two-source
// link booting with A's source lost. Nothing catches that; `tsc` least of all.
// So the shape that reads the previous record is the only one on offer here, and
// every paired write in this file goes through it.
//
// Not usable for the source *modes*, which are the one pair whose two halves
// have genuinely different types (only B can be 'none', only A can be 'webcam' —
// see slotView.ts). Those are written out long-hand, in the same functional form.
const onDeck =
  <T>(key: StashSlot, value: T) =>
  (rec: { a: T; b: T }): { a: T; b: T } =>
    key === 'a' ? { ...rec, a: value } : { ...rec, b: value }

// Owns the singleton Engine (a GPUDevice + rAF loop), its lifecycle, and every
// video/image source path (patterns, files, webcam/USB capture, source B).
export function useEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<EngineApi | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoBRef = useRef<HTMLVideoElement | null>(null)
  // The teletype reveal each slot may have in flight, retired by stopSlot.
  const typerARef = useRef<{ stop: () => void } | null>(null)
  const typerBRef = useRef<{ stop: () => void } | null>(null)
  // The next clip each slot has loaded and parked, if a rundown looked ahead —
  // preroll depth 1, one per deck by construction (ui/videoSlot.ts).
  const nextARef = useRef<Preroll | null>(null)
  const nextBRef = useRef<Preroll | null>(null)
  // The second read head each slot may have on the clip it is playing, parked at
  // a running loop's in-point. A separate field from the preroll above and not a
  // second use of it — ui/videoSlot.ts argues why, and the short version is that
  // the two bound different things.
  const headARef = useRef<HTMLVideoElement | null>(null)
  const headBRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputBRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<Fatal | null>(null)
  // The browser stopped painting the tab. Not fatal — it clears itself the
  // moment rAF is delivered again — so it rides over the stage as a banner.
  const [frozen, setFrozen] = useState<FrozenKind | null>(null)
  // A device is being replaced, and why. Also a banner rather than a screen: the
  // whole point of the rebuild is that the session survives it, and the picture
  // is back within a second — but the gap has to say what it is, or it reads as
  // exactly the freeze this all exists to avoid. The cause rides along because
  // the two look identical from the stage and want different words: one device
  // announced that it was going away, the other just stopped answering.
  const [rebuilding, setRebuilding] = useState<GpuFault | null>(null)
  // How many WebGPU devices this *page* has created, how many this *tab* has
  // destroyed, and whether either makes the session worth warning about — mirrored
  // into React for one reason: the console warning that used to be the only word on
  // it arrives in the one place nobody is looking, and by the time the picture
  // stops the DOM is not being painted either. Said on the stage while the stage
  // still works, the tab is one click from a fresh one.
  //
  // `builds` and not the tab's creation total, which is what this used to carry.
  // The tab total counts reloads, a reload leaves its device behind with its
  // document, and the banner consequently opened on anyone who refreshed three
  // times to tell them their working tab kept rebuilding its engine.
  const [budget, setBudget] = useState(() => ({
    builds: gpuBuilds(),
    releases: gpuReleases(),
    atRisk: gpuAtRisk(),
  }))

  // The stage banner rides on the canvas, so it is invisible in the worst
  // version of this — a document the browser has stopped painting entirely,
  // where nothing the DOM says reaches the screen. The tab title is browser
  // chrome, drawn by the parent process, so it still gets through.
  // And it is the only surface that can carry the *verdict*, which is why the
  // two kinds get different words rather than one pause glyph. A stall clears
  // itself; a cold tab never will, and the action it needs — a new tab — is the
  // opposite of the reload anyone reaches for first. Kept short because a tab
  // title is truncated to a few characters wide.
  useEffect(() => {
    const original = document.title
    if (frozen === 'cold') {
      document.title = `⛔ new tab needed — ${original}`
    } else if (frozen === 'stalled') {
      document.title = `⏸ frozen — ${original}`
    }
    return () => {
      document.title = original
    }
  }, [frozen])
  const [engine, setEngine] = useState<EngineApi | null>(null)
  // The frame rate, as the engine's own store rather than state here. It used to
  // be `useState` fed from `onStats`, which meant the whole panel reconciled four
  // times a second — so it was wired only while the readout was open, and the
  // readout then perturbed the frame rate it was there to report. A store costs
  // nothing while nothing is subscribed, so there is no longer anything to gate
  // and no `wantStats` to pass in.
  const statsStore: StatsStore = {
    subscribe: engine === null ? subscribeNever : engine.subscribeStats,
    get: engine === null ? getNoStats : engine.getStats,
  }
  // Which picker entry each deck is on. One record rather than a state each, for
  // the reason `speed`, `transport` and `cue` below already are: a flat
  // `…A`/`…B` pair is two chances to write the wrong letter at every site that
  // touches it, and the mistake typechecks and draws a plausible panel
  // (slotView.ts). Written through the functional form only — see `onDeck`.
  //
  // Typed as one record with two *different* modes rather than
  // `Record<StashSlot, …>`: only B can be 'none' and only A can be 'webcam', and
  // a shared union would let each deck be given the other's mode — which is
  // precisely the mistake the pairing exists to stop the compiler from allowing.
  const [sourceMode, setSourceMode] = useState<{
    a: SourceMode
    b: SourceBMode
  }>({ a: 'bars', b: 'bars' })
  // Picked/loaded filename, shown while the source is 'file'; '' otherwise.
  const [sourceName, setSourceName] = useState({ a: '', b: '' })
  // Which shelf clip each deck is on, or null for a source the shelf does not
  // know about — a generated mode, a one-off pick, a url, a webcam.
  //
  // Its own state rather than something read back off the stash, because the
  // two answer different questions. The stash is what this deck comes back on
  // *next load*; this is what is on it *now*, which is what `+ row` has to
  // record, and the two differ for the whole of an async reopen. It is also the
  // one thing a row needs that `sourceName` cannot supply: two clips on the
  // shelf may share a filename, and an id never collides.
  const [deckClip, setDeckClip] = useState<{
    a: RowClip | null
    b: RowClip | null
  }>({ a: null, b: null })
  // Last session's file, remembered as a disk handle whose read permission the
  // reload dropped: it cannot be reopened without a gesture, so the slot holds
  // it here and the panel offers the click (see fileStash.ts).
  const [pending, setPending] = useState<{
    a: Stashed | null
    b: Stashed | null
  }>({ a: null, b: null })
  // The five picker entries that ask a question before they change anything —
  // the shelf, the browser, the YouTube box, the teletype card and the webcam
  // permission — as one state (useSourcePrompt.ts). Backing out of any of them
  // leaves the deck as it was; answering one closes it, from `beginLoad` below,
  // so no source path has to remember to.
  //
  // The teletype card each slot last showed is separate state further down: the
  // dialog reopens on what is on screen, the caption says what the card reads,
  // and the card survives a shared link.
  const prompt = useSourcePrompt()
  // What each slot has off one of the pools — Commons or archive.org. State
  // because the ★ and the credit link under the picker render from it; mirrored
  // into a ref below because every path that writes it is an async reply, where
  // closed-over state is a snapshot.
  //
  // One pair rather than the two pairs this was. The Commons and archive.org
  // halves were separate types (slotView.ts says why they no longer are), and
  // the cost showed up here as six state slots, two setters and two clears for
  // one fact about a deck.
  const [pick, setPickState] = useState<{
    a: PoolPick | null
    b: PoolPick | null
  }>({ a: null, b: null })
  const pickRef = useRef<{ a: PoolPick | null; b: PoolPick | null }>({
    a: null,
    b: null,
  })
  const [card, setCardState] = useState({
    a: TELETYPE_DEFAULT,
    b: TELETYPE_DEFAULT,
  })
  const cardRef = useRef({ a: TELETYPE_DEFAULT, b: TELETYPE_DEFAULT })
  // Vaporwave playback: per-slot rate (pitch drops with it) and the reverb wet
  // mix on the tail the clips are heard through. `live` tracks what kind of
  // <video> each slot currently holds — only a clip has a rate to change
  // (see SlotKind).
  // One record rather than a useState each, so the rate can be changed by key.
  const [speed, setSpeed] = useState({ a: SPEED_DEFAULT, b: SPEED_DEFAULT })
  // Whether the clips are routed is not state here: the audio picker holds that
  // answer now, and nothing this hook renders asks. The mirror below is what the
  // re-routing on a source change reads, and it is a ref for the same reason the
  // rest of the vapor config is.
  const [reverb, setReverb] = useState(REVERB_DEFAULT)
  const [live, setLiveState] = useState<{ a: SlotKind; b: SlotKind }>({
    a: 'none',
    b: 'none',
  })
  // The loaded YouTube URL per slot, kept so the source round-trips through the
  // query string (a refresh or shared link restores the clip).
  const [ytUrl, setYtUrlState] = useState({ a: '', b: '' })
  // Where each slot's playhead is, for the seek bars. Polled rather than driven
  // off `timeupdate` for the same reason the audio file's is: the readout ticks
  // in tenths, and a slot slowed to 0.25× fires timeupdate on its own schedule
  // while a paused one fires nothing at all. duration stays 0 until metadata
  // lands and for anything without a finite timeline, which is what keeps the
  // bar off a webcam or a screen share.
  const [transport, setTransport] = useState({ a: NO_CLIP, b: NO_CLIP })
  // Each slot's cue point, and the loop hanging off it if there is one. Both a
  // ref and state, for the reason vaporRef below is: the rebuild-after-loss path
  // reads from a mount-time closure where state is the first render's snapshot,
  // and the tap handler needs the current value to decide which of the three
  // presses this is. The ref is the authority; the state exists to render from.
  //
  // Deliberately not controls. A cue is two timestamps into one particular clip,
  // so a preset that recalled them would be pointing at nothing, and mutate would
  // cheerfully scramble them mid-take (see ui/cue.ts).
  // What each slot's loop is spending on the jump back, in ms, or null before
  // there is a reading. Read off the pump in the playhead tick below rather than
  // pushed, because a wrap is not a React event and there can be several a second.
  const [stall, setStall] = useState<{
    a: number | null
    b: number | null
  }>({ a: null, b: null })
  const cueRef = useRef<{ a: Cue | null; b: Cue | null }>({ a: null, b: null })
  const [cue, setCueState] = useState<{ a: Cue | null; b: Cue | null }>({
    a: null,
    b: null,
  })
  // Each new element is stamped with the current playback config, but that
  // happens inside async fetch callbacks and the mount-time restore, where the
  // state it would close over is stale; this mirror always holds the latest.
  const vaporRef = useRef({
    speed: { a: SPEED_DEFAULT, b: SPEED_DEFAULT },
    playAudio: false,
    reverb: REVERB_DEFAULT,
  })
  // What each slot is showing, for the rebuild after a lost device. A ref rather
  // than state because nothing renders it and the rebuild path reads it from a
  // mount-time closure, where state is a snapshot of the first render.
  const lastSrc = useRef<{ a: SlotSource; b: SlotSource }>({
    a: { kind: 'none' },
    b: { kind: 'none' },
  })
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [webcamDeviceId, setWebcamDeviceId] = useState('')
  const [renderScale, setRenderScale] = useState(1)
  const renderScaleRef = useRef(1)
  const [res, setRes] = useState('')
  // Which decode-stage tap is on the glass. The engine owns the value (it reads
  // `?dbg=` at construction), but two surfaces switch it and one draws a badge
  // for it, so React keeps a mirror the same way it does for the render scale.
  const [tap, setTap] = useState(0)

  // The arithmetic lives in canvasSize.ts, where it is testable; what is left
  // here is reading the element and writing back to it.
  const applyCanvasSize = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const [bufW, bufH] = backingStoreSize(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio,
        renderScaleRef.current,
      )
      // Only on a real change: assigning canvas.width/height reallocates the
      // drawing buffer and reconfigures the WebGPU swapchain even when the value
      // written is the one already there. This runs from a ResizeObserver, so
      // unguarded it threw away a live swapchain on every panel toggle and
      // window drag — and churning one under the compositor is the likeliest way
      // to lose the surface for good.
      if (canvas.width !== bufW || canvas.height !== bufH) {
        canvas.width = bufW
        canvas.height = bufH
        trace.add('resize', `${bufW}x${bufH}`)
        setRes(`${bufW}×${bufH}`)
      }
    }
  }

  const setScale = (v: number) => {
    renderScaleRef.current = v
    setRenderScale(v)
    applyCanvasSize()
  }

  const changeTap = (v: number) => {
    engineRef.current?.setDbgView(v)
    setTap(v)
  }

  // Adopt the live video slots into the audio graph (or none, muting them all,
  // when off) at the given reverb mix. Explicit args, so callers that also flip
  // a setting pass the new value rather than reading stale state.
  const routeAudio = (on: boolean, mix: number) => {
    const els: HTMLVideoElement[] = []
    for (const v of [videoRef.current, videoBRef.current]) {
      if (v !== null) {
        v.muted = !on
        if (on) els.push(v)
      }
    }
    engineRef.current?.audioState.routeMedia(els, mix)
  }

  // `defaultPlaybackRate` as well as `playbackRate`, or loading the next src
  // resets the rate to 1 — which is the half of this that was easiest to lose
  // when it was written out twice.
  // The loop's second read head takes the rate too, and it has to: it was
  // configured at the rate that was set when the loop was marked, so a slider
  // moved during a loop would otherwise be undone by the next wrap — the picture
  // and its pitch snapping back for one lap, then again on the lap after.
  const changeSpeed = (key: StashSlot, rate: number) => {
    vaporRef.current.speed[key] = rate
    setSpeed(prev => ({ ...prev, [key]: rate }))
    const onAir = (key === 'a' ? videoRef : videoBRef).current
    const head = (key === 'a' ? headARef : headBRef).current
    for (const v of [onAir, head]) {
      if (v !== null) {
        v.defaultPlaybackRate = rate
        v.playbackRate = rate
      }
    }
  }
  // Whether the clips' own sound tracks are the audio input: heard out loud and
  // analysed, both out of routeAudio above. Driven by the audio picker at the
  // head of the map's Sound branch, which is the one place that decides where
  // sound comes from. It used to be a
  // button of its own inside Vaporwave — two switches onto one wire, which the
  // panel could not then answer "is sound driving this" from, because either one
  // could be the reason and neither knew about the other.
  // Through the mirror rather than the `reverb` state, because the preset dials
  // in a mix and then asks the picker to switch this on within the same click:
  // the state read here would still be the pre-preset value, and routeMedia
  // writes the wet gain, so it would undo the mix changeReverb just set.
  const setVideoAudio = (on: boolean) => {
    vaporRef.current.playAudio = on
    routeAudio(on, vaporRef.current.reverb)
  }
  const changeReverb = (mix: number) => {
    vaporRef.current.reverb = mix
    setReverb(mix)
    engineRef.current?.audioState.setReverbMix(mix)
  }
  // The vaporwave preset: slow both slots and dial in reverb. Switching the
  // clip's audio on is the caller's job — that is the audio picker's state now,
  // and this hook has no way to move it.
  const applyVaporwave = () => {
    changeSpeed('a', VAPORWAVE_SPEED)
    changeSpeed('b', VAPORWAVE_SPEED)
    changeReverb(REVERB_DEFAULT)
  }

  // Follow both playheads while either slot holds a clip. 10 Hz, like the audio
  // file's transport and for the same reason: a clock reading in tenths does
  // not need a re-render per frame. The tick writes state only when a number
  // actually moved, so a slot paused on the deck costs nothing.
  const clipA = live.a === 'clip'
  const clipB = live.b === 'clip'
  useEffect(() => {
    // A fresh gate is a fresh source: clear the old reading rather than let the
    // previous clip's bar sit there for the first tenth of a second.
    setTransport({ a: NO_CLIP, b: NO_CLIP })
    let id = 0
    if (clipA || clipB) {
      id = window.setInterval(() => {
        const a = readPlayhead(clipA ? videoRef.current : null)
        const b = readPlayhead(clipB ? videoBRef.current : null)
        setTransport(prev =>
          samePlayhead(prev.a, a) && samePlayhead(prev.b, b) ? prev : { a, b },
        )
        const h = engineRef.current?.loopHealth()
        const next = {
          a: h === undefined ? null : wrapCostMs(h.a),
          b: h === undefined ? null : wrapCostMs(h.b),
        }
        setStall(prev => (prev.a === next.a && prev.b === next.b ? prev : next))
      }, 100)
    }
    return () => clearInterval(id)
  }, [clipA, clipB])

  // Move a playhead, and move its readout with it so the thumb doesn't snap back
  // and wait out the poll interval. Held on the deck (`aPause`/`bPause`) the
  // picture won't follow until the deck rolls again — the pump is frozen — which
  // is what holding a deck means.
  const jump = (key: StashSlot, time: number) => {
    const v = (key === 'a' ? videoRef : videoBRef).current
    if (v === null) return
    v.currentTime = time
    setTransport(p => ({ ...p, [key]: { ...p[key], time } }))
  }

  // Write a cue through to both the render loop and the panel. One place, because
  // a cue that reached the ref but not the engine is a loop the buttons claim is
  // running and the picture ignores.
  const writeCue = (key: StashSlot, next: Cue | null) => {
    cueRef.current[key] = next
    setCueState(p => ({ ...p, [key]: next }))
    const region = cueRegion(next)
    if (key === 'a') engineRef.current?.setVideoRegion(region)
    else engineRef.current?.setVideoRegionB(region)
    // The loop's second read head, armed here because this is the one place a
    // loop starts or stops existing. Fired and not awaited: it is a load, the
    // first lap wraps by seeking whether or not it has landed, and the only
    // thing waiting for it would achieve is to make marking a loop feel slow.
    const slot = slotOf(key)
    if (region === null) dropHead(slot)
    else void armHead(slot, region.start)
  }

  // Dragging the seek bar out of a running loop lets go of the loop but keeps the
  // cue. The alternative is a bar that hauls you back inside the region on every
  // drag, which is a transport you cannot use — and the in-point is still where
  // you want to come back to, so throwing that away as well would be worse.
  const seekOut = (key: StashSlot, time: number) => {
    jump(key, time)
    const cur = cueRef.current[key]
    if (cueLooping(cur) && !insideCue(cur, time)) writeCue(key, dropLoop(cur))
  }

  // One press of a slot's cue button. The playhead comes from the element rather
  // than from the polled readout: the poll is a tenth of a second stale, and this
  // gesture is being beaten in time to something.
  const tapCueOn = (key: StashSlot) => {
    const v = (key === 'a' ? videoRef : videoBRef).current
    if (v === null || !Number.isFinite(v.duration)) return
    writeCue(key, tapCue(cueRef.current[key], v.currentTime, v.duration))
  }

  // Jump back to the cue and keep playing — the whole gesture on its own, with no
  // loop involved. Stabbed in time it is the stutter a DJ gets off a cue button;
  // it is also what makes an in-point worth marking before you know where the
  // out-point goes.
  //
  // Not through `seekA`, deliberately: that one reads a landing outside the region
  // as leaving the loop, and the cue is the one position that must never be taken
  // to mean that. A retrigger with no cue marked is a no-op rather than a jump to
  // zero, which would be a button that rewound the clip for no stated reason.
  const retriggerOn = (key: StashSlot) => {
    const cur = cueRef.current[key]
    if (cur !== null) jump(key, cur.in)
  }

  const clearCueOn = (key: StashSlot) => writeCue(key, null)

  // A cue a link asked for, waiting for the clip it belongs to.
  //
  // It cannot simply be written at load time. Every path that puts a source on a
  // slot opens with stopSlot, which clears the cue on purpose — a cue is two
  // positions in one particular clip and must not outlive it — and most of those
  // paths are async (a fetched shelf clip, a YouTube resolve, last session's
  // stashed file). A cue set before them would be wiped by the very load it was
  // meant for. So it waits here and is claimed by `attach`, which is the one
  // funnel every video source ends up going through, and which runs after
  // stopSlot has had its say.
  const pendingCue = useRef<{ a: Cue | null; b: Cue | null }>({
    a: null,
    b: null,
  })
  // Claimed once, so that the *next* source change does not resurrect a cue the
  // link asked for two clips ago. Only a real element claims it: stopSlot's own
  // `attach(null)` is the clearing half and must not consume anything.
  const takePendingCue = (key: StashSlot) => {
    const want = pendingCue.current[key]
    if (want === null) return
    pendingCue.current[key] = null
    writeCue(key, want)
  }

  // The two slots, as data. Everything below that touches a <video> goes
  // through one of these, so the A and B paths are the same code reading a
  // different letter rather than two near-copies drifting apart.
  const adopt = () =>
    routeAudio(vaporRef.current.playAudio, vaporRef.current.reverb)
  // Every source that reaches a slot passes through the three setters below, so
  // that is where the "what is on this slot" record is kept — one write per
  // source change, and no path can set a source without leaving one behind.
  //
  // That record is also why the two slots are built from one factory rather than
  // written out twice. The pattern in each setter is the same two steps in the
  // same order — remember what this slot now holds, then tell the engine — and
  // the failure mode of a second copy is not a crash but a slot that plays the
  // right picture and restores the wrong one after a device rebuild, because a
  // new source kind got added to A's `attach` and not to B's. Written once, the
  // two cannot drift.
  //
  // The factory takes the deck's letter and nothing else, and that is load-
  // bearing rather than tidy. It used to take a `wiring` descriptor holding the
  // slot's two refs and three closures over `engineRef`, and **passing that
  // object cost `useEngine` its memoization entirely**:
  //
  //     React Compiler could not optimize 2:
  //       src/ui/useEngine.ts  Cannot access refs during render   (x2)
  //         at makeSlot('a', …) — "Passing a ref to a function may read its
  //         value during render"
  //
  // Bisected with `pnpm compiler`: the parent of the commit that introduced the
  // factory optimizes, the factory commit does not, and both errors point at the
  // two call sites rather than at anything inside. A ref reaching a call during
  // render is enough — including one only *captured* by a closure in the object
  // passed, which is what `el => engineRef.current?.setVideoSource(el)` is. It is
  // the same fault slotView.ts records for `makeSlotView`, and the same cost:
  // `App` builds ~200 control rows off this hook, so an unmemoized `useEngine` is
  // all of them reconciling on writes that touched none of them.
  //
  // Taking the letter alone is what fixes it — nothing ref-ish crosses the call —
  // and it happens to be the better factoring anyway: there is no descriptor left
  // to pair with the wrong deck. Re-check with `pnpm compiler` if this grows a
  // parameter.
  const makeSlot = (id: StashSlot): VideoSlot => ({
    id,
    ref: id === 'a' ? videoRef : videoBRef,
    next: id === 'a' ? nextARef : nextBRef,
    head: id === 'a' ? headARef : headBRef,
    typer: id === 'a' ? typerARef : typerBRef,
    rate: () => vaporRef.current.speed[id],
    // The three engine entry points below are separate methods per slot on
    // EngineApi (`setVideoSource` / `setVideoSourceB`), so which one to call is
    // the one thing about a deck that cannot be reached by indexing with `id`.
    // Everything else here — the refs, the four React mirrors, the cue, the
    // card — is now keyed, so this branch is the whole of the difference.
    attach: el => {
      lastSrc.current[id] = el === null ? { kind: 'none' } : { kind: 'video' }
      const eng = engineRef.current
      if (id === 'a') eng?.setVideoSource(el)
      else eng?.setVideoSourceB(el)
      // `null` is a retire rather than an arrival, and the difference matters
      // to the barrier below: every load path opens by stopping the slot, so a
      // retire that counted as arriving would settle the wait it just started.
      if (el !== null) {
        takePendingCue(id)
        arrived(id)
      }
    },
    setImage: (source, aspect) => {
      // Only A keeps its own aspect — B is staged to the raster with a 4:3 crop,
      // so its shader needs no aspect at all (see gpu/sources.ts). Passing it
      // for B would not be harmless: it would be recorded in `lastSrc` and
      // handed back on the next restore, describing a staging that never
      // happened.
      const kept = id === 'a' ? aspect : undefined
      lastSrc.current[id] = { kind: 'still', source, aspect: kept }
      const eng = engineRef.current
      if (id === 'a') eng?.setImageSource(source, kept)
      else eng?.setImageSourceB(source)
      arrived(id)
    },
    setNoise: kind => {
      lastSrc.current[id] = { kind: 'noise', noise: kind }
      const eng = engineRef.current
      if (id === 'a') eng?.setNoiseSource(kind)
      else eng?.setNoiseSourceB(kind)
      arrived(id)
    },
    setLive: kind => setLiveState(onDeck(id, kind)),
    setYtUrl: url => setYtUrlState(onDeck(id, url)),
    setName: name => setSourceName(onDeck(id, name)),
    clearCue: () => clearCueOn(id),
    card: () => cardRef.current[id],
    setCard: next => {
      cardRef.current[id] = next
      setCardState(onDeck(id, next))
    },
    onError: setError,
    release: el => engineRef.current?.audioState.releaseMedia(el),
    adopt,
  })
  const slotA = makeSlot('a')
  const slotB = makeSlot('b')
  const stopVideo = () => stopSlot(slotA)
  const stopVideoB = () => stopSlot(slotB)

  const slotOf = (key: StashSlot): VideoSlot => (key === 'a' ? slotA : slotB)

  // What a slot has off a pool. Deliberately not a release: the url this clears
  // is still on the element that is still playing, and stopSlot revokes whatever
  // `blob:` it retires. The only pick that has to be handed back by hand is one
  // that never reached a slot — see `rollFrom`.
  const setPick = (key: StashSlot, on: PoolPick | null) => {
    pickRef.current[key] = on
    setPickState(onDeck(key, on))
  }

  // Which load of a slot is the current one. Bumped by every path that gives a
  // slot a new source, and the answer it hands back is the test for "is this
  // reply still wanted".
  const loadSeq = useRef({ a: 0, b: 0 })

  // A slot is being given a new source, so anything still in flight for it is
  // stale. This is not hypothetical tidiness: a Commons roll spends up to two
  // requests and the cat photo is a fetch, so a slot can have a second or two of
  // network out while the user — who has been given no reason to wait — picks
  // something else. Without the token the late reply lands on top of whatever
  // they went to, and the caption then names a picture that is not on screen.
  //
  // Clearing the pool pick here rather than in each caller is the same
  // argument: every way out of a pool source passes through one of these, and a
  // ★ still offering to keep the roll after the slot moved to bars would keep
  // something nobody can see.
  // Dismissing the open dialog here is the other half of the same idea, and the
  // reason `useSourcePrompt` is one state rather than five: this runs on every
  // path that gives a slot a source, so the question that was being asked about
  // that slot goes away when it is answered — whoever answered it. Left to the
  // callers it was forgotten exactly once, by a kept roll played off the shelf,
  // which then went on playing behind the shelf.
  const beginLoad = (key: StashSlot): (() => boolean) => {
    const seq = (loadSeq.current[key] += 1)
    setPick(key, null)
    prompt.dismiss()
    waiting.current[key] = seq
    return () => loadSeq.current[key] === seq
  }

  // --- waiting for a source to land --------------------------------------
  //
  // **Only an offline render waits, and it is the half of the awaiting sink
  // that frame-exact pull made worth building** (docs/EDITOR.md ›
  // _Frame-exact video pull_). Live, a row that names a clip puts it up when
  // the network answers and nobody could want otherwise — the alternative is a
  // set that stalls. Offline there is no such thing as late: the render's clock
  // is its own, so waiting costs wall time and costs the file nothing, and the
  // row lands on the frame the rundown said rather than on whichever frame the
  // fetch happened to finish by.
  //
  // The pair is `beginLoad` above and the three arrival verbs on the slot —
  // which is the same funnel in and the same funnel out, so nothing new has to
  // be remembered at a call site. What is stored is the *sequence number* that
  // began the wait rather than a flag, so a second load starting while the
  // first is outstanding replaces it rather than double-counting, and a reply
  // that lands for a load the deck has moved on from settles nothing.
  const waiting = useRef<{ a: number | null; b: number | null }>({
    a: null,
    b: null,
  })
  const arrived = (key: StashSlot) => {
    if (waiting.current[key] === loadSeq.current[key])
      waiting.current[key] = null
  }

  // How long a render will wait for one. Generous, because a pool pick is a
  // whole file off archive.org and a bundled clip is a network away; bounded,
  // because **a render that hangs is worse than a row that is late**. Past it
  // the take carries on with whatever is on the deck, which is exactly what
  // every take did before this existed.
  const SETTLE_MS = 15_000

  // Resolves once neither deck has a load outstanding, or the deadline passes.
  // Polled rather than pushed: a load lands on one of three verbs across nine
  // paths, and a promise per path is nine chances to leak one — where a poll
  // cannot be forgotten and cannot be left dangling. Cheap, too, because
  // nothing calls this except a render between two frames.
  const settleSources = (): Promise<void> =>
    new Promise(resolve => {
      const idle = () =>
        waiting.current.a === null && waiting.current.b === null
      if (idle()) {
        resolve()
        return
      }
      const until = Date.now() + SETTLE_MS
      const tick = () => {
        if (idle() || Date.now() > until) {
          resolve()
          return
        }
        setTimeout(tick, 8)
      }
      setTimeout(tick, 8)
    })

  // Everything that is true of *every* source change on a deck, said once: the
  // load is opened, whatever the slot held is retired, the picker lands on the
  // entry that names what is arriving, its caption is set, and what the deck
  // would reopen next session is let go of. B adds the one thing that is
  // genuinely its own — whether it is summing into the composite at all.
  //
  // These five steps were written out at nine call sites, in four different
  // orders, and the token was the part that went missing: `beginLoad`'s answer
  // is the only defence against a slow reply landing on a deck the user has
  // moved on from, and every path had to remember to keep it by hand. One of
  // them did not (the yt-dlp fetch, which is the longest wait of the lot). Now
  // committing a source *is* how you get the token, so there is nothing left to
  // forget.
  //
  // Two functions rather than one taking a key, because the mode unions are the
  // one place A and B genuinely differ — only B can be 'none', only A can be
  // 'webcam' — and a shared signature could only take them by widening to a
  // union neither setter accepts. The shared half is three lines and is not
  // worth a cast to reach.
  // What is on a deck now, for `+ row` to record. One writer, so the clearing
  // in `commitDeck` and the four settings after it cannot spell it differently.
  const markClip = (key: StashSlot, clip: RowClip | null) => {
    setDeckClip(onDeck<RowClip | null>(key, clip))
  }

  const commitDeck = (key: StashSlot, stash: 'drop' | 'keep') => {
    const fresh = beginLoad(key)
    // Whatever shelf clip the deck was on, it is not on it any more. Cleared
    // here rather than by each caller because this is the one place every
    // source change passes through, and the failure of the other arrangement is
    // silent: one path that forgot would let `+ row` record a clip the picture
    // has not been on for ten minutes. The two paths that *are* on a shelf clip
    // set it back straight after, the way `stashClip` already does.
    markClip(key, null)
    if (key === 'a') stopVideo()
    else stopVideoB()
    // `keep` is `adoptInto`'s alone, and it is not a nicety: a file *is* the
    // thing the stash remembers, and that path writes one straight afterwards —
    // including on the reopen, where dropping it here would erase the very entry
    // the reopen came from. Answering the parked "↺ reopen last session's file"
    // offer still happens either way, since a deck that has been given a source
    // must not go on offering to replace it.
    if (stash === 'drop') dropFile(key)
    else setPending(onDeck<Stashed | null>(key, null))
    return fresh
  }

  const commitA = (
    mode: SourceMode,
    name = '',
    stash: 'drop' | 'keep' = 'drop',
  ): (() => boolean) => {
    const fresh = commitDeck('a', stash)
    setSourceMode(m => ({ ...m, a: mode }))
    setSourceName(onDeck('a', name))
    return fresh
  }

  const commitB = (
    mode: SourceBMode,
    name = '',
    stash: 'drop' | 'keep' = 'drop',
  ): (() => boolean) => {
    const fresh = commitDeck('b', stash)
    setSourceMode(m => ({ ...m, b: mode }))
    setSourceName(onDeck('b', name))
    // Off is a mode like any other here, so the enable follows the mode rather
    // than being a flag each caller sets: every source but 'none' means B is
    // summing, and 'none' is the one that means it is not.
    engineRef.current?.setSourceBEnabled(mode !== 'none')
    return fresh
  }

  // A commit on whichever deck, for a mode both decks offer — which is every
  // mode but A's `webcam` and B's `none`, and `SharedMode` is exactly that
  // intersection. The two above stay separate because the mode is the one pair
  // whose halves are genuinely different types (see the note on `onDeck`), so
  // the branch cannot be lifted into a keyed setter; what it *can* be is written
  // once here rather than at each of the six call sites that had it inline.
  const commitOn = (
    key: StashSlot,
    mode: SharedMode,
    name = '',
    stash: 'drop' | 'keep' = 'drop',
  ): (() => boolean) =>
    key === 'a' ? commitA(mode, name, stash) : commitB(mode, name, stash)

  // The built-in sources either slot can show, picked by mode name alone since
  // both slots offer the same set. Four are synthesised on the spot; cat and
  // the bundled clips are files under public/, so cat lands a fetch later —
  // the slot keeps showing whatever it had until then, exactly like the
  // ?iurl path — and a clip plays the same way a picked file does. Teletype
  // reads the slot's own text, since the mode name alone doesn't carry it.
  //
  // `fresh` is handed in rather than opened here, because the two callers that
  // are source *changes* have already opened one through `commit`, and a second
  // token would silence the first. The pool branch is the exception and says so:
  // `rollFrom` opens its own, since a roll can also be re-fired on a deck that
  // is already on that channel.
  const showGenerated = (
    slot: VideoSlot,
    mode: SourceMode | SourceBMode,
    fresh: () => boolean,
  ) => {
    if (mode === 'bars') slot.setImage(smpteBars())
    else if (mode === 'sweep') slot.setImage(sweep())
    else if (mode === 'tv static') slot.setNoise(1)
    else if (mode === 'vhs static') slot.setNoise(2)
    else if (mode === 'synth') slot.setNoise(3)
    else if (mode === 'teletype') printCard(slot, slot.card())
    else if (mode === 'cat')
      loadImage(CAT_URL).then(
        bmp => {
          if (fresh()) slot.setImage(bmp, bmp.width / bmp.height)
        },
        (e: unknown) => {
          if (fresh()) setError(`image: ${reason(e)}`)
        },
      )
    else if (isClipId(mode)) playUrl(slot, clipUrl(mode))
    else if (isPoolMode(mode)) rollFrom(slot, mode)
  }

  // A pool pick onto a slot: the caption, the subject of the ★, and then the
  // picture. A still and a clip diverge only in the last of those — one decodes,
  // the other plays through the same <video> path a bundled clip uses. A Commons
  // transcode is CORS-clean off upload.wikimedia.org and an archive.org clip is a
  // same-origin `blob:`, and videoSlot.ts sets crossOrigin either way, so nothing
  // taints the texture upload.
  const showPick = (
    slot: VideoSlot,
    picked: PoolPick,
    fresh: () => boolean,
  ) => {
    // Whatever the slot was holding is retired here rather than when the request
    // went out — that is what keeps the old picture up while the roll is in
    // flight. It matters for the re-roll: the picker path stops the slot on its
    // way through, but the palette's row calls `rollFrom` directly, and a
    // time-lapse clip replaced without this would leave the previous element
    // playing, adopted by the audio graph and attached to nothing.
    stopSlot(slot)
    slot.setName(poolCaption(picked))
    setPick(slot.id, picked)
    if (picked.kind === 'video') playUrl(slot, picked.url)
    else
      loadImage(picked.url).then(
        bmp => {
          if (fresh()) slot.setImage(bmp, bmp.width / bmp.height)
        },
        (e: unknown) => {
          if (fresh()) {
            slot.setName('')
            setPick(slot.id, null)
            setError(`${picked.origin}: ${reason(e)}`)
          }
        },
      )
  }

  // A pick that lost its slot while it was in flight. Every reply from a pool
  // goes through here rather than being merely ignored: an archive.org roll has
  // already spent its download and is holding a blob url with the whole clip
  // behind it, and dropping the reference leaks that until the tab goes.
  const landPick = (
    slot: VideoSlot,
    picked: PoolPick,
    fresh: () => boolean,
  ) => {
    if (fresh()) showPick(slot, picked, fresh)
    else releasePick(picked)
  }

  // Roll a file out of a channel and show it, whichever pool the channel belongs
  // to. None of the latency blocks: like the cat photo and the ?iurl path, the
  // slot keeps showing whatever it had until the roll lands, so switching to a
  // channel never flashes a dead slot. On archive.org that wait is seconds rather
  // than milliseconds — the whole file is downloaded before anything can play
  // (sources/archive.ts has the measurement) — which is what the picker's band
  // heading warns about and why the old picture is left up.
  //
  // The caption is written twice on purpose. The first write is the only thing
  // on screen that says a request is out, and without it a pick reads as having
  // done nothing.
  // `rand` is how a strip row rolls reproducibly: unseeded for every hand-driven
  // roll (the picker, the palette, a MIDI pad), and the take's own generator
  // when a row fires. See rng.ts — and note what a seed does not buy, since the
  // candidate list is upstream's choice either way.
  const rollFrom = (slot: VideoSlot, mode: PoolMode, rand?: Rand) => {
    const origin = MODE_ORIGIN[mode]
    // Read before `beginLoad` clears it: what is on the slot right now is what a
    // re-roll of the *same* source should try not to hand back. A roll on the
    // other source has nothing to avoid — the picture that is going away came
    // from somewhere else entirely.
    const showing = pickRef.current[slot.id]
    const avoid = showing?.origin === origin ? showing.title : ''
    const fresh = beginLoad(slot.id)
    slot.setName('rolling…')
    rollPool(origin, avoid, downloading(slot, fresh), rand).then(
      picked => landPick(slot, picked, fresh),
      (e: unknown) => {
        if (fresh()) {
          slot.setName('')
          setError(`${origin}: ${reason(e)}`)
        }
      },
    )
  }

  // Another file out of whichever deck is on a channel, for hands that are not on
  // the sidebar — the command palette's row, and the keyboard through it. A wins
  // when both are rolling, since A is the picture; a set with a channel on B
  // alone still gets the command.
  const rollAgain = (rand?: Rand) => {
    if (isPoolMode(sourceMode.a)) rollFrom(slotA, sourceMode.a, rand)
    else if (isPoolMode(sourceMode.b)) rollFrom(slotB, sourceMode.b, rand)
  }

  // A strip row's roll, which differs from `rollAgain` in naming the pool rather
  // than reading it off whichever deck happens to be on one: the row said
  // `?src=wiki-random`, and by the time this runs `showSession` has put deck A
  // there, but saying it outright is what keeps the row's meaning independent of
  // what the decks were doing a moment ago.
  const rollOn = (origin: PoolOrigin, rand: Rand) => {
    const mode = POOL_MODE_FOR[origin]
    setSourceMode(m => ({ ...m, a: mode }))
    rollFrom(slotA, mode, rand)
  }

  // A strip row's lookahead: load what the next row will want onto deck A's
  // second element, parked at its in-point (ui/videoSlot.ts).
  //
  // Deck A alone, because that is where a rundown puts its rows — B is the mix
  // source and a take will want it, which is the same reason preroll lives in a
  // slot rather than on B.
  //
  // Nothing awaits it and nothing reports it. A preroll is an optimisation on a
  // cut that already works: if it lands, the cut is a swap; if it does not, the
  // cut loads exactly as it did before this existed. Failing loudly would be
  // reporting a fault the user has no way to act on and would not have been
  // told about a version ago.
  const prerollOn = (url: string, start: number) => {
    void prerollUrl(slotA, url, start)
  }

  // A strip row's clip, onto deck A — the far end of `strip.RowClip`, and what
  // makes a rundown of different clips possible at all.
  //
  // Deck A alone, for the reason `prerollOn` above gives: a rundown puts its
  // rows on A and B is the mix source a take will want.
  //
  // Three ways a shelf entry becomes a picture, and this routes between them
  // rather than knowing any of them — `openClipById` owns that, and it is the
  // same call `reopenStashed` makes for the deck the page came back on:
  //
  //   - a kept roll answers with a `PoolRef`, which `showRef` asks the archive
  //     for again;
  //   - a copied file opens with no prompt and lands through `loadClip`, which
  //     is the same funnel the shelf's own click uses — so a row and a click put
  //     the deck in exactly the same state, stash line included;
  //   - a disk handle whose grant died with the last page load needs a *user
  //     gesture*, and a walk is a timer with none to spend. That row parks in
  //     `pending` and the caption offers the click, which is what the reopen
  //     path already does at boot. It is the one case a rundown cannot resolve
  //     on its own, and it is honest about it rather than silently leaving the
  //     last row's picture up.
  const clipOn = (id: string, name: string) => {
    openClipById(id).then(
      open => {
        if (open === null) {
          setError(`${name === '' ? id : name}: no longer on the shelf`)
          return
        }
        if (open.at === 'pool') {
          showRef('a', open.ref, 'library')
          markClip('a', { id, name: open.name, seconds: 0 })
        } else if (open.needsGesture) {
          setPending(
            onDeck<Stashed | null>('a', {
              ...open,
              at: 'file',
              mode: 'library',
              clip: id,
            }),
          )
        } else {
          open.open().then(
            file => loadClip('a', file, { id, name: open.name }),
            (e: unknown) => setError(`${open.name}: ${reason(e)}`),
          )
        }
      },
      (e: unknown) => setError(`${name === '' ? id : name}: ${reason(e)}`),
    )
  }

  // One named file onto a slot, off the shelf or out of the browser. Resolved
  // rather than replayed from a stored url (sources/pool.ts says why), so this is
  // a request like a roll and not an assignment — hence the caption saying so
  // while it is out.
  //
  // The mode lands on whichever surface the click came from rather than on the
  // channel the file was originally rolled out of, even where that is known: the
  // caption reopens whatever the mode names, and on a channel that caption
  // *rolls*, which would throw away the very picture the user just chose.
  const showRef = (
    key: StashSlot,
    ref: PoolRef,
    mode: 'library' | 'browse',
  ) => {
    setError('')
    const slot = slotOf(key)
    const fresh = commitOn(key, mode)
    slot.setName('opening…')
    resolvePool(ref, downloading(slot, fresh)).then(
      picked => landPick(slot, picked, fresh),
      (e: unknown) => {
        if (fresh()) {
          slot.setName('')
          setError(`${ref.origin}: ${reason(e)}`)
        }
      },
    )
  }

  // Decode a still into a slot. A passes the source's own aspect so compose
  // letterboxes it; B ignores the argument.
  const showImage = (slot: VideoSlot, src: Blob | File) => {
    decodeImage(src).then(
      bmp => slot.setImage(bmp, bmp.width / bmp.height),
      (e: unknown) => setError(`image: ${reason(e)}`),
    )
  }

  // A picked (or reopened) file into a slot: stills decode, everything else
  // plays from a blob url.
  const showFile = (slot: VideoSlot, file: File) => {
    if (file.type.startsWith('image/')) showImage(slot, file)
    else playUrl(slot, URL.createObjectURL(file))
  }

  // A file becomes the slot's source: the same steps whether it was just
  // picked, reopened from last session, taken off the shelf, or re-granted by a
  // click. `mode` is which picker entry the slot lands on, and a clip off the
  // library has to land on the library — the caption under the picker reopens
  // whatever the mode names, and a shelf clip that read as `file` would offer
  // the OS dialog where the shelf belongs.
  const adoptInto = (key: StashSlot, file: File, mode: 'file' | 'library') => {
    // 'keep', because this is the one path whose caller writes the stash itself
    // — and the one that reopens *from* it, where dropping it would erase what
    // the reopen came from. See commitDeck.
    commitOn(key, mode, file.name, 'keep')
    showFile(slotOf(key), file)
  }

  // A clip off the shelf, into whichever deck the dialog was opened for. The
  // stash line is the only thing kept beyond the session — the library already
  // owns the handle and the grant, so remembering the *entry* is what lets the
  // slot come back on this clip without a second copy of it anywhere.
  const loadClip = (
    key: StashSlot,
    file: File,
    clip: { id: string; name: string },
  ) => {
    setError('')
    adoptInto(key, file, 'library')
    // After `adoptInto`, which goes through `commitDeck` and clears this — the
    // same order `stashClip` below is in, and for the same reason.
    markClip(key, { id: clip.id, name: clip.name, seconds: 0 })
    stashClip(key, clip).catch((e: unknown) =>
      debugLog('DEBUG stash failed', reason(e)),
    )
  }

  const dropFile = (key: StashSlot) => {
    setPending(onDeck<Stashed | null>(key, null))
    clearStash(key).catch((e: unknown) =>
      debugLog('DEBUG unstash failed', reason(e)),
    )
  }

  // What the slot held last session, put back. A kept roll off the shelf is a
  // request and comes straight back; a copied stash opens straight away too; a
  // disk handle whose read permission died with the page needs a click, so it is
  // parked in `pending` for the caption to offer instead. The parking used to be
  // a setter handed in by the caller, because there was one per deck; with
  // `pending` keyed there is nothing left for a caller to choose, and `key` was
  // already being passed.
  const reopenStashed = (key: StashSlot) => {
    readStash(key).then(
      stashed => {
        if (stashed === null) return
        if (stashed.at === 'pool') {
          showRef(key, stashed.ref, 'library')
          // After `showRef`, whose own commit clears it. A kept roll restored
          // at load is as much a shelf clip as one clicked, and a row captured
          // over it has to say so — this is the half that made `+ row` record a
          // clip on a fresh visit and quietly not after a reload.
          markClip(key, { id: stashed.clip, name: stashed.name, seconds: 0 })
        } else if (stashed.needsGesture)
          setPending(onDeck<Stashed | null>(key, stashed))
        else
          stashed.open().then(
            file => {
              adoptInto(key, file, stashed.mode)
              if (stashed.clip !== '')
                markClip(key, {
                  id: stashed.clip,
                  name: stashed.name,
                  seconds: 0,
                })
            },
            (e: unknown) => {
              debugLog('DEBUG stash reopen failed', reason(e))
              dropFile(key)
            },
          )
      },
      (e: unknown) => debugLog('DEBUG stash read failed', reason(e)),
    )
  }

  // The click the parked handle was waiting for. requestPermission runs on the
  // gesture's transient activation, which is why `open` is called with nothing
  // awaited in front of it. Only a disk stash is ever parked — a kept roll needs
  // no gesture and has already been put back above.
  const reopenPending = (key: StashSlot) => {
    const stashed = pending[key]
    if (stashed !== null && stashed.at === 'file')
      stashed.open().then(
        // `adoptInto` is what clears the park, since every way out of it ends
        // there — the grant landing, or another source arriving first.
        file => {
          adoptInto(key, file, stashed.mode)
          if (stashed.clip !== '')
            markClip(key, { id: stashed.clip, name: stashed.name, seconds: 0 })
        },
        (e: unknown) => setError(`reopen ${stashed.name}: ${reason(e)}`),
      )
  }

  // Picking a file. Chromium's picker hands back a handle worth remembering, so
  // prefer it; without one the hidden <input> is the only way in. Either way a
  // cancelled dialog leaves the current source untouched.
  const pickFile = (
    key: StashSlot,
    input: RefObject<HTMLInputElement | null>,
    onFile: (file: File) => void,
  ) => {
    if (canPickHandle())
      pickHandle().then(
        picked => {
          if (picked !== null) {
            onFile(picked.file)
            keepFile(key, picked.file, picked.handle)
          }
        },
        (e: unknown) => setError(`open: ${reason(e)}`),
      )
    else input.current?.click()
  }

  // Download a clip and hand it to the slot. What differs between A and B —
  // the mode enum, B's enable flag — stays with the callers below.
  //
  // The caption goes through `slot.setName` rather than a setter passed in: the
  // slot handed over already carries its own, and reaching through it for the
  // sibling (`slot.setYtUrl`) on the very next line is what this always did.
  //
  // `fresh` is the deck's load token, and this is the path that needs it most:
  // yt-dlp fetches the whole clip through the dev bridge, which is the longest
  // wait in the app by some way, and it is the one anybody is most likely to
  // give up on. Without the check the download lands whenever it lands — a new
  // element attached to the engine over whatever the user went to instead, under
  // a picker still naming that other source, and a failure clearing *its*
  // caption and raising a banner about a deck that moved on minutes ago.
  const downloadYouTube = (
    slot: VideoSlot,
    url: string,
    fresh: () => boolean,
    onFail: () => void,
  ) => {
    slot.setYtUrl(url)
    slot.setName(`youtube: ${ytId(url)} — downloading…`)
    fetchYouTube(url).then(
      blob => {
        // Nothing is allocated for a stale reply: the object url is made here
        // rather than before the check precisely so a dropped download is
        // dropped whole, and the blob goes with the reference.
        if (!fresh()) return
        playUrl(slot, URL.createObjectURL(blob))
        slot.setName(`youtube: ${ytId(url)}`)
      },
      (e: unknown) => {
        if (!fresh()) return
        setError(`youtube: ${reason(e)}`)
        slot.setName('')
        onFail()
      },
    )
  }

  // The teletype dialog's commit: put the deck on teletype and print the card.
  // Unlike `retypeOn` below this is a source change, so it goes through
  // `commitOn` and retires whatever the deck was holding.
  const loadTeletypeOn = (key: StashSlot, patch: Partial<TeletypeCard>) => {
    if (engineRef.current) {
      setError('')
      commitOn(key, 'teletype')
      printOn(slotOf(key), patch)
    }
  }

  // Editing a card that is already up. Safe to call on every keystroke and
  // every painted block: it redraws the card and touches nothing else — no
  // source switch, no file dropped, no reveal replayed.
  //
  // It deliberately does nothing when the slot is on something else. The dialog
  // can be opened over a webcam or a clip, and those are only given up once
  // something is actually sent — typing a letter into a box should not pull the
  // camera out from under the picture.
  const retypeOn = (key: StashSlot, patch: Partial<TeletypeCard>) => {
    const mode = sourceMode[key]
    if (engineRef.current && mode === 'teletype')
      printOn(slotOf(key), patch, true)
  }

  // Picking a source, on either deck. One ladder rather than two, because the
  // question each rung asks is not per-deck: does this mode put a picture up
  // now, or ask something first? Written out twice, the two had to be kept in
  // step by hand and nothing caught a rung added to one and not the other —
  // which is a mode that silently does nothing on B.
  //
  // What genuinely differs is which modes each deck offers, and the unions
  // already say it: `webcam` is A's alone and `none` is B's alone, so the two
  // rungs that name them cannot fire on the wrong deck even though the key does
  // not narrow.
  const selectOn = (key: StashSlot, mode: SourceMode | SourceBMode) => {
    if (engineRef.current) {
      // Every source change starts here (file picks too — the file dialog is
      // only opened from this handler), so clear any stale failure banner once.
      setError('')
      if (mode === 'file') {
        // For file, wait until a file is actually picked before touching state:
        // cancelling the OS dialog then leaves the current source untouched.
        pickFile(key, key === 'a' ? fileInputRef : fileInputBRef, file =>
          adoptInto(key, file, 'file'),
        )
      } else if (isPrompt(mode)) {
        // The same deferral for all five: the shelf is a list until one of its
        // rows is clicked, the box is empty until a URL is typed, the card is
        // whatever the dialog comes back with, and the camera is not asked for
        // (nor its permission spent) until Continue. Backing out of any of them
        // leaves the deck — and its source — exactly as it was.
        prompt.ask(mode, key)
      } else if (mode === 'screen') {
        // No dialog of our own: the browser's picker *is* the confirmation, and
        // this handler still holds the click's transient activation, which
        // getDisplayMedia requires.
        startScreen(key)
      } else if (mode === 'none') {
        // B going off, and only B: 'none' is not in A's union, so this is
        // unreachable for A. Nothing to show, so it commits and stops.
        commitB(mode)
      } else {
        showGenerated(slotOf(key), mode, commitOn(key, mode))
      }
    }
  }

  // Share a window, a tab or a whole display into a slot. Unlike the webcam
  // path this asks *before* giving up the current source: the picker is a
  // second surface the user can back out of, and a cancel there should leave
  // the picture exactly as it was rather than on a dead slot.
  //
  // A window is not a signal source in the NTSC sense, so nothing about the
  // stream is special downstream — it lands on the same <video> a picked file
  // does, and the whole chain damages it identically. Picking *this* window is
  // worth knowing about: the tab re-shooting its own output is a real optical
  // feedback loop, drawn by the compositor instead of by fbMix.
  const startScreen = (key: StashSlot) => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      stream => {
        setError('')
        // What the picker was pointed at, for the caption. Firefox names the
        // window in the track label; where that is blank the surface kind is
        // still worth saying, since "monitor" and "window" behave differently
        // once you go looking for the app's own output in the share.
        const track = stream.getVideoTracks()[0]
        const name =
          track === undefined || track.label === ''
            ? (track?.getSettings().displaySurface ?? 'screen')
            : track.label
        commitOn(key, 'screen', name)
        // A share the user ended from the browser's own bar leaves the slot
        // holding a frozen last frame, so each deck says "the feed went" the way
        // it can. A gets snow, which is what a set with nothing on its input
        // shows and the clearest thing this app has to say. B is optional by
        // nature, so B goes off instead: summing static into the composite would
        // be a bigger change to the look than letting go of a share asks for.
        playStream(slotOf(key), stream, () =>
          key === 'a' ? selectOn('a', 'tv static') : selectOn('b', 'none'),
        )
      },
      (e: unknown) => {
        // Cancelling the picker rejects too, and that is not a failure worth a
        // banner — the source the user backed away from is still on screen.
        if (!isAbort(e)) setError(`screen: ${reason(e)}`)
      },
    )
  }

  // Actually opens the device once the user confirms; deviceId '' takes the
  // OS default, otherwise pins the chosen capture device (e.g. an RCA grabber).
  // No resolution constraint — composite dongles deliver 720x480, so we take
  // whatever the device negotiates rather than forcing 1280x720.
  //
  // The deck is given up only once a device has actually been handed over —
  // the same rule startScreen follows, arrived at from the other direction.
  //
  // It used to stop the slot before asking, and what that cost is worth writing
  // down, because it was invisible rather than obviously broken: measured with
  // getUserMedia forced to reject, deck A on a playing clip came back with the
  // *identical* frame signature and the picker still reading `clip-popeye`. Not
  // a black slot — `stopSlot` retires the element and the GPU keeps the last
  // texture it was given — so a refused camera silently turned a playing clip
  // into a still of itself, under a picker that went on naming the clip. The
  // only thing that said otherwise was the banner.
  //
  // The banner stays, which is where this parts company with startScreen. There
  // the browser's picker *is* the confirmation, so cancelling it is a choice
  // made on the only surface in play; here the app's own dialog asked first,
  // and the permission prompt is a second gate the user may never connect to
  // the click — a site already blocked rejects with no prompt at all, and
  // silence would read as the Continue button doing nothing.
  const startWebcam = (deviceId: string) => {
    const current = engineRef.current
    if (current) {
      const video = deviceId === '' ? true : { deviceId: { exact: deviceId } }
      navigator.mediaDevices.getUserMedia({ video }).then(
        stream => {
          commitA('webcam')
          playStream(slotA, stream)
          // Capture cards weave interlaced fields, so combing shows on motion;
          // bob-deinterlace on by default for this source (toggle in Signal A).
          current.setControl('deint', 1)
          const active = stream.getVideoTracks()[0]?.getSettings().deviceId
          setWebcamDeviceId(active ?? '')
          // Labels populate only after this grant, so enumerate now.
          navigator.mediaDevices
            .enumerateDevices()
            .then(devices =>
              setVideoDevices(devices.filter(d => d.kind === 'videoinput')),
            )
            .catch(() => {})
        },
        (e: unknown) => setError(`capture: ${reason(e)}`),
      )
    }
  }

  // The hidden <input> path, so a browser without the handle picker still loads
  // files — its pick carries no handle, so the stash falls back to a copy.
  const takeFileOn = (key: StashSlot, file: File | undefined) => {
    if (file && engineRef.current) {
      adoptInto(key, file, 'file')
      keepFile(key, file, undefined)
    }
  }

  const reopenFileA = () => reopenPending('a')
  const reopenFileB = () => reopenPending('b')

  // Both slots feed the clip through the same blob-backed <video> path as a
  // picked file. What differs is where a failed download leaves the deck: A
  // stays on whatever it had, since it is still patched to something, while B
  // goes off — an optional input that could not fetch its clip has nothing to
  // sum, and leaving it enabled would mix a dead slot into the composite.
  const loadYouTubeOn = (key: StashSlot, url: string) => {
    const current = engineRef.current
    const trimmed = url.trim()
    if (current && trimmed !== '') {
      setError('')
      const fresh = commitOn(key, 'youtube')
      downloadYouTube(slotOf(key), trimmed, fresh, () => {
        if (key === 'b') {
          setSourceMode(m => ({ ...m, b: 'none' }))
          current.setSourceBEnabled(false)
        }
      })
    }
  }

  // Put a parsed link on an engine. The parsing itself is pure and tested
  // (urlParams.ts); what is left here is only the applying, in the one order
  // that matters: the vaporwave settings land before any clip loads, since a
  // new element reads its playback rate off vaporRef at creation.
  //
  // Two callers, and the difference between them is `boot`. A link arriving at
  // page load is one; a **strip row firing** is the other, and it is why this is
  // a function of an engine rather than boot code inline — a row is a query
  // string (docs/EDITOR.md › _A row is a thing that already exists_), so "fire
  // row 3" and "open this link" have to mean the same thing or the strip is a
  // second, worse implementation of the share contract.
  //
  // What only boot does is bracketed below: the `?surprise` roll (which a row
  // never carries — `writeProfileParams` deletes the param) and the stash dance,
  // which decides what to do about *last session's* file and is meaningless
  // mid-set. A row that names no source leaves the deck alone rather than
  // reopening something from yesterday.
  //
  // `arrive` is the other difference: a link lands on its look, a row can morph
  // to it over the seconds its arrival names.
  // `EngineApi` rather than `Engine`: boot hands over the concrete engine it
  // just built, a row fires against whatever `engineRef` is holding — which is
  // the interface, and which after a device-loss rebuild is a different object
  // than the one boot saw. Nothing in here reaches past the interface.
  const applySession = (
    eng: EngineApi,
    params: SessionParams,
    opts: { boot: boolean; arrive: number } = { boot: true, arrive: 0 },
  ) => {
    // `?surprise` arrives on a rolled look rather than the landing one. The
    // link's own controls go on top, so `?surprise&set=noiseIre:9` is a roll
    // with that one knob pinned. Source B is not up yet at this point, so the
    // roll stays out of the A/B group either way.
    //
    // The view controls come back out of the roll, the same rule `useMix.
    // surprise` follows and for the same reason: a preset may be a *view*
    // preset — 'nose against the glass' winds the magnifier to 5 — so a roll
    // that drew one opened the app on a wall of phosphor grain rather than on a
    // picture. Clicking that chip yourself is a deliberate move and stays
    // untouched; landing on it because a link said `?surprise` reads as the app
    // having failed to load. Measured when 'across the room' was still in the
    // list (it wound the other way, to 0.42): two of six boot rolls came up as
    // a stamp-sized set in a dark room.
    //
    // The button path pinned these to wherever the magnifier already was and
    // this one pinned nothing, which is one verb with two rules. Here there is
    // no "already" to keep — nobody has framed anything on a fresh boot — so
    // stock is what it pins to. `?surprise&set=crtZoom:0.42` still works: the
    // link's own controls land after this and outrank it.
    if (opts.boot && params.surprise) {
      eng.applyControls(rollControls(randomPresetMix(false), DEFAULT_CONTROLS))
    }
    // A cut, or a walk to the look over the row's arrival. `startGlide` takes
    // its origin from the engine's live controls, so a row arriving over a
    // morph that lands on top of another sets off from where the picture
    // actually is rather than snapping back — the same property that makes
    // holding the surprise button wander through look space (useMix).
    //
    // A patch rather than a whole board is why this is not `morphTo` directly:
    // `params.controls` is `Partial<Controls>`, and a glide needs a
    // destination. Layering it over what is live is what a link means too —
    // `applyControls` is a patch — so the two agree about what a session says.
    if (opts.arrive > 0) {
      eng.startGlide(
        morphTo({ ...eng.getControls(), ...params.controls }, opts.arrive),
      )
    } else {
      eng.applyControls(params.controls)
    }
    // Armed before any source is touched, and claimed by whichever load the link
    // goes on to start (see takePendingCue). A link that names no clip leaves
    // these sitting unclaimed, which is correct: there is nothing to cue.
    pendingCue.current = { a: params.cueA, b: params.cueB }
    // Before either source is shown: the teletype card is typed out of the
    // slot's own text, so the link's text has to be on the slot by then.
    if (params.card !== null) slotA.setCard(params.card)
    if (params.cardb !== null) slotB.setCard(params.cardb)
    // Both decks are set here, in one synchronous body, which is the one place
    // in this file where the paired records could be got wrong in a way nothing
    // would report: `setSourceMode({ ...sourceMode, a: … })` twice reads the same
    // render-time record both times and the second write drops the first, so
    // `?src=…&srcb=…` would boot with A's source lost. The functional form below
    // is what makes the two writes independent, and it is not optional here.
    const src = params.src
    if (src === 'webcam') {
      selectOn('a', 'webcam')
    } else if (src !== null) {
      // `beginLoad` rather than the `commit` pair the picker uses: what the link
      // says about the stash is decided below, once every param has been read
      // (`linkNamesA`), and committing here would answer that question early —
      // for `?src=` alone, and before `?vurl=` had been looked at.
      showGenerated(slotA, src, beginLoad('a'))
      setSourceMode(m => ({ ...m, a: src }))
    }
    const srcb = params.srcb
    if (srcb !== null) {
      eng.setSourceBEnabled(srcb !== 'none')
      showGenerated(slotB, srcb, beginLoad('b'))
      setSourceMode(m => ({ ...m, b: srcb }))
    }
    const imageError = (e: unknown) => setError(`image: ${reason(e)}`)
    // `beginLoad` in each of the three below is what makes "the link named an
    // address as well as a mode, so the address wins" true rather than a race:
    // ?src= has already been applied above, and where that mode was a Commons
    // channel its roll is still out. Without the token the roll would land on
    // top of the still the link actually named.
    if (params.iurl !== null) {
      const url = params.iurl
      const fresh = beginLoad('a')
      loadImage(url).then(bmp => {
        if (!fresh()) return
        // A link naming both ?src=teletype and a still means the still: stop
        // the reveal or it goes on typing over the picture that just landed.
        stopTyping(slotA)
        slotA.setImage(bmp, bmp.width / bmp.height)
        setSourceMode(m => ({ ...m, a: 'file' }))
        setSourceName(onDeck('a', urlName(url)))
      }, imageError)
    }
    if (params.iurlb !== null) {
      const url = params.iurlb
      const fresh = beginLoad('b')
      loadImage(url).then(bmp => {
        if (!fresh()) return
        stopTyping(slotB)
        slotB.setImage(bmp)
        eng.setSourceBEnabled(true)
        setSourceMode(m => ({ ...m, b: 'file' }))
        setSourceName(onDeck('b', urlName(url)))
      }, imageError)
    }
    if (params.vurl !== null) {
      beginLoad('a')
      stopTyping(slotA)
      playUrl(slotA, params.vurl)
      setSourceMode(m => ({ ...m, a: 'file' }))
      setSourceName(onDeck('a', urlName(params.vurl)))
    }
    // Audio is left off however the link arrived: browsers block unmuted
    // autoplay without a gesture, so a restored clip must load muted and the
    // user re-enables sound with one click on the panel toggle.
    const restored = {
      a: params.vapor.speedA,
      b: params.vapor.speedB,
    }
    vaporRef.current = {
      speed: restored,
      reverb: params.vapor.reverb,
      playAudio: false,
    }
    setSpeed(restored)
    setReverb(params.vapor.reverb)
    if (params.yt !== null) loadYouTubeOn('a', params.yt)
    if (params.ytb !== null) loadYouTubeOn('b', params.ytb)
    // Boot only, and the reason `opts` exists at all. What follows is a question
    // about *last session's* file — reopen it, or let the link's own source
    // replace it — and mid-set there is no such question: a row that names no
    // source means "leave the deck where it is", and reopening yesterday's clip
    // under a running strip would be the strip losing its place.
    if (!opts.boot) return
    // Whatever the link did not speak for, the slot's own last pick fills —
    // reopened from the stashed copy, after the vaporwave settings above, since
    // a new element reads its playback rate at creation. A link that *does* name
    // the slot wins and the stash goes with it: leaving it would resurrect a
    // file the user has moved on from on the next bare load.
    const linkNamesA =
      params.src !== null ||
      params.iurl !== null ||
      params.vurl !== null ||
      params.yt !== null
    const linkNamesB =
      params.srcb !== null || params.iurlb !== null || params.ytb !== null
    if (linkNamesA) dropFile('a')
    else reopenStashed('a')
    if (linkNamesB) dropFile('b')
    else reopenStashed('b')
    debugLog('DEBUG engine ready')
  }

  // A strip row landing on the live engine: the same apply a link gets, minus
  // the two things that only make sense at page load. Handed out on the engine's
  // surface so `useStrip`'s sink is three calls and no knowledge of how a source
  // gets onto a slot.
  const showSession = (params: SessionParams, arrive: number) => {
    const eng = engineRef.current
    if (eng !== null) applySession(eng, params, { boot: false, arrive })
  }

  // A named fault off the shelf (ui/transitions.ts), with the caller's work
  // landing inside it: the picture breaks, `onCut` runs on the frame the engine
  // says it is least legible, and the fault heals onto whatever that put up.
  //
  // **The cut is the engine's callback and not a timer here**, which is the
  // whole reason `startFault` takes an `onCut`: it has to land on one
  // particular frame and nothing in React runs that often. This adds nothing to
  // `faultPlan` but the lookup — a row's transition and the deck's shelf button
  // run the same fault and differ only in what their cut does.
  //
  // **What the strip hands over is its whole step**, not a session: the roll,
  // the shake and the next row's preroll ride the cut with it, because a
  // transition row has to do at the cut exactly what a plain row does when it
  // fires (ui/strip.ts, `Effect`). That is also what keeps the swap a swap —
  // the row before parked the clip, and nothing retires it in between.
  const faultTo = (name: TransitionName, onCut: () => void) => {
    const t = transitionOf(name)
    const eng = engineRef.current
    // An unknown name is a rundown from a build with a shelf entry this one
    // does not have; no engine is a tab that has not been given one. Either way
    // the step still lands — it simply lands plainly, which is what it would
    // have done before the shelf existed.
    if (t === undefined || eng === null) onCut()
    else eng.startFault(faultPlan(t, onCut))
  }

  // The device this tab cannot afford, declined out loud instead of spent.
  //
  // A tab that has destroyed a presenting device stops being given animation
  // frames, and a reload lands in the same hole (docs/adr/0004). So the app stops
  // one short and says so on a screen that can still be read, offering the one
  // action that works: this URL in a new tab, which carries the whole look because
  // the address bar is kept current (useUrlState).
  //
  // The override is not a formality. The ceiling is a measurement from one
  // browser on one OS, and on a browser without the bug a refusal to rebuild
  // would be the app breaking itself over someone else's fault — so the spend
  // stays available, it just stops being automatic.
  const declineDevice = (body: string, spend: () => void) => {
    trace.add(
      'gpuBudget',
      `declined at ${gpuBuilds()} in this page, ${gpuReleases()} destroyed`,
    )
    trace.flush(true)
    console.error(
      `Declining to create WebGPU device ${gpuBuilds() + 1} in this page: this tab has destroyed ${gpuReleases()} device${gpuReleases() === 1 ? '' : 's'} that had been presenting, and a tab that has done that stops being given animation frames — a reload does not clear it. Open this URL in a new tab (?gpubudget=ignore disables this gate).`,
    )
    setFatal({
      title: 'This tab cannot safely open another GPU device',
      body,
      kind: 'budget',
      onOverride: () => {
        trace.add('gpuBudget', 'overridden')
        setFatal(null)
        spend()
      },
    })
  }

  // An effect's cleanup return is conditional by nature (React's own documented pattern).
  // oxlint-disable-next-line typescript/consistent-return
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      // Whatever the last session managed to write before it wedged.
      reportPreviousTrace()
      applyCanvasSize()
      // Keep the drawing buffer matched to the element as the panel hides or
      // the window enters fullscreen, so the picture never stretches.
      const ro = new ResizeObserver(applyCanvasSize)
      ro.observe(canvas)
      // Stop the loop on the way out of the document, and — this part is the
      // correction — *do not destroy the device*. `destroy()` without `keepDevice`
      // now means "let go of it", not "hand it back to the driver" (releaseGpu in
      // gpu/context.ts).
      //
      // This handler used to call `device.destroy()` here on the reasoning that a
      // reload abandons the device and carries a wedged GPU into the next page, so
      // releasing it first would start the reload clean. Measured, that is
      // backwards and it was the bug: the same page reloaded four times in one tab
      // survives every load when the device is merely abandoned, and dies from load
      // 2 onward — permanently, exactly the reported freeze — when a `pagehide`
      // handler destroys it. Destroying a device that has been presenting is what
      // ends a tab's rendering step.
      //
      // The teardown is still worth doing for everything that is not the device:
      // the loop stops, the audio graph closes, the mic light goes out.
      //
      // `disposed` is latched here too: pagehide can land while Engine.create is
      // still in flight, when there is no engine to tear down yet but a device has
      // already been handed out. The create callback below then lets go of it
      // rather than leaving it to the page teardown.
      let disposed = false
      const onPageHide = () => {
        disposed = true
        engineRef.current?.destroy()
      }
      window.addEventListener('pagehide', onPageHide)

      // Whether to keep replacing a device that keeps going away (rebuildPolicy),
      // whether a replacement is in flight, and the retry timer one may be
      // waiting on. Locals rather than state: the guard has to be true the
      // instant it is set, and nothing renders any of them.
      // Two counts, not one, because the two faults escalate on different
      // evidence and must not spend each other's budget: a run of losses should
      // not be forgiven by a hang that proved a device had worked, and a run of
      // hangs should not inherit a count left by losses.
      const losses = new RebuildPolicy()
      const hangs = new RebuildPolicy()
      let busy = false
      let retryId = 0

      // Everything a new engine needs before it is allowed to be the live one:
      // the callbacks that report its health, and the refs the rest of the hook
      // writes through. Shared by the boot path and the rebuild, so a replacement
      // engine is watched exactly as closely as the first one.
      const wire = (created: Engine) => {
        engineRef.current = created
        setEngine(created)
        window.vf = created
        // Read after the engine exists, so it counts the device this one is on —
        // and it does not always go up, because an engine replaced for a reason
        // that was not the device's fault inherits the one it had.
        setBudget({
          builds: gpuBuilds(),
          releases: gpuReleases(),
          atRisk: gpuAtRisk(),
        })
        created.onGpuError = m => {
          trace.add('gpuError', m.slice(0, 120))
          trace.flush(true)
          setError(`gpu: ${m}`)
        }
        // Bound to the engine that lost its device, not to whatever is live when
        // the promise settles: `lost` can resolve late, and a stale one must not
        // be able to tear down the successor that replaced it.
        created.onDeviceLost = m => rebuild(created, 'lost', m)
        // Not a lost device — it never reported anything, it just stopped
        // completing submitted work — but answered the same way, and see
        // GpuFault for why that is the right guess to make first.
        created.onHang = () =>
          rebuild(created, 'hung', 'submitted work stopped completing')
        created.onFrozen = f => setFrozen(f)
        // Where each slot's second read head is offered from. Set here rather
        // than beside the region, so a rebuilt engine gets one too: the elements
        // played straight through the device loss — they are the browser's, not
        // the GPU's — so a loop that was running keeps its head along with its
        // region two dozen lines below.
        created.setVideoRelay((start, end) => promoteHead(slotA, start, end))
        created.setVideoRelayB((start, end) => promoteHead(slotB, start, end))
        // Where a take's frames come from. One opener for both decks, because
        // it is a function of the url and nothing else — unlike the relay, which
        // has to name which slot's elements it is swapping.
        //
        // It declines by returning null, which is most sources: a webcam and a
        // generated mode have no file, a YouTube embed is not ours to fetch, and
        // the demuxer refuses anything it cannot read a sample table out of.
        // Every one of those leaves that deck on the wall-rate element, exactly
        // as it was before the pull existed.
        created.setVideoPullOpener(url => openPullFromUrl(url))
        // Both belong to the engine being replaced: a gpu fault it reported on
        // its way out, and a paint stall latched against its loop. The new loop
        // only reports edges, so a stale `frozen` would never clear itself.
        setError('')
        setFrozen(null)
      }

      // A lost device is not the end of the session. The page is intact — what
      // went away is the GPU-side half — so build a new engine and hand it back
      // everything the user chose: the controls as the panel has them at the
      // moment of the swap (writes during the gap land on the outgoing engine
      // and are copied across), the debug tap, whether B is summing, and each
      // slot's source. The audio graph moves over rather than being rebuilt, so
      // the music does not stop and the clips stay adoptable.
      //
      // What cannot come back is the content of VRAM. The phosphor state, the
      // frame store and the tape loop all start empty, so a feedback look takes
      // a second or two to build back up — which is what a real set does after
      // the power blinks.
      const rebuild = (
        dead: Engine,
        fault: GpuFault,
        message: string,
      ): void => {
        trace.add(
          fault === 'hung' ? 'deviceHung' : 'deviceLost',
          message.slice(0, 120),
        )
        trace.flush(true)
        if (disposed || busy || engineRef.current !== dead) return
        const policy = fault === 'hung' ? hangs : losses
        // The device that just hung had completed work before it stopped
        // answering, so replacing it was the right move and it worked — this is
        // a fresh one-off, not a step toward giving up.
        //
        // It matters because the fault feeding this path is a card that
        // suspends five seconds into a hidden tab, so the interval between two
        // hangs is how long the user spent in another tab. Counting those
        // toward a limit ends the session on the fourth alt-tab of a minute
        // with "three fresh devices did the same", when all three worked. Only
        // a device that never completed anything — a replacement born onto a
        // wedged GPU process — leaves this untouched and escalates.
        if (fault === 'hung' && dead.gpuConfirmed) policy.reset()
        if (policy.record(performance.now()) === 'give-up') {
          // Only here does a hang become the verdict the old code reached
          // immediately: fresh devices were tried and never completed a thing,
          // so what is wedged is behind them — the GPU process, which is shared
          // across tabs and outlives this page. That is the one case where
          // "close the tab" is really the advice, and it is now earned.
          setFatal(
            fault === 'hung'
              ? {
                  title: 'The GPU stopped responding',
                  body: `Submitted work stopped completing, and ${policy.limit} fresh devices never completed any, so the fault is behind them rather than in this session.`,
                  kind: 'hung',
                }
              : {
                  title: 'WebGPU device lost',
                  body: `The GPU device was replaced ${policy.limit} times and kept going away${message === '' ? '' : ` (${message})`}, so the session stopped trying.`,
                  kind: 'lost',
                },
          )
          return
        }
        busy = true
        setRebuilding(fault)
        console.warn(
          fault === 'hung'
            ? `GPU work stopped completing (${message}); replacing the device (${policy.attempt}/${policy.limit})`
            : `WebGPU device lost (${message || 'no reason given'}); rebuilding on a fresh device (${policy.attempt}/${policy.limit})`,
        )
        // Release what the fault left behind. The audio graph is the exception:
        // the replacement adopts it, because a <video> binds to one AudioContext
        // for life and a fresh one could never re-adopt the clips still playing.
        //
        // For a hang this is also the part doing the work. `destroy()` is keyed
        // off its own flag rather than `loop.running` precisely so a loop the
        // hang watchdog already stopped still releases its device — which is
        // what hands the stale one back before another is asked for.
        dead.destroy({ keepAudio: true })
        // The device that just failed is gone for good — a lost one already was,
        // and a hung one must not be handed to the replacement — so this rebuild
        // has to buy a new one. Cheap in itself (0004), so the only thing that
        // stops it here is a tab already living on borrowed frames, and this is
        // the last moment where declining still leaves a page that can say why.
        // `busy` stays set, so nothing tries again behind the screen.
        //
        // How many devices this page has already built is deliberately not part of
        // the question. A card that suspends under a hidden tab produces exactly
        // this path once per alt-tab, every one of them a rebuild that worked, and
        // counting them ended long sessions that were fine.
        if (outOfGpuBudget()) {
          setRebuilding(null)
          declineDevice(
            `${fault === 'hung' ? 'The GPU stopped completing work' : 'The GPU device was lost'}, and replacing it needs another WebGPU device — but this tab has already destroyed ${gpuReleases()} that had been presenting, which is what stops a browser painting a tab at all. Rather than spend a device on a tab the browser may already have given up on, this session stops here. Open this URL in a new tab instead: it starts clean, on the look you have now.`,
            () => replace(dead, fault, CREATE_TRIES),
          )
          return
        }
        replace(dead, fault, CREATE_TRIES)
      }

      // One attempt at standing a new engine up in the old one's place. `dead` is
      // still the store React is reading and every write path is pointed at, so
      // it stays authoritative until the moment `wire` moves them across.
      const replace = (dead: Engine, fault: GpuFault, tries: number): void => {
        Engine.create(canvas, { audio: dead.audioState }).then(
          created => {
            busy = false
            setRebuilding(null)
            if (disposed) {
              created.destroy()
              return
            }
            // Configured before it goes live, so nothing writes to a
            // half-restored engine and the first frame it presents is already
            // the user's look rather than the defaults.
            created.applyControls(dead.getControls())
            created.setDbgView(dead.getDbgView())
            created.setSourceBEnabled(dead.sourceBOn)
            wire(created)
            // Sources last: they write through engineRef, which `wire` just
            // moved. The modulation bay needs nothing here — it lives in React
            // and its effect re-pushes on the new engine's identity — and MIDI
            // writes through engineRef too.
            restoreSlot(slotA, lastSrc.current.a)
            restoreSlot(slotB, lastSrc.current.b)
            // And the loops they were running. The elements played straight
            // through the device loss — they are the browser's, not the GPU's —
            // so the cue is still valid and only the fresh pump needs telling.
            // Read off the ref, since this closure was made at mount.
            created.setVideoRegion(cueRegion(cueRef.current.a))
            created.setVideoRegionB(cueRegion(cueRef.current.b))
            // Forced, like the loss that caused it: if the replacement wedges
            // too, the next session's trace has to show that this one already
            // came back from a loss rather than starting clean.
            trace.add(
              'rebuilt',
              `attempt ${fault === 'hung' ? hangs.attempt : losses.attempt}`,
            )
            trace.flush(true)
            console.warn('engine rebuilt on a fresh device')
          },
          (e: unknown) => {
            if (!disposed) {
              if (tries > 1) {
                // The GPU stack can still be coming back up right after a reset,
                // and requestAdapter fails outright while it is. Ask again before
                // calling the session over.
                console.warn(
                  `rebuild failed (${reason(e)}); retrying in ${CREATE_RETRY_MS}ms`,
                )
                retryId = window.setTimeout(
                  () => replace(dead, fault, tries - 1),
                  CREATE_RETRY_MS,
                )
              } else {
                busy = false
                setRebuilding(null)
                // A device that cannot be created at all is the same dead end
                // whichever fault sent us here, so this one screen covers both —
                // but it still has to say which, or a hang reads as a loss that
                // never happened.
                setFatal({
                  title:
                    fault === 'hung'
                      ? 'The GPU stopped responding'
                      : 'WebGPU device lost',
                  body: `${fault === 'hung' ? 'Submitted work stopped completing' : 'The GPU device went away'} and could not be replaced: ${reason(e)}`,
                  kind: fault,
                })
              }
            }
          },
        )
      }

      const boot = () => {
        Engine.create(canvas).then(
          created => {
            if (disposed) {
              created.destroy()
            } else {
              wire(created)
              // The engine read `?dbg=` for itself; pick it up so the stage badge
              // says which tap a link arrived on rather than claiming the picture.
              setTap(created.getDbgView())
              // Through the slots rather than straight at the engine, so the
              // landing bars are recorded like every other source and a device
              // lost before the user has touched anything still comes back on
              // them.
              showGenerated(slotA, 'bars', beginLoad('a'))
              showGenerated(slotB, 'bars', beginLoad('b'))
              created.setSourceBEnabled(true) // B defaults to bars; ?srcb=none to opt out
              applySession(created, parseSessionParams(location.search))
            }
          },
          (e: unknown) =>
            setFatal({
              title: 'WebGPU unavailable',
              body: e instanceof Error ? e.message : String(e),
              kind: 'unavailable',
            }),
        )
      }

      // Asked before booting, because a tab that arrives here already damaged is a
      // tab whose next device is the one that kills it, and saying so beforehand
      // leaves a page that can still be read.
      //
      // What can actually be true at this point is worth being precise about, since
      // this used to fire on an ordinary refresh. The only way past the gate is
      // `gpuReleases()`, tab-scoped exactly because that damage is what survives a
      // reload — and reachable only under `?gpudestroy=1`. So on a normal load this
      // cannot fire at all, and the reader it is left here for is whoever re-ran
      // the destructive A/B and then reloaded into the hole it makes. Reloading is
      // free, having destroyed a device once is not: 0004 as a boot condition.
      if (outOfGpuBudget()) {
        declineDevice(
          `This tab has destroyed ${gpuReleases()} WebGPU device${gpuReleases() === 1 ? '' : 's'} that had been presenting. That stops the browser giving this tab animation frames — nothing drawn reaches the screen, and reloading lands in the same place. Open this URL in a new tab: it starts clean and on the same look.`,
          boot,
        )
      } else {
        boot()
      }
      return () => {
        disposed = true
        ro.disconnect()
        clearTimeout(retryId)
        window.removeEventListener('pagehide', onPageHide)
        stopVideo()
        stopVideoB()
        // The device stays open. This cleanup runs on a remount and on a Vite hot
        // update — neither of which is the device's fault, and both of which are
        // immediately followed by an engine that would otherwise spend one of the
        // two this tab has. A real page teardown goes through `pagehide` above,
        // which releases it properly so the next load starts GPU-clean.
        engineRef.current?.destroy({ keepDevice: true })
        engineRef.current = null
      }
    }
    // Mount-once: creates the single engine and reads URL params. selectOn is
    // stable enough for the one-shot ?src=webcam path; re-running on its
    // identity would tear down and rebuild the engine.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [])

  return {
    canvasRef,
    engineRef,
    engine,
    fatal,
    frozen,
    rebuilding,
    // What this tab has spent on GPU devices, for the stage notice. The count
    // rides along with the verdict because the number is the argument: "five
    // devices" is a reason to move tabs, "at risk" is a mood.
    budget,
    error,
    // The banner is the one place an async failure surfaces (see format.ts), so
    // the setter goes out with it: the paths that can fail outside the engine —
    // a refused clipboard write, for one — have nowhere else to say so.
    setError,
    statsStore,
    res,
    renderScale,
    setScale,
    tap,
    changeTap,
    // The two input slots, each whole (ui/slotView.ts). Everything that used to
    // be a `…A`/`…B` pair on this object is inside one of these, so nothing
    // downstream pairs a value with a slot by hand any more.
    a: {
      key: 'a',
      tag: 'A',
      time: transport.a.time,
      duration: transport.a.duration,
      seek: t => seekOut('a', t),
      cue: cue.a,
      tapCue: () => tapCueOn('a'),
      retrigger: () => retriggerOn('a'),
      clearCue: () => clearCueOn('a'),
      wrapCost: stall.a,
      mode: sourceMode.a,
      name: sourceName.a,
      select: m => selectOn('a', m),
      live: live.a,
      teletype: card.a,
      retype: p => retypeOn('a', p),
      loadTeletype: p => loadTeletypeOn('a', p),
      ytUrl: ytUrl.a,
      loadYouTube: u => loadYouTubeOn('a', u),
      pendingFile: pending.a === null ? '' : pending.a.name,
      reopenFile: reopenFileA,
      onFile: f => takeFileOn('a', f),
      speed: speed.a,
      changeSpeed: r => changeSpeed('a', r),
      pick: pick.a,
    } satisfies SlotView<SourceMode>,
    b: {
      key: 'b',
      tag: 'B',
      time: transport.b.time,
      duration: transport.b.duration,
      seek: t => seekOut('b', t),
      cue: cue.b,
      tapCue: () => tapCueOn('b'),
      retrigger: () => retriggerOn('b'),
      clearCue: () => clearCueOn('b'),
      wrapCost: stall.b,
      mode: sourceMode.b,
      name: sourceName.b,
      select: m => selectOn('b', m),
      live: live.b,
      teletype: card.b,
      retype: p => retypeOn('b', p),
      loadTeletype: p => loadTeletypeOn('b', p),
      ytUrl: ytUrl.b,
      loadYouTube: u => loadYouTubeOn('b', u),
      pendingFile: pending.b === null ? '' : pending.b.name,
      reopenFile: reopenFileB,
      onFile: f => takeFileOn('b', f),
      speed: speed.b,
      changeSpeed: r => changeSpeed('b', r),
      pick: pick.b,
    } satisfies SlotView<SourceBMode>,
    // Which source dialog is open, for which deck, and the two verbs that move
    // it (useSourcePrompt.ts). One object rather than five ask/setAsk pairs, and
    // the panel never closes one by hand: committing a source does it.
    prompt,
    videoDevices,
    webcamDeviceId,
    startWebcam,
    // The file pickers' refs, deliberately *not* inside the slot objects above.
    // Reading a ref off an object marks that whole object as ref-ish to the
    // React Compiler, and every later plain read of it during render then trips
    // "cannot access refs during render" — one error and the component loses all
    // its memoization. `eng.a` is read a dozen times while building the panel, so
    // it must stay a value the compiler can treat as one. Same reason App pulls
    // `engineRef` out in its first destructure.
    fileInputRef,
    fileInputBRef,
    // The one way into the engine from the clip shelf — everything else about
    // the library lives in useClipLibrary, which the engine has no business
    // knowing about (the File that comes back is the whole of the crossing).
    loadClip,
    // And the one way in from a *name*, which is what both the shelf's kept
    // rolls and the media browser hand over. Its second argument is which
    // picker entry the slot lands on, since the caption reopens whatever the
    // mode names and those two are different doors.
    showRef,
    rollAgain,
    // The ones the strip fires through (ui/useStrip.ts). `showSession` is the
    // same apply a link gets, which is what makes "a row is a query string"
    // true rather than nearly true; `clipOn` is the part of a row a query
    // string *cannot* carry, resolved off the shelf; `rollOn` is a roll that
    // names its pool and draws from the take's generator instead of
    // `Math.random`; `prerollOn` is the row after next's clip, loaded during
    // this one; `faultTo` runs a transition off the shelf with the row's whole
    // step on its cut frame.
    showSession,
    faultTo,
    clipOn,
    rollOn,
    prerollOn,
    // What `+ row` records so the row can put this same clip up again. Deck A
    // alone is what a rundown captures, and the shape is the row's own — see
    // `strip.RowClip` for why an id rather than a url.
    //
    // The runtime is folded in here rather than kept in `deckClip`, because it
    // is not known at the moment a clip lands: `duration` reads NaN until the
    // element has metadata, and the poll that fills it in is the same one the
    // seek bar draws from. Composing at the read makes it whatever the deck
    // knows *now*, with no second copy to go stale — and a capture taken in the
    // first instants of a load records 0, which reads as "cannot say" and holds
    // for a bar count instead.
    deckClipA:
      deckClip.a === null
        ? null
        : { ...deckClip.a, seconds: transport.a.duration },
    // And the one the *offline* walk uses and the live one never does: wait for
    // whatever the row above just asked for to actually be on the deck. See
    // `settleSources`.
    settleSources,
    // Whether there is a pool to roll out of at all, which is not the same as
    // there being a pick up: a file taken off the shelf came out of a list, and a
    // list is not a pool. The palette row says so rather than going quiet, since
    // a row that does nothing has to admit it.
    rollable: isPoolMode(sourceMode.a) || isPoolMode(sourceMode.b),
    reverb,
    setVideoAudio,
    changeReverb,
    applyVaporwave,
  }
}
