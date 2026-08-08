import { describe, expect, it } from 'vitest'

import { StabGate } from './stab'

// Dirty frames per cycle, for the two tests that compare trains of different
// lengths against each other.
const perCycle = (steps: { clean: boolean }[], cycles: number) =>
  steps.filter(s => !s.clean).length / cycles

// How many stabs started: the leading edge of each one, skipping frame 0 (which
// counts as an edge only because the gate starts out running the look).
const stabs = (steps: { clean: boolean; changed: boolean }[]) =>
  steps.filter((s, i) => s.changed && !s.clean && i > 0).length

// Sampling the gate the way the render loop does: one call per frame, at a fixed
// frame interval, from a wall clock that starts wherever.
const run = (
  gate: StabGate,
  plan: { hz: number; ms: number },
  frames: number,
  frameMs = 1000 / 60,
  startMs = 0,
) =>
  Array.from({ length: frames }, (_, i) =>
    gate.step(plan, startMs + i * frameMs),
  )

describe('StabGate', () => {
  it('runs the look continuously when the rate is off', () => {
    const steps = run(new StabGate(), { hz: 0, ms: 60 }, 120)
    expect(steps.every(s => !s.clean)).toBe(true)
    // Nothing changes, so nothing downstream is ever asked to rebuild.
    expect(steps.filter(s => s.changed).length).toBe(0)
  })

  it('holds the picture clean between stabs', () => {
    // 2Hz, 60ms: a 500ms cycle with ~4 frames of look and ~26 of stock.
    const steps = run(new StabGate(), { hz: 2, ms: 60 }, 120)
    const dirty = steps.filter(s => !s.clean).length
    expect(dirty).toBeGreaterThan(0)
    // The clean side is the resting state — that is what makes it a stab rather
    // than a gate on the look.
    expect(dirty).toBeLessThan(steps.length / 3)
  })

  it('lands one stab per cycle even when the stab is shorter than a frame', () => {
    // 4ms at 60fps: `now % period < ms` is false on almost every frame, so
    // without the per-cycle guarantee most hits would silently never render.
    const steps = run(new StabGate(), { hz: 2, ms: 4 }, 120)
    const dirty = steps.filter(s => !s.clean).length
    // 120 frames at 60fps is 2s, which is 4 cycles at 2Hz.
    expect(dirty).toBe(4)
  })

  it('keeps the stab the same length when the rate changes', () => {
    // The reason the length is milliseconds and not a duty cycle: doubling the
    // rate must not halve the hit.
    const slow = run(new StabGate(), { hz: 2, ms: 100 }, 600, 1000 / 60)
    const fast = run(new StabGate(), { hz: 4, ms: 100 }, 600, 1000 / 60)
    // 10s of frames: 20 cycles at 2Hz, 40 at 4Hz.
    expect(perCycle(slow, 20)).toBeCloseTo(perCycle(fast, 40), 0)
  })

  it('flags exactly two edges per cycle, and nothing in between', () => {
    // What the engine keys its filter-bank rebuild off. Two per cycle is the same
    // budget a morph already spends; one per frame is the feature landing in the
    // wrong place.
    const steps = run(new StabGate(), { hz: 2, ms: 60 }, 600)
    const edges = steps.filter(s => s.changed).length
    // 10s at 2Hz is 20 cycles; the first frame counts as an edge only if it
    // differs from the gate's initial state (which is "look running").
    expect(edges).toBeGreaterThanOrEqual(38)
    expect(edges).toBeLessThanOrEqual(41)
  })

  it('runs at the asked-for rate whatever the frame rate is', () => {
    // The bug this exists to not have: ModState advances on a fixed 1/60, so its
    // 2Hz is 1Hz on a 30fps machine. A gate read against the wall clock is not.
    const at60 = run(new StabGate(), { hz: 2, ms: 60 }, 120, 1000 / 60)
    const at30 = run(new StabGate(), { hz: 2, ms: 60 }, 60, 1000 / 30)
    // Both cover 2s, so both see the same number of stabs — at half the frames.
    expect(stabs(at60)).toBe(stabs(at30))
  })

  it('does not restart the train when the length is dialed mid-run', () => {
    const gate = new StabGate()
    run(gate, { hz: 2, ms: 60 }, 30)
    // A change of plan is read fresh every frame and the phase is the clock's,
    // so there is no state to reset and nothing jumps: the next stab lands where
    // the rate says it should, not one period after the knob moved.
    const after = gate.step({ hz: 2, ms: 200 }, 30 * (1000 / 60))
    expect(after.clean).toBe(false)
  })

  it('starts a fresh train after being switched off and on', () => {
    const gate = new StabGate()
    run(gate, { hz: 2, ms: 60 }, 30)
    gate.step({ hz: 0, ms: 60 }, 600)
    // Back on: the first frame is a stab, rather than resuming a cycle count
    // from before the gate was parked.
    expect(gate.step({ hz: 2, ms: 60 }, 700).clean).toBe(false)
  })

  it('never goes clean when the stab is as long as the cycle', () => {
    // ms >= period is the other way to say off, and it has to read as off rather
    // than as a gate that flickers on rounding.
    const steps = run(new StabGate(), { hz: 2, ms: 500 }, 240)
    expect(steps.every(s => !s.clean)).toBe(true)
  })
})
