// Circuit-bender's modulation sources: low-frequency oscillators and random
// walks standing in for the hands, LFOs, and photocells benders patch into
// pots. Pure per-frame state advanced at the frame rate; the engine maps the
// returned values onto controls at the uniform boundary, so presets, scenes,
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
}

export class ModState {
  // Keyed by ModWave.id, not position. A slot switched off keeps its state, so
  // switching it back on resumes rather than restarting.
  private waveState = new Map<number, WaveState>()

  // One value per wave: LFOs are bipolar [-1, 1] (a hand wiggling around the
  // resting setting), audio followers unipolar [0, 1] (a push off it).
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
      } else {
        v = w.source === 'level' ? level : hit
      }
      return v
    })
  }
}
