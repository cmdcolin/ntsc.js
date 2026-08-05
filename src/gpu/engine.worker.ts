// An engine that owns its GPUDevice, presents to an OffscreenCanvas, and is
// driven by this worker's own requestAnimationFrame.
//
// What that buys, measured on Firefox Nightly with the real signal path under a
// main-thread load of 20 ms every 50 ms: a locked 60 fps with no frame gap over
// 33 ms, against 42.6 fps, a p99 gap of 90 ms and stalls past 100 ms for the
// same engine on the main thread. The engine is not faster here — it is simply
// no longer queueing behind React, layout, and whatever else the page is doing.
//
// The page keeps everything a worker cannot have: the <video> elements (see
// VideoPump), the AudioContext, and the DOM. What crosses is bitmaps and
// scalars, so this file has no idea any of that exists.

import { setPageSearch } from './env'
import { Engine } from './pipeline'

import type { FromWorker, ToWorker } from './workerproto'

let engine: Engine | null = null
// Kept for rebuilds — see the 'rebuild' message.
let target: OffscreenCanvas | null = null
let search = ''

const post = (m: FromWorker): void => {
  postMessage(m)
}

// Ownership of a transferred bitmap ends here, so every path that receives one
// has to close it. Sources closes the ones it copies; this covers the rest —
// anything that arrives after teardown, which is otherwise a decoded frame's
// worth of memory leaked per message.
const drop = (bmp: ImageBitmap): void => {
  bmp.close()
}

async function build(
  canvas: OffscreenCanvas,
  pageQuery: string,
): Promise<boolean> {
  // Before the engine is built: `?dbg=`, `?gpu=` and `?debug` are read during
  // construction, and this worker cannot read them for itself.
  target = canvas
  search = pageQuery
  setPageSearch(pageQuery)
  try {
    const e = await Engine.create(canvas)
    e.onStats = stats => {
      post({ t: 'stats', stats })
    }
    e.onDeviceLost = message => {
      post({ t: 'deviceLost', message })
    }
    e.onHang = () => {
      post({ t: 'hang' })
    }
    e.onFrozen = frozen => {
      post({ t: 'frozen', frozen })
    }
    e.onGpuError = message => {
      post({ t: 'gpuError', message })
    }
    // Reconciliation only — the page renders from its own snapshot rather than
    // waiting for this to come back. See workerproto.
    e.subscribeControls(() => {
      post({ t: 'controls', controls: e.getControls() })
    })
    engine = e
    return true
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    return false
  }
}

let lastError = ''

// A lost device, answered in place. The predecessor is torn down first so its
// GPU resources go, but the canvas it was presenting to is reused — that is the
// one thing a rebuild cannot replace.
async function rebuild(): Promise<void> {
  const dead = engine
  engine = null
  dead?.destroy()
  const ok = target !== null && (await build(target, search))
  post({ t: 'rebuilt', ok, message: ok ? '' : lastError })
}

onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  if (m.t === 'init') {
    void build(m.canvas, m.search).then(ok => {
      post(ok ? { t: 'ready' } : { t: 'initFailed', message: lastError })
    })
    return
  }
  if (m.t === 'rebuild') {
    void rebuild()
    return
  }
  const e = engine
  if (e === null) {
    // Destroyed, or a message that raced construction. Bitmaps still have to be
    // released; nothing else here has an effect worth reporting.
    if (m.t === 'imageA' || m.t === 'imageB') drop(m.bmp)
    if (m.t === 'frameA' || m.t === 'frameB') drop(m.bmp)
    if (m.t === 'step') post({ t: 'stepped', id: m.id })
    if (m.t === 'frameNo') post({ t: 'frameNo', id: m.id, frame: 0 })
    return
  }
  switch (m.t) {
    case 'control':
      e.setControl(m.key, m.value)
      break
    case 'applyControls':
      e.applyControls(m.patch)
      break
    case 'preview':
      e.preview(m.controls)
      break
    case 'modSlots':
      e.setModSlots(m.slots)
      break
    case 'dbgView':
      e.setDbgView(m.view)
      break
    case 'sourceBEnabled':
      e.setSourceBEnabled(m.on)
      break
    case 'imageA':
      e.setImageSource(m.bmp, m.aspect)
      drop(m.bmp)
      break
    case 'imageB':
      e.setImageSourceB(m.bmp)
      drop(m.bmp)
      break
    case 'noiseA':
      e.setNoiseSource(m.kind)
      break
    case 'noiseB':
      e.setNoiseSourceB(m.kind)
      break
    case 'frameA':
      e.pushFrameA({ bmp: m.bmp, ...m.geom })
      break
    case 'frameB':
      e.pushFrameB({ bmp: m.bmp, ...m.geom })
      break
    case 'step':
      e.step()
      post({ t: 'stepped', id: m.id })
      break
    case 'kick':
      e.kick()
      break
    case 'frameNo':
      post({ t: 'frameNo', id: m.id, frame: e.frameNo() })
      break
    case 'destroy':
      engine = null
      target = null
      e.destroy()
      // Shut this thread down from the inside, rather than waiting to be
      // terminated. The page cannot post `destroy` and call terminate() in the
      // same turn — terminate discards the queue instead of draining it, so the
      // device.destroy() above would never run — which leaves closing ourselves
      // as the only way the release is guaranteed to happen before the thread
      // goes. The page's terminate() is a backstop behind this.
      close()
      break
  }
}
