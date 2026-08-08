// Circuit-bender's modulation sources: low-frequency oscillators and random
// walks standing in for the hands, LFOs, and photocells benders patch into
// pots. Pure per-frame state advanced at the frame rate; the engine maps the
// returned values onto controls at the uniform boundary, so presets, saved looks,
// and the UI keep the resting value.

import { Lorenz, valueNoise } from './noise'

export type ModSource =
  | 'sine'
  | 'triangle'
  | 'walk'
  | 'smooth'
  | 'hold'
  | 'lorenz'
  | 'level'
  | 'hit'
  | 'trig'

// Sources with no oscillator behind them: the audio followers hand their
// current value straight through, so `rateHz` addresses nothing and the UI
// hides the rate control rather than offering a knob wired to nowhere.
// `trig` keeps its rate — see the envelope below, where the rate is how fast
// the decay runs rather than how often anything repeats.
export const PASS_THROUGH: ReadonlySet<ModSource> = new Set<ModSource>([
  'level',
  'hit',
])

export interface ModWave {
  // Stable identity of the routing this wave belongs to. The caller compacts
  // its slot list before handing it over (an off or zero-depth slot is dropped),
  // so position is NOT identity: keyed by index, enabling slot 1 would hand
  // slot 2's accumulated phase over to it and restart slot 2 from zero — a
  // running LFO visibly jumps, and a Lorenz slot re-enters elsewhere on the
  // attractor.
  id: number
  source: ModSource
  rateHz: number
}

const DT = 1 / 60

// Per-routing oscillator state, continuous across frames.
interface WaveState {
  phase: number
  clock: number // unwrapped cycle count, for the aperiodic sources
  walk: number
  dest: number
  held: number
  lorenz: Lorenz
  // The one-shot envelope's level, 1 at the instant it is fired and decaying
  // from there. Held per routing like every other running quantity, so arming
  // and disarming a slot does not lose an envelope in flight.
  env: number
}

export class ModState {
  // Keyed by ModWave.id, not position. A slot switched off keeps its state, so
  // switching it back on resumes rather than restarting.
  private waveState = new Map<number, WaveState>()

  // Routings whose envelope has been fired and not yet picked up by a frame.
  // A trigger is an edge, and edges do not survive being sampled at 60 Hz: a
  // press between two frames has to still be there when the next one runs, or
  // firing from a button feels like it misses every few presses.
  private fired = new Set<number>()

  // Fire one routing's one-shot. `id` is ModWave.id — the slot's identity, not
  // its position — so a bay reordered between the press and the frame still
  // fires the envelope the finger was aimed at.
  fire(id: number): void {
    this.fired.add(id)
  }

  // Fire every routing that has an envelope on it. The performance gesture: one
  // key, and everything patched to a trigger hits together.
  fireAll(waves: readonly ModWave[]): void {
    for (const w of waves) if (w.source === 'trig') this.fired.add(w.id)
  }

  // One value per wave: LFOs are bipolar [-1, 1] (a hand wiggling around the
  // resting setting), audio followers and the one-shot unipolar [0, 1] (a push
  // off it that comes back).
  update(
    waves: readonly ModWave[],
    level: number,
    hit: number,
    rand: () => number = Math.random,
  ): number[] {
    return waves.map(w => {
      let s = this.waveState.get(w.id)
      if (s === undefined) {
        s = {
          phase: 0,
          clock: 0,
          walk: 0,
          dest: rand() * 2 - 1,
          held: rand() * 2 - 1,
          lorenz: new Lorenz(),
          env: 0,
        }
        this.waveState.set(w.id, s)
      }
      const prev = s.phase
      const ph = (prev + w.rateHz * DT) % 1
      s.phase = ph
      s.clock += w.rateHz * DT
      const wrapped = ph < prev // one source cycle completed this frame
      let v: number
      if (w.source === 'sine') {
        v = Math.sin(2 * Math.PI * ph)
      } else if (w.source === 'triangle') {
        v = 1 - 4 * Math.abs(ph - 0.5)
      } else if (w.source === 'walk') {
        // a new destination once per cycle, slewed toward — the aimless drift
        // of a hand resting on a bend point rather than a periodic wave
        if (wrapped) {
          s.dest = rand() * 2 - 1
        }
        v = s.walk + (s.dest - s.walk) * Math.min(1, 5 * w.rateHz * DT)
        s.walk = v
      } else if (w.source === 'smooth') {
        // interpolated value noise: a gentler, more organic drift than walk
        v = valueNoise(s.clock, w.id)
      } else if (w.source === 'hold') {
        // sample & hold: a fresh random step latched once per cycle, held flat
        if (wrapped) {
          s.held = rand() * 2 - 1
        }
        v = s.held
      } else if (w.source === 'lorenz') {
        // strange-attractor coordinate: aperiodic but structured
        v = s.lorenz.step(w.rateHz * DT)
      } else if (w.source === 'trig') {
        // One-shot envelope: struck to full on a trigger, decaying back to rest
        // on its own. The bay's other seven sources all answer "what is this
        // knob doing" continuously; this is the only one that answers "what did
        // you just do", which is why it is the source a hand plays rather than
        // sets up.
        //
        // Instant attack and exponential decay, so a fired envelope reads as a
        // hit and not a swell — and exponential rather than linear because the
        // tail is what makes several of them at different rates sound like one
        // gesture instead of a set of ramps ending at different times.
        if (this.fired.has(w.id)) {
          this.fired.delete(w.id)
          s.env = 1
        }
        // rateHz is the decay rate: 1 Hz falls to 1/e in a second, so the
        // existing rate slider (and its clock lock) reads as speed here the
        // same way it does everywhere else — faster is shorter.
        s.env = s.env * Math.exp(-Math.max(w.rateHz, 0) * DT)
        // Below this it is inaudible and only costs float traffic; snapping to
        // rest also lets the routing settle exactly on the value the sliders
        // show rather than a hair off it forever.
        if (s.env < 1e-4) s.env = 0
        v = s.env
      } else {
        v = w.source === 'level' ? level : hit
      }
      return v
    })
  }
}
