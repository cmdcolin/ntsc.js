// Audio-thread half of the intercarrier buzz tap (see signal/buzz.ts). Plain
// JS and no imports, because an AudioWorklet module is fetched and evaluated by
// the audio thread rather than bundled with the app.
//
// The whole job here is rate reconciliation. The render loop produces one
// sample per scan line whenever it happens to render a frame — nominally
// 31.5 kHz, in practice whatever rAF and the GPU readback gave us this second —
// while the audio thread consumes at the context's fixed rate. A ring buffer
// with a fractional read pointer bridges the two, and a slow servo on the read
// rate keeps the fill near target so the stream neither drifts into a growing
// delay nor runs dry.
//
// Neither failure is allowed to click. Overrun re-seats the read pointer at the
// target depth; underrun coasts the last sample toward zero, because a dropped
// frame is a thing the listener should not be able to hear as an event.

const RING = 16384
// ~3 frames of 525 lines: enough that a late GPU readback is invisible, short
// enough that the buzz stays glued to the picture that caused it.
const TARGET = 1600
// Line rate at 60 fps, the servo's starting guess. It converges from anywhere
// in range, so a run at some other frame rate settles on that rate's pitch —
// which is the honest answer, since a frame here is a field of simulated time.
const NOMINAL_HZ = 525 * 60

class BuzzProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ring = new Float32Array(RING)
    // Absolute counts, never wrapped: a double indexes this stream exactly for
    // longer than any tab lives, and the modulo happens at the array only.
    this.write = 0
    this.read = 0
    this.base = NOMINAL_HZ / sampleRate
    this.last = 0
    this.port.addEventListener('message', e => {
      const s = e.data.samples
      for (let i = 0; i < s.length; i++) {
        this.ring[(this.write + i) % RING] = s[i]
      }
      this.write += s.length
    })
    // addEventListener leaves a MessagePort closed; only the onmessage setter
    // starts one implicitly.
    this.port.start()
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    let avail = this.write - this.read
    if (avail > RING - 2048) {
      this.read = this.write - TARGET
      avail = TARGET
    }
    // Proportional term for the immediate correction, integral for the standing
    // error — the difference between the nominal rate and the one the render
    // loop actually sustains. Both bounded: the integrator cannot wind the
    // pitch away, and a ±2% proportional swing is inaudible on a rasp.
    const err = Math.max(-1, Math.min(1, (avail - TARGET) / TARGET))
    this.base = Math.min(2, Math.max(0.2, this.base + 1e-4 * err))
    const rate = this.base * (1 + 0.02 * err)
    for (let i = 0; i < out.length; i++) {
      if (this.write - this.read > 1) {
        const j = Math.floor(this.read)
        const a = this.ring[j % RING]
        const b = this.ring[(j + 1) % RING]
        this.last = a + (b - a) * (this.read - j)
        this.read += rate
      } else {
        this.last *= 0.999
      }
      out[i] = this.last
    }
    return true
  }
}

registerProcessor('buzz', BuzzProcessor)
