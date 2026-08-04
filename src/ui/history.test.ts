import { describe, expect, it } from 'vitest'

import {
  EMPTY_HISTORY,
  HISTORY_MAX,
  record,
  stepBack,
  stepForward,
} from './history'

import type { History } from './history'

const same = (a: number, b: number) => a === b
const of = (past: number[], future: number[] = []): History<number> => ({
  past,
  future,
})
// A step the test asserts happened, unwrapped — so the walk reads as a walk
// rather than as a chain of non-null assertions.
function must<T>(step: T | null): T {
  if (step === null) throw new Error('expected a step, got none')
  return step
}

describe('history', () => {
  it('walks back and forward over a run of writes', () => {
    // Values are the look before each write: 1 -> 2 -> 3, live state 4.
    let h: History<number> = EMPTY_HISTORY
    for (const prev of [1, 2, 3]) h = record(h, prev, same)

    const back1 = must(stepBack(h, 4))
    expect(back1.value).toBe(3)
    const back2 = must(stepBack(back1.history, 3))
    expect(back2.value).toBe(2)
    const fwd = must(stepForward(back2.history, 2))
    expect(fwd.value).toBe(3)
    expect(must(stepForward(fwd.history, 3)).value).toBe(4)
  })

  it('reports nothing to do at either end', () => {
    expect(stepBack(EMPTY_HISTORY, 1)).toBeNull()
    expect(stepForward(EMPTY_HISTORY, 1)).toBeNull()
  })

  it('collapses a repeated snapshot of the same look', () => {
    // A preset drag snapshots on pointer down and again on apply; two entries
    // would make the first undo look like it did nothing.
    const h = record(record(EMPTY_HISTORY, 1, same), 1, same)
    expect(h.past).toEqual([1])
  })

  it('drops the redo tail once the walk branches', () => {
    const h = record(of([1, 2], [9]), 3, same)
    expect(h.future).toEqual([])
    expect(h.past).toEqual([1, 2, 3])
  })

  it('drops the redo tail even when the write repeats the top entry', () => {
    // The dedupe must not smuggle a stale forward path past a real write.
    const h = record(of([1, 2], [9]), 2, same)
    expect(h).toEqual(of([1, 2], []))
  })

  it('caps the walk, dropping the oldest steps', () => {
    let h: History<number> = EMPTY_HISTORY
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = record(h, i, same)
    expect(h.past.length).toBe(HISTORY_MAX)
    expect(h.past[0]).toBe(5)
  })

  it('caps the walk when stepping forward too', () => {
    const past = Array.from({ length: HISTORY_MAX }, (_, i) => i)
    const out = must(stepForward(of(past, [99]), 50))
    expect(out.history.past.length).toBe(HISTORY_MAX)
    expect(out.history.past.at(-1)).toBe(50)
  })
})
