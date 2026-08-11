import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { offlineWalk, runEffect, runStep } from './stripRun'
import { makeStripRunner } from './useStrip'

import type { Rand } from '../rng'
import type { PoolOrigin } from '../sources/pools'
import type { MutateAmount } from './mutate'
import type { Row, Strip } from './strip'
import type { StripSink } from './stripRun'
import type { SessionParams } from './urlParams'

// A sink that writes down what it was asked for. The whole reason `advance`
// returns effects instead of calling the engine: "row 2 rolled the wrong pool"
// is an assertion here rather than something to notice on screen three minutes
// into a set.
function fakeSink() {
  const sessions: { params: SessionParams; seconds: number }[] = []
  const rolls: { origin: PoolOrigin; rand: Rand }[] = []
  const jitters: { amount: MutateAmount; rand: Rand }[] = []
  const order: string[] = []
  const sink: StripSink = {
    session: (params, seconds) => {
      sessions.push({ params, seconds })
      order.push('session')
    },
    roll: (origin, rand) => {
      rolls.push({ origin, rand })
      order.push('roll')
    },
    jitter: (amount, rand) => {
      jitters.push({ amount, rand })
      order.push('jitter')
    },
  }
  return { sink, sessions, rolls, jitters, order }
}

describe('runEffect', () => {
  it('parses a session on the way through, so a sink never sees a query string', () => {
    const f = fakeSink()
    runEffect(
      { kind: 'session', session: 'set=vSize:0.5&src=sweep', seconds: 4 },
      f.sink,
    )
    expect(f.sessions).toHaveLength(1)
    expect(f.sessions[0].seconds).toBe(4)
    expect(f.sessions[0].params.src).toBe('sweep')
    expect(f.sessions[0].params.controls.vSize).toBe(0.5)
  })

  // It is the real reader, not a lookalike, and that is worth pinning: `bars`
  // is deliberately not a linkable `?src=` (urlParams.ts — it is the default,
  // so it never appears in a link), and a row inherits that rule for free by
  // going through the same parse a link does.
  it('inherits the link contract, including what it refuses', () => {
    const f = fakeSink()
    runEffect({ kind: 'session', session: 'src=bars', seconds: 0 }, f.sink)
    expect(f.sessions[0].params.src).toBeNull()
  })

  // The seam rng.ts exists for: what reaches the sink is a generator, and the
  // same seed makes the same one.
  it('hands a roll a generator built from the seed', () => {
    const a = fakeSink()
    const b = fakeSink()
    runEffect({ kind: 'roll', origin: 'archive', seed: 77 }, a.sink)
    runEffect({ kind: 'roll', origin: 'archive', seed: 77 }, b.sink)
    expect(a.rolls[0].origin).toBe('archive')
    expect(a.rolls[0].rand()).toBe(b.rolls[0].rand())
  })

  it('hands a jitter its amount and a generator', () => {
    const f = fakeSink()
    runEffect({ kind: 'jitter', amount: 'wild', seed: 5 }, f.sink)
    expect(f.jitters[0].amount).toBe('wild')
    expect(typeof f.jitters[0].rand()).toBe('number')
  })
})

describe('runStep', () => {
  // Order is load-bearing: both other fillings are departures *from* what the
  // session named, so a roll landing before the session would be rolled over.
  it('runs the effects in the order the step gives them', () => {
    const f = fakeSink()
    runStep(
      {
        walk: { row: 0, lap: 0, since: 0, frames: 60 },
        effects: [
          { kind: 'session', session: 'src=wiki-random', seconds: 0 },
          { kind: 'roll', origin: 'commons', seed: 1 },
        ],
      },
      f.sink,
    )
    expect(f.order).toEqual(['session', 'roll'])
  })
})

