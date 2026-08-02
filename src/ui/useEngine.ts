import { useEffect, useRef, useState } from 'react'

import { DEFAULT_CONTROLS } from '../controls'
import { Engine } from '../gpu/pipeline'
import { MAX_SRC_EDGE } from '../gpu/sources'
import { reportPreviousTrace, trace } from '../gpu/trace'
import { smpteBars, sweep } from '../sources/pattern'
import { ytId } from '../sources/youtube'
import {
  canPickHandle,
  clearStash,
  pickHandle,
  readStash,
  stashFile,
} from './fileStash'
import { blendPresets, randomPresetMix } from './presets'
import {
  REVERB_DEFAULT,
  SPEED_DEFAULT,
  VAPORWAVE_SPEED,
  parseSessionParams,
  urlName,
} from './urlParams'
import { playStream, playUrl, stopSlot } from './videoSlot'

import type { FrameStats } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { Fatal } from './FatalScreen'
import type { PickedFileHandle, StashSlot, Stashed } from './fileStash'
import type { SessionParams } from './urlParams'
import type { VideoSlot } from './videoSlot'
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

declare global {
  interface Window {
    vf?: Engine
  }
}

// Owns the singleton Engine (a GPUDevice + rAF loop), its lifecycle, and every
// video/image source path (patterns, files, webcam/USB capture, source B).
export function useEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoBRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputBRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<Fatal | null>(null)
  const [stats, setStats] = useState<FrameStats>({ fps: 0 })
  const [engine, setEngine] = useState<Engine | null>(null)
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
  // Vaporwave playback: per-slot rate (pitch drops with it), whether the video
  // audio is routed to the speakers + reactive path, and the reverb wet mix.
  // videoA/videoB track whether each slot currently holds a live <video>.
  const [speedA, setSpeedA] = useState(SPEED_DEFAULT)
  const [speedB, setSpeedB] = useState(SPEED_DEFAULT)
  const [playAudio, setPlayAudio] = useState(false)
  const [reverb, setReverb] = useState(REVERB_DEFAULT)
  const [videoA, setVideoA] = useState(false)
  const [videoB, setVideoB] = useState(false)
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
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [webcamDeviceId, setWebcamDeviceId] = useState('')
  const [sourceBMode, setSourceBMode] = useState<SourceBMode>('bars')
  const [sourceBName, setSourceBName] = useState('')
  const [renderScale, setRenderScale] = useState(1)
  const renderScaleRef = useRef(1)
  const [res, setRes] = useState('')

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
      canvas.width = Math.max(1, Math.round(w * clamp))
      canvas.height = Math.max(1, Math.round(h * clamp))
      // Every one of these reconfigures the WebGPU swapchain, so the trace wants
      // them: a wedge that follows a resize storm looks very different from one
      // that arrives out of a quiet stretch.
      trace.add('resize', `${canvas.width}x${canvas.height}`)
      setRes(`${canvas.width}×${canvas.height}`)
    }
  }

  const setScale = (v: number) => {
    renderScaleRef.current = v
    setRenderScale(v)
    applyCanvasSize()
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
  const slotA: VideoSlot = {
    ref: videoRef,
    rate: () => vaporRef.current.speedA,
    attach: el => engineRef.current?.setVideoSource(el),
    // Only A keeps its own aspect — B is staged to the raster with a 4:3 crop,
    // so its shader needs no aspect at all (see gpu/sources.ts).
    setImage: (source, aspect) =>
      engineRef.current?.setImageSource(source, aspect),
    setNoise: kind => engineRef.current?.setNoiseSource(kind),
    setLive: setVideoA,
    setYtUrl: setYtUrlA,
    onError: setError,
    release: el => engineRef.current?.audioState.releaseMedia(el),
    adopt,
  }
  const slotB: VideoSlot = {
    ref: videoBRef,
    rate: () => vaporRef.current.speedB,
    attach: el => engineRef.current?.setVideoSourceB(el),
    setImage: source => engineRef.current?.setImageSourceB(source),
    setNoise: kind => engineRef.current?.setNoiseSourceB(kind),
    setLive: setVideoB,
    setYtUrl: setYtUrlB,
    onError: setError,
    release: el => engineRef.current?.audioState.releaseMedia(el),
    adopt,
  }
  const stopVideo = () => stopSlot(slotA)
  const stopVideoB = () => stopSlot(slotB)

  // The built-in sources either slot can show, picked by mode name alone since
  // both slots offer the same set. Four are synthesised on the spot; the cat is
  // a bundled file, so it lands a fetch later — the slot keeps showing whatever
  // it had until then, exactly like the ?iurl path.
  const showGenerated = (slot: VideoSlot, mode: SourceMode | SourceBMode) => {
    if (mode === 'bars') slot.setImage(smpteBars())
    else if (mode === 'sweep') slot.setImage(sweep())
    else if (mode === 'tv static') slot.setNoise(1)
    else if (mode === 'vhs static') slot.setNoise(2)
    else if (mode === 'cat')
      loadImage(CAT_URL).then(
        bmp => slot.setImage(bmp, bmp.width / bmp.height),
        (e: unknown) => setError(`image: ${reason(e)}`),
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
      } else {
        stopVideo()
        setSourceMode(mode)
        setSourceName('')
        dropFile('a')
        showGenerated(slotA, mode)
      }
    }
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
        slotA.setImage(bmp, bmp.width / bmp.height)
        setSourceMode('file')
        setSourceName(urlName(url))
      }, imageError)
    }
    if (params.iurlb !== null) {
      const url = params.iurlb
      loadImage(url).then(bmp => {
        slotB.setImage(bmp)
        eng.setSourceBEnabled(true)
        setSourceBMode('file')
        setSourceBName(urlName(url))
      }, imageError)
    }
    if (params.vurl !== null) {
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
      Engine.create(canvas).then(
        created => {
          if (disposed) {
            created.destroy()
          } else {
            engineRef.current = created
            setEngine(created)
            window.vf = created
            created.onStats = setStats
            created.onGpuError = m => {
              trace.add('gpuError', m.slice(0, 120))
              trace.flush(true)
              setError(`gpu: ${m}`)
            }
            created.onDeviceLost = m => {
              trace.add('deviceLost', m.slice(0, 120))
              trace.flush(true)
              setFatal({
                title: 'WebGPU device lost',
                body: m === '' ? 'The GPU device was lost.' : m,
                kind: 'lost',
              })
            }
            // Not a lost device: the device never reported anything, it just
            // stopped completing submitted work — so don't title it as one.
            created.onHang = () =>
              setFatal({
                title: 'The GPU stopped responding',
                body: 'Submitted work stopped completing, so the picture would be frozen even though the app is still running.',
                kind: 'hung',
              })
            created.setImageSource(smpteBars())
            created.setImageSourceB(smpteBars())
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
    error,
    stats,
    res,
    renderScale,
    setScale,
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
