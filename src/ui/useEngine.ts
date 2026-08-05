import { useEffect, useRef, useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import { Engine } from '../gpu/pipeline'
import { MAX_SRC_EDGE } from '../gpu/sources'
import { reportPreviousTrace, trace } from '../gpu/trace'
import { clipUrl, isClipId } from '../sources/clips'
import { smpteBars, sweep } from '../sources/pattern'
import { TELETYPE_DEFAULT } from '../sources/teletype'
import { ytId } from '../sources/youtube'
import {
  canPickHandle,
  clearStash,
  pickHandle,
  readStash,
  stashFile,
} from './fileStash'
import { blendPresets, randomPresetMix } from './presets'
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
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { Fatal } from './FatalScreen'
import type { PickedFileHandle, StashSlot, Stashed } from './fileStash'
import type { SessionParams } from './urlParams'
import type { SlotKind, VideoSlot } from './videoSlot'
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

// Tries per rebuild, and the wait between them. requestAdapter can fail outright
// in the moments after a driver reset — the GPU stack is still coming back — so
// a failed create is worth re-asking before calling the session over.
const CREATE_TRIES = 3
const CREATE_RETRY_MS = 700

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
  const [frozen, setFrozen] = useState(false)
  // A lost device is being replaced. Also a banner rather than a screen: the
  // whole point of the rebuild is that the session survives it, and the picture
  // is back within a second — but the gap has to say what it is, or it reads as
  // exactly the freeze this all exists to avoid.
  const [rebuilding, setRebuilding] = useState(false)

  // The stage banner rides on the canvas, so it is invisible in the worst
  // version of this — a document the browser has stopped painting entirely,
  // where nothing the DOM says reaches the screen. The tab title is browser
  // chrome, drawn by the parent process, so it still gets through.
  useEffect(() => {
    const original = document.title
    if (frozen) {
      document.title = `⏸ frozen — ${original}`
    }
    return () => {
      document.title = original
    }
  }, [frozen])
  const [stats, setStats] = useState<FrameStats>({ fps: 0 })
  const [engine, setEngine] = useState<EngineApi | null>(null)
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
  const [cardA, setCardA] = useState(TELETYPE_DEFAULT)
  const [cardB, setCardB] = useState(TELETYPE_DEFAULT)
  const cardRef = useRef({ a: TELETYPE_DEFAULT, b: TELETYPE_DEFAULT })
  // Vaporwave playback: per-slot rate (pitch drops with it), whether the video
  // audio is routed to the speakers + reactive path, and the reverb wet mix.
  // videoA/videoB track what kind of <video> each slot currently holds — only
  // a clip has a rate to change (see SlotKind).
  const [speedA, setSpeedA] = useState(SPEED_DEFAULT)
  const [speedB, setSpeedB] = useState(SPEED_DEFAULT)
  const [playAudio, setPlayAudio] = useState(false)
  const [reverb, setReverb] = useState(REVERB_DEFAULT)
  const [videoA, setVideoA] = useState<SlotKind>('none')
  const [videoB, setVideoB] = useState<SlotKind>('none')
  // The loaded YouTube URL per slot, kept so the source round-trips through the
  // query string (a refresh or shared link restores the clip).
  const [ytUrlA, setYtUrlA] = useState('')
  const [ytUrlB, setYtUrlB] = useState('')
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

  // Backing-store size = css size × min(dpr,2) × render scale, then clamped so
  // the long edge never exceeds MAX_EDGE. The picture is a 754-wide face texture
  // upscaled by the present pass, so past ~2560 the extra output pixels buy no
  // detail — they just pile per-pixel present cost onto the GPU/compositor,
  // which on a big fullscreen display is exactly when the freezes bite.
  const MAX_EDGE = 2560
  const applyCanvasSize = () => {
    const canvas = canvasRef.current
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio, 2) * renderScaleRef.current
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      const clamp = Math.min(1, MAX_EDGE / Math.max(w, h))
      const bufW = Math.max(1, Math.round(w * clamp))
      const bufH = Math.max(1, Math.round(h * clamp))
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
  const toggleAudio = () => {
    const on = !playAudio
    vaporRef.current.playAudio = on
    setPlayAudio(on)
    routeAudio(on, reverb)
  }
  const changeReverb = (mix: number) => {
    vaporRef.current.reverb = mix
    setReverb(mix)
    engineRef.current?.audioState.setReverbMix(mix)
  }
  // The vaporwave preset: slow both slots, dial in reverb, force audio on.
  const applyVaporwave = () => {
    changeSpeedA(VAPORWAVE_SPEED)
    changeSpeedB(VAPORWAVE_SPEED)
    changeReverb(REVERB_DEFAULT)
    vaporRef.current.playAudio = true
    setPlayAudio(true)
    routeAudio(true, REVERB_DEFAULT)
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

  // The built-in sources either slot can show, picked by mode name alone since
  // both slots offer the same set. Four are synthesised on the spot; cat and
  // the bundled clips are files under public/, so cat lands a fetch later —
  // the slot keeps showing whatever it had until then, exactly like the
  // ?iurl path — and a clip plays the same way a picked file does. Teletype
  // reads the slot's own text, since the mode name alone doesn't carry it.
  const showGenerated = (slot: VideoSlot, mode: SourceMode | SourceBMode) => {
    if (mode === 'bars') slot.setImage(smpteBars())
    else if (mode === 'sweep') slot.setImage(sweep())
    else if (mode === 'tv static') slot.setNoise(1)
    else if (mode === 'vhs static') slot.setNoise(2)
    else if (mode === 'teletype') printCard(slot, slot.card())
    else if (mode === 'cat')
      loadImage(CAT_URL).then(
        bmp => slot.setImage(bmp, bmp.width / bmp.height),
        (e: unknown) => setError(`image: ${reason(e)}`),
      )
    else if (isClipId(mode)) playUrl(slot, clipUrl(mode))
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
  // picked, reopened from last session, or re-granted by a click.
  const adoptFileA = (file: File) => {
    stopVideo()
    setSourceMode('file')
    setSourceName(file.name)
    showFile(slotA, file)
  }
  const adoptFileB = (file: File) => {
    stopVideoB()
    setSourceBMode('file')
    setSourceBName(file.name)
    engineRef.current?.setSourceBEnabled(true)
    showFile(slotB, file)
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
  const reopenStashed = (
    key: StashSlot,
    park: (stashed: Stashed) => void,
    onFile: (file: File) => void,
  ) => {
    readStash(key).then(
      stashed => {
        if (stashed !== null) {
          if (stashed.needsGesture) park(stashed)
          else
            stashed.open().then(onFile, (e: unknown) => {
              console.log('DEBUG stash reopen failed', reason(e))
              dropFile(key)
            })
        }
      },
      (e: unknown) => console.log('DEBUG stash read failed', reason(e)),
    )
  }

  // The click the parked handle was waiting for. requestPermission runs on the
  // gesture's transient activation, which is why `open` is called with nothing
  // awaited in front of it.
  const reopenPending = (
    key: StashSlot,
    pending: Stashed | null,
    onFile: (file: File) => void,
  ) => {
    if (pending !== null)
      pending.open().then(
        file => {
          if (key === 'a') setPendingA(null)
          else setPendingB(null)
          onFile(file)
        },
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
          stopVideo()
          setSourceMode('screen')
          setSourceName(name)
          dropFile('a')
          // A share the user ended from the browser's own bar leaves the slot
          // holding a frozen last frame. Snow is what a set with nothing on its
          // input shows, and this app has no clearer way to say "the feed went".
          playStream(slotA, stream, () => selectSource('tv static'))
        } else {
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

  const reopenFileA = () => reopenPending('a', pendingA, adoptFileA)
  const reopenFileB = () => reopenPending('b', pendingB, adoptFileB)

  // Both slots feed the clip through the same blob-backed <video> path as a
  // picked file; only the mode bookkeeping differs, and B's enable flag.
  const loadYouTube = (url: string) => {
    const trimmed = url.trim()
    if (engineRef.current && trimmed !== '') {
      stopVideo()
      setError('')
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
    if (params.surprise) {
      eng.applyControls(blendPresets(DEFAULT_CONTROLS, randomPresetMix(false)))
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
    if (params.iurl !== null) {
      const url = params.iurl
      loadImage(url).then(bmp => {
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
      loadImage(url).then(bmp => {
        stopTyping(slotB)
        slotB.setImage(bmp)
        eng.setSourceBEnabled(true)
        setSourceBMode('file')
        setSourceBName(urlName(url))
      }, imageError)
    }
    if (params.vurl !== null) {
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
    else reopenStashed('a', setPendingA, adoptFileA)
    if (linkNamesB) dropFile('b')
    else reopenStashed('b', setPendingB, adoptFileB)
    if (params.debug) console.log('DEBUG engine ready')
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
      // A full page reload doesn't run this effect's cleanup, so the GPUDevice
      // is abandoned rather than destroyed — and a wedged GPU then carries into
      // the reloaded page's fresh device (why "just refresh" often fails to
      // recover). Release it on pagehide so the reload starts GPU-clean.
      // Also latch `disposed`: pagehide can land while Engine.create is still
      // in flight, when there is no engine to destroy yet but a GPUDevice has
      // already been handed out. The create callback below then releases it
      // instead of leaving it to the page teardown.
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
      const losses = new RebuildPolicy()
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
        created.onStats = setStats
        created.onGpuError = m => {
          trace.add('gpuError', m.slice(0, 120))
          trace.flush(true)
          setError(`gpu: ${m}`)
        }
        // Bound to the engine that lost its device, not to whatever is live when
        // the promise settles: `lost` can resolve late, and a stale one must not
        // be able to tear down the successor that replaced it.
        created.onDeviceLost = m => rebuild(created, m)
        // Not a lost device: the device never reported anything, it just
        // stopped completing submitted work — so don't title it as one, and
        // don't rebuild for it. A wedged GPU process is shared across tabs and
        // outlives this page, so a fresh device would land on the same one.
        created.onHang = () =>
          setFatal({
            title: 'The GPU stopped responding',
            body: 'Submitted work stopped completing, so the picture would be frozen even though the app is still running.',
            kind: 'hung',
          })
        created.onFrozen = f => setFrozen(f)
        // Both belong to the engine being replaced: a gpu fault it reported on
        // its way out, and a paint stall latched against its loop. The new loop
        // only reports edges, so a stale `frozen` would never clear itself.
        setError('')
        setFrozen(false)
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
      const rebuild = (dead: Engine, message: string): void => {
        trace.add('deviceLost', message.slice(0, 120))
        trace.flush(true)
        if (disposed || busy || engineRef.current !== dead) return
        if (losses.record(performance.now()) === 'give-up') {
          setFatal({
            title: 'WebGPU device lost',
            body: `The GPU device was replaced ${losses.limit} times and kept going away${message === '' ? '' : ` (${message})`}, so the session stopped trying.`,
            kind: 'lost',
          })
          return
        }
        busy = true
        setRebuilding(true)
        console.warn(
          `WebGPU device lost (${message || 'no reason given'}); rebuilding on a fresh device (${losses.attempt}/${losses.limit})`,
        )
        // Release what the loss left behind. The audio graph is the exception:
        // the replacement adopts it, because a <video> binds to one AudioContext
        // for life and a fresh one could never re-adopt the clips still playing.
        dead.destroy({ keepAudio: true })
        replace(dead, CREATE_TRIES)
      }

      // One attempt at standing a new engine up in the old one's place. `dead` is
      // still the store React is reading and every write path is pointed at, so
      // it stays authoritative until the moment `wire` moves them across.
      const replace = (dead: Engine, tries: number): void => {
        Engine.create(canvas, { audio: dead.audioState }).then(
          created => {
            busy = false
            setRebuilding(false)
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
            trace.add('rebuilt', `attempt ${losses.attempt}`)
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
                  () => replace(dead, tries - 1),
                  CREATE_RETRY_MS,
                )
              } else {
                busy = false
                setRebuilding(false)
                setFatal({
                  title: 'WebGPU device lost',
                  body: `The GPU device went away and could not be replaced: ${reason(e)}`,
                  kind: 'lost',
                })
              }
            }
          },
        )
      }

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
            // landing bars are recorded like every other source and a device lost
            // before the user has touched anything still comes back on them.
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
      return () => {
        disposed = true
        ro.disconnect()
        clearTimeout(retryId)
        window.removeEventListener('pagehide', onPageHide)
        stopVideo()
        stopVideoB()
        engineRef.current?.destroy()
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
    error,
    stats,
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
    teletypeA: cardA,
    teletypeB: cardB,
    videoA,
    videoB,
    speedA,
    speedB,
    playAudio,
    reverb,
    ytUrlA,
    ytUrlB,
    changeSpeedA,
    changeSpeedB,
    toggleAudio,
    changeReverb,
    applyVaporwave,
  }
}
