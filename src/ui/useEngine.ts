import { useEffect, useRef, useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import {
  gpuAtRisk,
  gpuBuilds,
  gpuReleases,
  outOfGpuBudget,
} from '../gpu/context'
import { Engine } from '../gpu/pipeline'
import { MAX_SRC_EDGE } from '../gpu/sources'
import { reportPreviousTrace, trace } from '../gpu/trace'
import { clipUrl, isClipId } from '../sources/clips'
import {
  commonsCaption,
  isCommonsId,
  resolveCommons,
  rollCommons,
} from '../sources/commons'
import { smpteBars, sweep } from '../sources/pattern'
import { TELETYPE_DEFAULT } from '../sources/teletype'
import { ytId } from '../sources/youtube'
import { backingStoreSize } from './canvasSize'
import { clearStash, readStash, stashClip, stashFile } from './fileStash'
import { canPickHandle, pickHandle } from './fsAccess'
import { randomPresetMix, rollControls } from './presets'
import { RebuildPolicy } from './rebuildPolicy'
import { printCard } from './teletypeSlot'
import {
  REVERB_DEFAULT,
  SPEED_DEFAULT,
  VAPORWAVE_SPEED,
  parseSessionParams,
  urlName,
} from './urlParams'
import { playStream, playUrl, stopSlot, stopTyping } from './videoSlot'

import type { FrameStats } from '../controls'
import type { EngineApi } from '../gpu/engineapi'
import type { FrozenKind } from '../gpu/renderloop'
import type { CommonsId, CommonsPick } from '../sources/commons'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { Fatal } from './FatalScreen'
import type { StashSlot, Stashed } from './fileStash'
import type { PickedFileHandle } from './fsAccess'
import type { SessionParams } from './urlParams'
import type { SlotKind, VideoSlot } from './videoSlot'
import type { WikiFavorite } from './wikiFavorites'
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

const reason = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

// Which picker entry a restored stash lands on — the file dialog for a one-off
// pick, the shelf for a clip that came off it. The distinction is not cosmetic:
// the caption under the picker reopens whatever the mode names, so a shelf clip
// restored as `file` would offer the OS dialog where the shelf belongs.
const stashMode = (stashed: Stashed): 'file' | 'library' =>
  stashed.kind === 'clip' ? 'library' : 'file'

// What a slot is showing off Commons, and out of which pool. The pick's title is
// the identity a star is kept under; the channel is the one thing the pick itself
// cannot carry, since a favourite resolved back off Commons is the same shape as
// a fresh roll. Null for a slot showing anything else, which is what gates the ★
// beside the caption — there is nothing to star about bars.
export interface WikiOnSlot {
  pick: CommonsPick
  channel: CommonsId | ''
}

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
  const [sourceMode, setSourceMode] = useState<SourceMode>('bars')
  // Picked/loaded filename, shown while the source is 'file'; '' otherwise.
  const [sourceName, setSourceName] = useState('')
  // Last session's file, remembered as a disk handle whose read permission the
  // reload dropped: it cannot be reopened without a gesture, so the slot holds
  // it here and the panel offers the click (see fileStash.ts).
  const [pendingA, setPendingA] = useState<Stashed | null>(null)
  const [pendingB, setPendingB] = useState<Stashed | null>(null)
  // Webcam/USB capture: a dialog gates the browser permission prompt, and the
  // device list only carries labels once that grant lands — so both stay empty
  // until the user opts in.
  const [askWebcam, setAskWebcam] = useState(false)
  // Which slot the YouTube URL dialog is loading into, or null when closed.
  const [askYouTube, setAskYouTube] = useState<'a' | 'b' | null>(null)
  // Same for the teletype text dialog, plus the text each slot last showed —
  // kept so reopening the dialog starts on what is on screen, the caption can
  // say what the card reads, and the card survives a shared link. The ref is
  // the copy the async paths read, exactly like vaporRef below.
  const [askTeletype, setAskTeletype] = useState<'a' | 'b' | null>(null)
  // Which slot the clip shelf was opened for, or null when it is closed. Same
  // deferral as the three above: picking `library` opens the dialog and touches
  // nothing else, so backing out of it leaves the current source playing.
  const [askLibrary, setAskLibrary] = useState<StashSlot | null>(null)
  // Which slot the Commons favourites shelf was opened for, or null when closed —
  // the same deferral again: `wiki-faves` opens a list and touches nothing, so
  // backing out of it leaves the current source playing.
  const [askWiki, setAskWiki] = useState<StashSlot | null>(null)
  // What each slot has off Commons. State because the ★ and the credit link under
  // the picker render from it; mirrored into a ref below because every path that
  // writes it is an async reply, where closed-over state is a snapshot.
  const [wikiA, setWikiA] = useState<WikiOnSlot | null>(null)
  const [wikiB, setWikiB] = useState<WikiOnSlot | null>(null)
  const wikiRef = useRef<{ a: WikiOnSlot | null; b: WikiOnSlot | null }>({
    a: null,
    b: null,
  })
  const [cardA, setCardA] = useState(TELETYPE_DEFAULT)
  const [cardB, setCardB] = useState(TELETYPE_DEFAULT)
  const cardRef = useRef({ a: TELETYPE_DEFAULT, b: TELETYPE_DEFAULT })
  // Vaporwave playback: per-slot rate (pitch drops with it) and the reverb wet
  // mix on the tail the clips are heard through. videoA/videoB track what kind
  // of <video> each slot currently holds — only a clip has a rate to change
  // (see SlotKind).
  const [speedA, setSpeedA] = useState(SPEED_DEFAULT)
  const [speedB, setSpeedB] = useState(SPEED_DEFAULT)
  // Whether the clips are routed is not state here: the audio picker holds that
  // answer now, and nothing this hook renders asks. The mirror below is what the
  // re-routing on a source change reads, and it is a ref for the same reason the
  // rest of the vapor config is.
  const [reverb, setReverb] = useState(REVERB_DEFAULT)
  const [videoA, setVideoA] = useState<SlotKind>('none')
  const [videoB, setVideoB] = useState<SlotKind>('none')
  // The loaded YouTube URL per slot, kept so the source round-trips through the
  // query string (a refresh or shared link restores the clip).
  const [ytUrlA, setYtUrlA] = useState('')
  const [ytUrlB, setYtUrlB] = useState('')
  // Where each slot's playhead is, for the seek bars. Polled rather than driven
  // off `timeupdate` for the same reason the audio file's is: the readout ticks
  // in tenths, and a slot slowed to 0.25× fires timeupdate on its own schedule
  // while a paused one fires nothing at all. duration stays 0 until metadata
  // lands and for anything without a finite timeline, which is what keeps the
  // bar off a webcam or a screen share.
  const [transport, setTransport] = useState({ a: NO_CLIP, b: NO_CLIP })
  // Each new element is stamped with the current playback config, but that
  // happens inside async fetch callbacks and the mount-time restore, where the
  // state it would close over is stale; this mirror always holds the latest.
  const vaporRef = useRef({
    speedA: SPEED_DEFAULT,
    speedB: SPEED_DEFAULT,
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
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('bars')
  const [sourceBName, setSourceBName] = useState('')
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

  const changeSpeedA = (rate: number) => {
    vaporRef.current.speedA = rate
    setSpeedA(rate)
    const v = videoRef.current
    if (v !== null) {
      v.defaultPlaybackRate = rate
      v.playbackRate = rate
    }
  }
  const changeSpeedB = (rate: number) => {
    vaporRef.current.speedB = rate
    setSpeedB(rate)
    const v = videoBRef.current
    if (v !== null) {
      v.defaultPlaybackRate = rate
      v.playbackRate = rate
    }
  }
  // Whether the clips' own sound tracks are the audio input: heard out loud and
  // analysed, both out of routeAudio above. Driven by the audio picker in Input,
  // which is the one place that decides where sound comes from. It used to be a
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
    changeSpeedA(VAPORWAVE_SPEED)
    changeSpeedB(VAPORWAVE_SPEED)
    changeReverb(REVERB_DEFAULT)
  }

  // Follow both playheads while either slot holds a clip. 10 Hz, like the audio
  // file's transport and for the same reason: a clock reading in tenths does
  // not need a re-render per frame. The tick writes state only when a number
  // actually moved, so a slot paused on the deck costs nothing.
  const clipA = videoA === 'clip'
  const clipB = videoB === 'clip'
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
      }, 100)
    }
    return () => clearInterval(id)
  }, [clipA, clipB])

  // Seeking moves the readout at once, so the thumb doesn't snap back and wait
  // out the poll interval. Held on the deck (`aPause`/`bPause`) the picture
  // won't follow until the deck rolls again — the pump is frozen — which is what
  // holding a deck means.
  const seekA = (time: number) => {
    const v = videoRef.current
    if (v !== null) {
      v.currentTime = time
      setTransport(p => ({ ...p, a: { ...p.a, time } }))
    }
  }
  const seekB = (time: number) => {
    const v = videoBRef.current
    if (v !== null) {
      v.currentTime = time
      setTransport(p => ({ ...p, b: { ...p.b, time } }))
    }
  }

  // The two slots, as data. Everything below that touches a <video> goes
  // through one of these, so the A and B paths are the same code reading a
  // different descriptor rather than two near-copies drifting apart.
  const adopt = () =>
    routeAudio(vaporRef.current.playAudio, vaporRef.current.reverb)
  // Every source that reaches a slot passes through the three setters below, so
  // that is where the "what is on this slot" record is kept — one write per
  // source change, and no path can set a source without leaving one behind.
  const slotA: VideoSlot = {
    id: 'a',
    ref: videoRef,
    typer: typerARef,
    rate: () => vaporRef.current.speedA,
    attach: el => {
      lastSrc.current.a = el === null ? { kind: 'none' } : { kind: 'video' }
      engineRef.current?.setVideoSource(el)
    },
    // Only A keeps its own aspect — B is staged to the raster with a 4:3 crop,
    // so its shader needs no aspect at all (see gpu/sources.ts).
    setImage: (source, aspect) => {
      lastSrc.current.a = { kind: 'still', source, aspect }
      engineRef.current?.setImageSource(source, aspect)
    },
    setNoise: kind => {
      lastSrc.current.a = { kind: 'noise', noise: kind }
      engineRef.current?.setNoiseSource(kind)
    },
    setLive: setVideoA,
    setYtUrl: setYtUrlA,
    setName: setSourceName,
    card: () => cardRef.current.a,
    setCard: card => {
      cardRef.current.a = card
      setCardA(card)
    },
    onError: setError,
    release: el => engineRef.current?.audioState.releaseMedia(el),
    adopt,
  }
  const slotB: VideoSlot = {
    id: 'b',
    ref: videoBRef,
    typer: typerBRef,
    rate: () => vaporRef.current.speedB,
    attach: el => {
      lastSrc.current.b = el === null ? { kind: 'none' } : { kind: 'video' }
      engineRef.current?.setVideoSourceB(el)
    },
    setImage: source => {
      lastSrc.current.b = { kind: 'still', source }
      engineRef.current?.setImageSourceB(source)
    },
    setNoise: kind => {
      lastSrc.current.b = { kind: 'noise', noise: kind }
      engineRef.current?.setNoiseSourceB(kind)
    },
    setLive: setVideoB,
    setYtUrl: setYtUrlB,
    setName: setSourceBName,
    card: () => cardRef.current.b,
    setCard: card => {
      cardRef.current.b = card
      setCardB(card)
    },
    onError: setError,
    release: el => engineRef.current?.audioState.releaseMedia(el),
    adopt,
  }
  const stopVideo = () => stopSlot(slotA)
  const stopVideoB = () => stopSlot(slotB)

  const slotOf = (key: StashSlot): VideoSlot => (key === 'a' ? slotA : slotB)

  const setWiki = (key: StashSlot, on: WikiOnSlot | null) => {
    wikiRef.current[key] = on
    if (key === 'a') setWikiA(on)
    else setWikiB(on)
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
  // Clearing the Commons pick here rather than in each caller is the same
  // argument: every way out of a wiki source passes through one of these, and a
  // ★ still offering to star the roll after the slot moved to bars would star
  // something nobody can see.
  const beginLoad = (key: StashSlot): (() => boolean) => {
    const seq = (loadSeq.current[key] += 1)
    setWiki(key, null)
    return () => loadSeq.current[key] === seq
  }

  // The built-in sources either slot can show, picked by mode name alone since
  // both slots offer the same set. Four are synthesised on the spot; cat and
  // the bundled clips are files under public/, so cat lands a fetch later —
  // the slot keeps showing whatever it had until then, exactly like the
  // ?iurl path — and a clip plays the same way a picked file does. Teletype
  // reads the slot's own text, since the mode name alone doesn't carry it.
  const showGenerated = (slot: VideoSlot, mode: SourceMode | SourceBMode) => {
    const fresh = beginLoad(slot.id)
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
    else if (isCommonsId(mode)) rollWiki(slot, mode)
  }

  // A Commons pick onto a slot: the caption, the subject of the ★, and then the
  // picture. A still and a clip diverge only in the last of those — one decodes,
  // the other plays through the same blob-less <video> path a bundled clip uses.
  // The transcode is CORS-clean off upload.wikimedia.org and videoSlot.ts already
  // sets crossOrigin, so nothing taints the texture upload.
  const showWiki = (
    slot: VideoSlot,
    picked: CommonsPick,
    channel: CommonsId | '',
    fresh: () => boolean,
  ) => {
    // Whatever the slot was holding is retired here rather than when the request
    // went out — that is what keeps the old picture up while the roll is in
    // flight. It matters for the re-roll: the picker path stops the slot on its
    // way through, but the palette's row calls rollWiki directly, and a
    // time-lapse clip replaced without this would leave the previous element
    // playing, adopted by the audio graph and attached to nothing.
    stopSlot(slot)
    slot.setName(commonsCaption(picked.title))
    setWiki(slot.id, { pick: picked, channel })
    if (picked.kind === 'video') playUrl(slot, picked.url)
    else
      loadImage(picked.url).then(
        bmp => {
          if (fresh()) slot.setImage(bmp, bmp.width / bmp.height)
        },
        (e: unknown) => {
          if (fresh()) {
            slot.setName('')
            setWiki(slot.id, null)
            setError(`commons: ${reason(e)}`)
          }
        },
      )
  }

  // Roll a file out of a Commons channel and show it. Two requests' worth of
  // latency in the worst case and none of it blocking: like the cat photo and
  // the ?iurl path, the slot keeps showing whatever it had until the roll lands,
  // so switching to a channel never flashes a dead slot.
  //
  // The caption is written twice on purpose. The first write is the only thing
  // on screen that says a request is out — a channel can sit on the network for
  // a second or two, and without it a pick reads as having done nothing.
  const rollWiki = (slot: VideoSlot, id: CommonsId) => {
    // Read before `beginLoad` clears it: what is on the slot right now is what a
    // re-roll of the *same* channel should try not to hand back (see `avoid` on
    // rollCommons). A roll on a channel the slot was not already on has nothing
    // to avoid — the picture that is going away came out of a different pool.
    const showing = wikiRef.current[slot.id]
    const avoid = showing?.channel === id ? showing.pick.title : ''
    const fresh = beginLoad(slot.id)
    slot.setName('rolling…')
    rollCommons(id, avoid).then(
      picked => {
        if (fresh()) showWiki(slot, picked, id, fresh)
      },
      (e: unknown) => {
        if (fresh()) {
          slot.setName('')
          setError(`commons: ${reason(e)}`)
        }
      },
    )
  }

  // Another file out of whichever deck is on a channel, for hands that are not on
  // the sidebar — the command palette's row, and the keyboard through it. A wins
  // when both are rolling, since A is the picture; a set with Commons on B alone
  // still gets the command.
  const rollAgain = () => {
    if (isCommonsId(sourceMode)) rollWiki(slotA, sourceMode)
    else if (isCommonsId(sourceBMode)) rollWiki(slotB, sourceBMode)
  }

  // A starred roll, back onto a slot. Resolved by title rather than replayed from
  // a stored url (wikiFavorites.ts says why), so this is a request like a roll and
  // not an assignment — hence the caption saying so while it is out.
  //
  // The mode lands on `wiki-faves` rather than on the channel the file came out
  // of, even though the channel is known: the caption reopens whatever the mode
  // names, and on a channel that caption *rolls*, which would throw away the very
  // picture the user just went to their shelf for.
  const showFavorite = (key: StashSlot, fave: WikiFavorite) => {
    setError('')
    setAskWiki(null)
    const slot = slotOf(key)
    const fresh = beginLoad(key)
    if (key === 'a') {
      stopVideo()
      setSourceMode('wiki-faves')
    } else {
      stopVideoB()
      setSourceBMode('wiki-faves')
      engineRef.current?.setSourceBEnabled(true)
    }
    dropFile(key)
    slot.setName('opening…')
    resolveCommons(fave.title, fave.kind).then(
      picked => {
        if (fresh()) showWiki(slot, picked, fave.channel, fresh)
      },
      (e: unknown) => {
        if (fresh()) {
          slot.setName('')
          setError(`commons: ${reason(e)}`)
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
    // Whatever last session parked for this slot has been answered, whether by
    // the click it was waiting for or by the user going somewhere else
    // entirely. Left set, its "↺ reopen last session's file" caption sits under
    // a slot that is already playing something, offering to replace it.
    if (key === 'a') setPendingA(null)
    else setPendingB(null)
    beginLoad(key)
    if (key === 'a') {
      stopVideo()
      setSourceMode(mode)
      setSourceName(file.name)
      showFile(slotA, file)
    } else {
      stopVideoB()
      setSourceBMode(mode)
      setSourceBName(file.name)
      engineRef.current?.setSourceBEnabled(true)
      showFile(slotB, file)
    }
  }
  const adoptFileA = (file: File) => adoptInto('a', file, 'file')
  const adoptFileB = (file: File) => adoptInto('b', file, 'file')

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
    stashClip(key, clip).catch((e: unknown) =>
      console.log('DEBUG stash failed', reason(e)),
    )
    setAskLibrary(null)
  }

  // Keep / drop what lets a slot reopen its file after a reload (fileStash.ts).
  // Never a banner: the source is loaded and playing either way, and all that is
  // lost is getting it back next session.
  const keepFile = (
    key: StashSlot,
    file: File,
    handle: PickedFileHandle | undefined,
  ) => {
    stashFile(key, file, handle).then(
      kept => {
        if (!kept) console.log('DEBUG stash skipped, too large', file.name)
      },
      (e: unknown) => console.log('DEBUG stash failed', reason(e)),
    )
  }
  const dropFile = (key: StashSlot) => {
    if (key === 'a') setPendingA(null)
    else setPendingB(null)
    clearStash(key).catch((e: unknown) =>
      console.log('DEBUG unstash failed', reason(e)),
    )
  }

  // What the slot held last session, put back. A copied stash opens straight
  // away; a disk handle whose read permission died with the page needs a click,
  // so it is parked in `pending` for the caption to offer instead.
  const reopenStashed = (key: StashSlot, park: (stashed: Stashed) => void) => {
    readStash(key).then(
      stashed => {
        if (stashed !== null) {
          if (stashed.needsGesture) park(stashed)
          else
            stashed.open().then(
              file => adoptInto(key, file, stashMode(stashed)),
              (e: unknown) => {
                console.log('DEBUG stash reopen failed', reason(e))
                dropFile(key)
              },
            )
        }
      },
      (e: unknown) => console.log('DEBUG stash read failed', reason(e)),
    )
  }

  // The click the parked handle was waiting for. requestPermission runs on the
  // gesture's transient activation, which is why `open` is called with nothing
  // awaited in front of it.
  const reopenPending = (key: StashSlot, pending: Stashed | null) => {
    if (pending !== null)
      pending.open().then(
        // `adoptInto` is what clears the park, since every way out of it ends
        // there — the grant landing, or another source arriving first.
        file => adoptInto(key, file, stashMode(pending)),
        (e: unknown) => setError(`reopen ${pending.name}: ${reason(e)}`),
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
  const downloadYouTube = (
    slot: VideoSlot,
    url: string,
    label: (text: string) => void,
    onFail: () => void,
  ) => {
    slot.setYtUrl(url)
    label(`youtube: ${ytId(url)} — downloading…`)
    fetchYouTube(url).then(
      blob => {
        playUrl(slot, URL.createObjectURL(blob))
        label(`youtube: ${ytId(url)}`)
      },
      (e: unknown) => {
        setError(`youtube: ${reason(e)}`)
        label('')
        onFail()
      },
    )
  }

  const loadTeletype = (patch: Partial<TeletypeCard>) => {
    if (engineRef.current) {
      stopVideo()
      setError('')
      setSourceMode('teletype')
      dropFile('a')
      printOn(slotA, patch)
    }
  }

  const loadTeletypeB = (patch: Partial<TeletypeCard>) => {
    const current = engineRef.current
    if (current) {
      stopVideoB()
      setError('')
      setSourceBMode('teletype')
      current.setSourceBEnabled(true)
      dropFile('b')
      printOn(slotB, patch)
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
  const retypeTeletype = (patch: Partial<TeletypeCard>) => {
    if (engineRef.current && sourceMode === 'teletype')
      printOn(slotA, patch, true)
  }

  const retypeTeletypeB = (patch: Partial<TeletypeCard>) => {
    if (engineRef.current && sourceBMode === 'teletype')
      printOn(slotB, patch, true)
  }

  const selectSource = (mode: SourceMode) => {
    const current = engineRef.current
    if (current) {
      // Every source change starts here (file picks too — the file dialog is
      // only opened from this handler), so clear any stale failure banner once.
      setError('')
      // For file, wait until a file is actually picked before touching state:
      // cancelling the OS dialog then leaves the current source untouched.
      if (mode === 'file') {
        pickFile('a', fileInputRef, adoptFileA)
      } else if (mode === 'library') {
        // Same deferral as the dialogs below: the shelf is a list until one of
        // its rows is clicked, and closing it unpicked leaves A as it was.
        setAskLibrary('a')
      } else if (mode === 'wiki-faves') {
        setAskWiki('a')
      } else if (mode === 'webcam') {
        // Defer stopVideo/setSourceMode until the user confirms in the dialog:
        // cancelling then leaves the current source (and its permission) alone.
        setAskWebcam(true)
      } else if (mode === 'youtube') {
        // Same deferral: wait for a URL in the dialog before touching state.
        setAskYouTube('a')
      } else if (mode === 'teletype') {
        // And again: the card is whatever the dialog comes back with.
        setAskTeletype('a')
      } else if (mode === 'screen') {
        // No dialog of our own: the browser's picker *is* the confirmation, and
        // this handler still holds the click's transient activation, which
        // getDisplayMedia requires.
        startScreen('a')
      } else {
        stopVideo()
        setSourceMode(mode)
        setSourceName('')
        dropFile('a')
        showGenerated(slotA, mode)
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
  const startScreen = (slot: 'a' | 'b') => {
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
        if (slot === 'a') {
          beginLoad('a')
          stopVideo()
          setSourceMode('screen')
          setSourceName(name)
          dropFile('a')
          // A share the user ended from the browser's own bar leaves the slot
          // holding a frozen last frame. Snow is what a set with nothing on its
          // input shows, and this app has no clearer way to say "the feed went".
          playStream(slotA, stream, () => selectSource('tv static'))
        } else {
          beginLoad('b')
          stopVideoB()
          setSourceBMode('screen')
          setSourceBName(name)
          dropFile('b')
          engineRef.current?.setSourceBEnabled(true)
          // B is optional by nature, so its "the feed went" is off rather than
          // snow: summing static into the composite would be a bigger change to
          // the look than letting go of a share asks for.
          playStream(slotB, stream, () => selectSourceB('none'))
        }
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
  const startWebcam = (deviceId: string) => {
    const current = engineRef.current
    if (current) {
      stopVideo()
      const video = deviceId === '' ? true : { deviceId: { exact: deviceId } }
      navigator.mediaDevices.getUserMedia({ video }).then(
        stream => {
          beginLoad('a')
          playStream(slotA, stream)
          setSourceMode('webcam')
          setSourceName('')
          setAskWebcam(false)
          dropFile('a')
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
  const onFile = (file: File | undefined) => {
    if (file && engineRef.current) {
      adoptFileA(file)
      keepFile('a', file, undefined)
    }
  }

  const onFileB = (file: File | undefined) => {
    if (file && engineRef.current) {
      adoptFileB(file)
      keepFile('b', file, undefined)
    }
  }

  const reopenFileA = () => reopenPending('a', pendingA)
  const reopenFileB = () => reopenPending('b', pendingB)

  // Both slots feed the clip through the same blob-backed <video> path as a
  // picked file; only the mode bookkeeping differs, and B's enable flag.
  const loadYouTube = (url: string) => {
    const trimmed = url.trim()
    if (engineRef.current && trimmed !== '') {
      stopVideo()
      setError('')
      beginLoad('a')
      setSourceMode('youtube')
      dropFile('a')
      downloadYouTube(slotA, trimmed, setSourceName, () => {})
    }
  }

  const loadYouTubeB = (url: string) => {
    const current = engineRef.current
    const trimmed = url.trim()
    if (current && trimmed !== '') {
      stopVideoB()
      setError('')
      beginLoad('b')
      setSourceBMode('youtube')
      current.setSourceBEnabled(true)
      dropFile('b')
      downloadYouTube(slotB, trimmed, setSourceBName, () => {
        setSourceBMode('none')
        current.setSourceBEnabled(false)
      })
    }
  }

  const selectSourceB = (mode: SourceBMode) => {
    const current = engineRef.current
    if (current) {
      setError('') // entry for every B change (incl. file dialog); clear once
      if (mode === 'file') {
        pickFile('b', fileInputBRef, adoptFileB)
      } else if (mode === 'library') {
        setAskLibrary('b')
      } else if (mode === 'wiki-faves') {
        setAskWiki('b')
      } else if (mode === 'youtube') {
        setAskYouTube('b')
      } else if (mode === 'teletype') {
        setAskTeletype('b')
      } else if (mode === 'screen') {
        startScreen('b')
      } else {
        stopVideoB()
        setSourceBMode(mode)
        setSourceBName('')
        dropFile('b')
        current.setSourceBEnabled(mode !== 'none')
        showGenerated(slotB, mode)
      }
    }
  }

  // Put a parsed link on the freshly-created engine. The parsing itself is pure
  // and tested (urlParams.ts); what is left here is only the applying, in the
  // one order that matters: the vaporwave settings land before any clip loads,
  // since a new element reads its playback rate off vaporRef at creation.
  const restoreSession = (eng: Engine, params: SessionParams) => {
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
    if (params.surprise) {
      eng.applyControls(rollControls(randomPresetMix(false), DEFAULT_CONTROLS))
    }
    eng.applyControls(params.controls)
    // Before either source is shown: the teletype card is typed out of the
    // slot's own text, so the link's text has to be on the slot by then.
    if (params.card !== null) slotA.setCard(params.card)
    if (params.cardb !== null) slotB.setCard(params.cardb)
    if (params.src === 'webcam') {
      selectSource('webcam')
    } else if (params.src !== null) {
      showGenerated(slotA, params.src)
      setSourceMode(params.src)
    }
    if (params.srcb !== null) {
      eng.setSourceBEnabled(params.srcb !== 'none')
      showGenerated(slotB, params.srcb)
      setSourceBMode(params.srcb)
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
        setSourceMode('file')
        setSourceName(urlName(url))
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
        setSourceBMode('file')
        setSourceBName(urlName(url))
      }, imageError)
    }
    if (params.vurl !== null) {
      beginLoad('a')
      stopTyping(slotA)
      playUrl(slotA, params.vurl)
      setSourceMode('file')
      setSourceName(urlName(params.vurl))
    }
    // Audio is left off however the link arrived: browsers block unmuted
    // autoplay without a gesture, so a restored clip must load muted and the
    // user re-enables sound with one click on the panel toggle.
    vaporRef.current = { ...params.vapor, playAudio: false }
    setSpeedA(params.vapor.speedA)
    setSpeedB(params.vapor.speedB)
    setReverb(params.vapor.reverb)
    if (params.yt !== null) loadYouTube(params.yt)
    if (params.ytb !== null) loadYouTubeB(params.ytb)
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
    else reopenStashed('a', setPendingA)
    if (linkNamesB) dropFile('b')
    else reopenStashed('b', setPendingB)
    if (params.debug) console.log('DEBUG engine ready')
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
              showGenerated(slotA, 'bars')
              showGenerated(slotB, 'bars')
              created.setSourceBEnabled(true) // B defaults to bars; ?srcb=none to opt out
              restoreSession(created, parseSessionParams(location.search))
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
    // Mount-once: creates the single engine and reads URL params. selectSource
    // is stable enough for the one-shot ?src=webcam path; re-running on its
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
    statsStore,
    res,
    renderScale,
    setScale,
    tap,
    changeTap,
    sourceMode,
    sourceName,
    selectSource,
    sourceBMode,
    sourceBName,
    selectSourceB,
    askWebcam,
    setAskWebcam,
    videoDevices,
    webcamDeviceId,
    startWebcam,
    fileInputRef,
    fileInputBRef,
    onFile,
    onFileB,
    // '' unless last session's file is waiting on a click to re-grant read.
    pendingFileA: pendingA === null ? '' : pendingA.name,
    pendingFileB: pendingB === null ? '' : pendingB.name,
    reopenFileA,
    reopenFileB,
    loadYouTube,
    loadYouTubeB,
    askYouTube,
    setAskYouTube,
    loadTeletype,
    loadTeletypeB,
    retypeTeletype,
    retypeTeletypeB,
    askTeletype,
    setAskTeletype,
    // The clip shelf: which slot it was opened for, and the one way in and out
    // of it. `loadClip` is what the dialog's rows call — everything else about
    // the library lives in useClipLibrary, which the engine has no business
    // knowing about (the File that comes back is the whole of the crossing).
    askLibrary,
    setAskLibrary,
    loadClip,
    // The Commons side of the same arrangement: which slot the starred-rolls
    // shelf was opened for, the two ways a file gets onto a slot from it (a
    // starred one played back, or another roll out of the channel), and what each
    // slot currently has off Commons — which is what the ★ under the picker is
    // rendered from and what it stars. The list itself lives in useWikiFavorites,
    // which the engine has no business knowing about.
    askWiki,
    setAskWiki,
    showFavorite,
    rollAgain,
    // Whether there is a pool to roll out of at all, which is not the same as
    // there being a Commons pick up: a starred roll came off the shelf, and the
    // shelf is a list rather than a pool. The palette row says so rather than
    // going quiet, since a row that does nothing has to admit it.
    wikiRollable: isCommonsId(sourceMode) || isCommonsId(sourceBMode),
    wikiA,
    wikiB,
    teletypeA: cardA,
    teletypeB: cardB,
    videoA,
    videoB,
    // Transport per slot: 0 duration means there is nothing to seek.
    timeA: transport.a.time,
    durationA: transport.a.duration,
    timeB: transport.b.time,
    durationB: transport.b.duration,
    seekA,
    seekB,
    speedA,
    speedB,
    reverb,
    ytUrlA,
    ytUrlB,
    changeSpeedA,
    changeSpeedB,
    setVideoAudio,
    changeReverb,
    applyVaporwave,
  }
}