// The driver's own logic, with no DOM anywhere near it — which is the point of
// the runner being a plain object rather than state inside the hook.
describe('makeStripRunner', () => {
  const row = (over: Partial<Row> = {}): Row => ({
    id: 'r1',
    name: '',
    session: 'set=&mod=',
    fill: { kind: 'clip' },
    hold: { bars: 4, drift: 0 },
    arrive: { seconds: 1 },
    ...over,
  })

  // 120bpm at 60fps: a 4-bar hold is 480 frames.
  function harness(rows: Row[], opts: { loop?: boolean } = {}) {
    const runner = makeStripRunner()
    let frame = 0
    const showSession = vi.fn()
    const rollOn = vi.fn()
    const writeControls = vi.fn()
    const ensureTempo = vi.fn()
    const track = { loaded: true, restart: vi.fn(), pause: vi.fn() }
    runner.setDeps({
      showSession,
      rollOn,
      getControls: () => DEFAULT_CONTROLS,
      writeControls,
      mutateSliders: [],
      bpm: 120,
      ensureTempo,
      frameNo: () => frame,
      track,
    })
    const strip: Strip = { rows, seed: 42, loop: opts.loop ?? true }
    runner.setStrip(strip)
    return {
      runner,
      showSession,
      rollOn,
      writeControls,
      ensureTempo,
      track,
      to: (f: number) => {
        frame = f
        runner.tick()
      },
    }
  }

  it('puts a session up when a row fires', () => {
    const h = harness([row()])
    h.runner.start()
    expect(h.showSession).toHaveBeenCalledTimes(1)
    expect(h.showSession.mock.calls[0][1]).toBe(1)
  })

  it('asks for a tempo when a walk starts, not when it is built', () => {
    const h = harness([row()])
    expect(h.ensureTempo).not.toHaveBeenCalled()
    h.runner.start()
    expect(h.ensureTempo).toHaveBeenCalled()
  })

  it('crosses to the next row on the boundary and not before', () => {
    const h = harness([row(), row({ id: 'r2' })])
    h.runner.start()
    h.to(479)
    expect(h.runner.getWalk().row).toBe(0)
    h.to(480)
    expect(h.runner.getWalk().row).toBe(1)
    expect(h.showSession).toHaveBeenCalledTimes(2)
  })

  it('rolls a pool row through the deps, seeded', () => {
    const h = harness([row({ fill: { kind: 'roll', origin: 'commons' } })])
    h.runner.start()
    expect(h.rollOn).toHaveBeenCalledTimes(1)
    expect(h.rollOn.mock.calls[0][0]).toBe('commons')
    expect(typeof h.rollOn.mock.calls[0][1]()).toBe('number')
  })

  it('jitters a jitter row against whatever is live', () => {
    const h = harness([row({ fill: { kind: 'jitter', amount: 'gentle' } })])
    h.runner.start()
    expect(h.writeControls).toHaveBeenCalledTimes(1)
  })

  it('stops, and stays stopped however far the clock runs on', () => {
    const h = harness([row(), row({ id: 'r2' })])
    h.runner.start()
    h.runner.stop()
    h.to(99999)
    expect(h.runner.getWalk().row).toBe(-1)
    expect(h.showSession).toHaveBeenCalledTimes(1)
  })

  it('fires a row by hand without the walk running', () => {
    const h = harness([row(), row({ id: 'r2' })])
    h.runner.fireRow(1)
    expect(h.runner.getWalk().row).toBe(1)
    expect(h.showSession).toHaveBeenCalledTimes(1)
  })

  // The three clocks, as three subscriptions. A progress reader hearing about
  // every frame must not drag the rundown's readers along with it.
  it('tells progress readers every tick and walk readers only at a boundary', () => {
    const h = harness([row(), row({ id: 'r2' })])
    const onWalk = vi.fn()
    const onProgress = vi.fn()
    h.runner.subscribeWalk(onWalk)
    h.runner.subscribeProgress(onProgress)
    h.runner.start()
    onWalk.mockClear()
    for (let f = 1; f <= 300; f++) h.to(f)
    expect(onProgress).toHaveBeenCalledTimes(300)
    expect(onWalk).not.toHaveBeenCalled()
    h.to(480)
    expect(onWalk).toHaveBeenCalledTimes(1)
  })

  it('reports progress across the hold', () => {
    const h = harness([row()])
    h.runner.start()
    h.to(240)
    expect(h.runner.getProgress()).toBeCloseTo(0.5)
  })

  it('has no progress to report while stopped', () => {
    const h = harness([row()])
    expect(h.runner.getProgress()).toBeNull()
  })

  // A runner with nothing wired to it is what exists between mount and the
  // first effect. It must not throw — a tray that rendered before the engine
  // did would take the app down with it.
  it('survives being driven before anything is wired to it', () => {
    const runner = makeStripRunner()
    runner.setStrip({ rows: [row()], seed: 1, loop: true })
    expect(() => {
      runner.start()
      runner.tick()
      runner.fireRow(0)
      runner.stop()
    }).not.toThrow()
  })

  it('tells the strip readers when the rundown is edited', () => {
    const h = harness([row()])
    const onStrip = vi.fn()
    h.runner.subscribeStrip(onStrip)
    h.runner.setStrip({ ...h.runner.getStrip(), loop: false })
    expect(onStrip).toHaveBeenCalledTimes(1)
    expect(h.runner.getStrip().loop).toBe(false)
  })

  // One sentence, and these are it: **the track runs while the walk runs.**
  // The whole of what "cut to music" is at this stage — the two locked at frame
  // zero, and a tempo that is right keeping them together from there.
  describe('the music', () => {
    it('takes the track from the top when the walk starts', () => {
      const h = harness([row()])
      h.runner.start()
      expect(h.track.restart).toHaveBeenCalledTimes(1)
    })

    it('pauses it when the walk stops', () => {
      const h = harness([row()])
      h.runner.start()
      h.runner.stop()
      expect(h.track.pause).toHaveBeenCalled()
    })

    // A rundown that runs off its own end is the other way a walk ends, and it
    // has to mean the same thing as pressing stop.
    it('pauses it when a strip that does not loop runs out', () => {
      const h = harness([row()], { loop: false })
      h.runner.start()
      h.track.pause.mockClear()
      h.to(480)
      expect(h.runner.getWalk().row).toBe(-1)
      expect(h.track.pause).toHaveBeenCalled()
    })

    // A hand reaching into a running take is not the take restarting. Hauling
    // the song back to zero under it is the one thing nobody wants mid-set.
    it('leaves the track alone when a row is fired by hand', () => {
      const h = harness([row(), row({ id: 'r2' })])
      h.runner.start()
      h.track.restart.mockClear()
      h.track.pause.mockClear()
      h.runner.fireRow(1)
      expect(h.track.restart).not.toHaveBeenCalled()
      expect(h.track.pause).not.toHaveBeenCalled()
    })

    it('leaves it alone as the walk crosses a row boundary', () => {
      const h = harness([row(), row({ id: 'r2' })])
      h.runner.start()
      h.track.restart.mockClear()
      h.to(480)
      expect(h.runner.getWalk().row).toBe(1)
      expect(h.track.restart).not.toHaveBeenCalled()
    })
  })

  // Undo is what makes an editor safe to poke at: a mis-clicked ✕ on a row you
  // spent five minutes dialling in is otherwise unrecoverable.
  describe('the rundown walk', () => {
    it('has nothing to step back into on a fresh rundown', () => {
      const runner = makeStripRunner()
      expect(runner.getDepth().undo).toBe(false)
      expect(runner.getDepth().redo).toBe(false)
    })

    // `harness` seeds its rundown through `setStrip`, which is the same funnel
    // every edit goes through — so the seed is itself one step back, and these
    // measure from it rather than from an empty walk. That is the funnel doing
    // its job: there is no way to change the rundown that undo does not see.
    it('takes back an edit, and puts it back again', () => {
      const h = harness([row({ id: 'a' }), row({ id: 'b' })])
      const base = h.runner.getStrip()
      h.runner.setStrip({ ...base, rows: [row({ id: 'a' })] })
      expect(h.runner.getStrip().rows).toHaveLength(1)

      expect(h.runner.getDepth().undo).toBe(true)
      h.runner.undo()
      expect(h.runner.getStrip()).toEqual(base)

      expect(h.runner.getDepth().redo).toBe(true)
      h.runner.redo()
      expect(h.runner.getStrip().rows).toHaveLength(1)
    })

    // One press has to come back in one press. Banking inside undo as well as
    // inside the edit is how that turns into two.
    it('does not bank the step it is undoing', () => {
      const h = harness([row({ id: 'a' })])
      const base = h.runner.getStrip()
      h.runner.setStrip({ ...base, loop: false })
      h.runner.undo()
      expect(h.runner.getStrip()).toEqual(base)
    })

    it('walks back through several edits in order', () => {
      const h = harness([row({ id: 'a' })])
      for (const name of ['one', 'two', 'three']) {
        const s = h.runner.getStrip()
        h.runner.setStrip({ ...s, rows: [{ ...s.rows[0], name }] })
      }
      const seen: string[] = []
      for (let i = 0; i < 3; i++) {
        h.runner.undo()
        seen.push(h.runner.getStrip().rows[0].name)
      }
      expect(seen).toEqual(['two', 'one', ''])
    })

    it('tells the readers, so the cards come back with it', () => {
      const h = harness([row({ id: 'a' })])
      const onStrip = vi.fn()
      h.runner.setStrip({ ...h.runner.getStrip(), loop: false })
      h.runner.subscribeStrip(onStrip)
      h.runner.undo()
      expect(onStrip).toHaveBeenCalled()
    })

    // A new edit after stepping back is a new branch: the redo tail belonged to
    // a walk that edit leaves.
    it('drops the redo tail when a step back is followed by an edit', () => {
      const h = harness([row({ id: 'a' })])
      h.runner.setStrip({ ...h.runner.getStrip(), loop: false })
      h.runner.undo()
      expect(h.runner.getDepth().redo).toBe(true)
      h.runner.setStrip({ ...h.runner.getStrip(), seed: 7 })
      expect(h.runner.getDepth().redo).toBe(false)
    })
  })

  it('drops a subscriber that unsubscribes', () => {
    const h = harness([row()])
    const onProgress = vi.fn()
    const off = h.runner.subscribeProgress(onProgress)
    h.runner.start()
    off()
    h.to(10)
    expect(onProgress).not.toHaveBeenCalled()
  })

  // A render takes the walk away from the tray rather than running beside it
  // (app.tsx stops it), and the offline walk keeps its own place — so a take
  // begun mid-set starts from the top and leaves the set where it was.
  it('is not moved by an offline walk over the same rundown', () => {
    const h = harness([row({ hold: { bars: 1, drift: 0 } })])
    h.runner.start()
    h.to(200)
    const live = h.runner.getWalk()
    const f = fakeSink()
    const step = offlineWalk(h.runner.getStrip(), f.sink, { bpm: 120, fps: 60 })
    step(0)
    step(120)
    expect(f.order).toHaveLength(2)
    expect(h.runner.getWalk()).toEqual(live)
  })
})

// The offline half of _One walk, two clocks_ (docs/EDITOR.md). The same
// `advance` and the same `runStep` as the live driver above — what differs is
// only who moves the frame — so what is worth testing is that the boundaries
// land where the rundown says, and that two walks of one rundown agree.
describe('offlineWalk', () => {
  const row = (over: Partial<Row> = {}): Row => ({
    id: 'r1',
    name: '',
    session: 'set=&mod=',
    fill: { kind: 'clip' },
    hold: { bars: 4, drift: 0 },
    arrive: { seconds: 1 },
    ...over,
  })

  // 120bpm at 60fps: a 1-bar hold is 120 frames.
  const TEMPO = { bpm: 120, fps: 60 }
  const stripOf = (rows: Row[], over: Partial<Strip> = {}): Strip => ({
    rows,
    seed: 42,
    loop: true,
    ...over,
  })

  // Drive `n` frames and hand back what the sink was asked for, and on which
  // frames — which is the whole of what this driver decides.
  const walkFrames = (strip: Strip, n: number) => {
    const f = fakeSink()
    const step = offlineWalk(strip, f.sink, TEMPO)
    const at: number[] = []
    for (let i = 0; i < n; i++) {
      const before = f.order.length
      step(i)
      if (f.order.length > before) at.push(i)
    }
    return { ...f, at }
  }

  it('starts the rundown on frame zero rather than waiting for a boundary', () => {
    const w = walkFrames(stripOf([row(), row({ id: 'r2' })]), 5)
    expect(w.at).toEqual([0])
    expect(w.sessions).toHaveLength(1)
  })

  it('cuts on the frame the hold is up, not a frame either side', () => {
    const w = walkFrames(
      stripOf([
        row({ hold: { bars: 1, drift: 0 } }),
        row({ id: 'r2', hold: { bars: 1, drift: 0 } }),
      ]),
      300,
    )
    expect(w.at).toEqual([0, 120, 240])
  })

  it('comes back round on a looping rundown, and stops on one with an end', () => {
    const rows = [row({ hold: { bars: 1, drift: 0 } })]
    expect(walkFrames(stripOf(rows), 400).at).toEqual([0, 120, 240, 360])
    expect(walkFrames(stripOf(rows, { loop: false }), 400).at).toEqual([0])
  })

  // The point of the seed, and of this test: a rundown whose rows roll is a
  // different video every time unless the draws come from somewhere a record
  // can point at (docs/adr/0006). Two offline walks of one rundown ask the same
  // questions, in the same order, on the same frames.
  it('asks the same questions twice, rolls and drifted holds included', () => {
    const rows = [
      row({
        hold: { bars: 1, drift: 0.4 },
        fill: { kind: 'roll', origin: 'commons' },
      }),
      row({
        id: 'r2',
        hold: { bars: 1, drift: 0.4 },
        fill: { kind: 'jitter', amount: 'normal' },
      }),
    ]
    const a = walkFrames(stripOf(rows), 600)
    const b = walkFrames(stripOf(rows), 600)
    expect(a.at).toEqual(b.at)
    expect(a.order).toEqual(b.order)
    // Not merely the same *pools* — the same numbers out of them, which is what
    // a recorded seed has to buy.
    expect(a.rolls.map(r => r.rand())).toEqual(b.rolls.map(r => r.rand()))
    expect(a.jitters.map(j => j.rand())).toEqual(b.jitters.map(j => j.rand()))
  })

  it('and different ones from a different seed, which is what ⟳ is for', () => {
    const rows = [
      row({
        hold: { bars: 1, drift: 0.4 },
        fill: { kind: 'roll', origin: 'commons' },
      }),
    ]
    const a = walkFrames(stripOf(rows, { seed: 1 }), 600)
    const b = walkFrames(stripOf(rows, { seed: 2 }), 600)
    expect(a.rolls.map(r => r.rand())).not.toEqual(b.rolls.map(r => r.rand()))
  })

  // An empty tray is not an error, and the render leans on it: pressing ⎙ with
  // no rundown is a take of whatever is on the board.
  it('does nothing at all for an empty rundown', () => {
    expect(walkFrames(stripOf([]), 600).order).toEqual([])
  })
})
