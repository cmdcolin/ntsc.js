import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The recorder is a module singleton that snapshots the store once, which is
// the behaviour under test: a session must not be able to read itself back as
// its own predecessor. So each test gets a fresh module instance.
async function load(seed: string | null = null, onWrite?: (v: string) => void) {
  const cell = { value: seed }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k === 'ntsc.trace' ? cell.value : counters[k]),
    setItem: (k: string, v: string) => {
      if (k === 'ntsc.trace') {
        onWrite?.(v)
        cell.value = v
      } else counters[k] = v
    },
    removeItem: (k: string) => {
      if (k === 'ntsc.trace') cell.value = null
      else delete counters[k]
    },
  })
  vi.stubGlobal('navigator', { userAgent: 'test' })
  vi.resetModules()
  return { mod: await import('./trace'), stored: () => cell.value }
}

let counters: Record<string, string | undefined> = {}

const session = (at: number, ...lines: string[]) => ({ at, ua: 'old', lines })

describe('trace', () => {
  beforeEach(() => {
    counters = {}
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the sessions before this one, newest last', async () => {
    const seed = JSON.stringify([session(1, 'a|x|'), session(2, 'b|y|')])
    const { mod } = await load(seed)
    expect(mod.trace.history().map(s => s.at)).toEqual([1, 2])
    expect(mod.previousTrace()?.at).toBe(2)
  })

  it('adopts a single session written by the one-slot version', async () => {
    // Otherwise upgrading the app throws away the recording of the freeze the
    // user is upgrading to diagnose.
    const { mod } = await load(JSON.stringify(session(7, 'a|stall|')))
    expect(mod.previousTrace()?.at).toBe(7)
  })

  it('never reads itself back as its own predecessor', async () => {
    // The single-slot bug in miniature: the act of recording must not become
    // the act of overwriting the evidence.
    const { mod } = await load(JSON.stringify([session(1, 'a|x|')]))
    mod.trace.add('stall', 'here')
    mod.trace.flush(true)
    expect(mod.trace.history().map(s => s.at)).toEqual([1])
    expect(mod.previousTrace()?.at).toBe(1)
  })

  it('appends this session to the stored history', async () => {
    const { mod, stored } = await load(JSON.stringify([session(1, 'a|x|')]))
    mod.trace.add('stall', 'here')
    mod.trace.flush(true)
    const written: { lines: string[] }[] = JSON.parse(stored() ?? '[]')
    expect(written).toHaveLength(2)
    expect(written[1]?.lines.some(l => l.includes('|stall|here'))).toBe(true)
  })

  it('caps the history, dropping the oldest', async () => {
    const seed = JSON.stringify([1, 2, 3, 4, 5].map(n => session(n)))
    const { mod, stored } = await load(seed)
    mod.trace.add('stall')
    mod.trace.flush(true)
    const written: { at: number }[] = JSON.parse(stored() ?? '[]')
    expect(written).toHaveLength(5)
    // The oldest went; the four most recent past sessions and this one remain.
    expect(written.slice(0, 4).map(s => s.at)).toEqual([2, 3, 4, 5])
  })

  it('falls back to writing this session alone when the store is full', async () => {
    // A full store must not cost the recording being made right now — that is
    // the one a freeze in progress depends on.
    let first = true
    const seed = JSON.stringify([session(1, 'a|x|')])
    const { mod, stored } = await load(seed, () => {
      if (first) {
        first = false
        throw new DOMException('quota', 'QuotaExceededError')
      }
    })
    mod.trace.add('stall', 'here')
    mod.trace.flush(true)
    const written: { lines: string[] }[] = JSON.parse(stored() ?? '[]')
    expect(written).toHaveLength(1)
    expect(written[0]?.lines.some(l => l.includes('|stall|here'))).toBe(true)
  })

  it('survives a corrupt store rather than losing the session', async () => {
    const { mod } = await load('not json')
    expect(mod.trace.history()).toEqual([])
    expect(mod.previousTrace()).toBeNull()
  })

  describe('frameless-start run', () => {
    it('counts consecutive sessions that never saw a frame', async () => {
      const { mod } = await load()
      expect(mod.framelessStarts()).toBe(0)
      expect(mod.recordFramelessStart()).toBe(1)
      expect(mod.recordFramelessStart()).toBe(2)
      expect(mod.framelessStarts()).toBe(2)
    })

    it('is ended by a session that gets a frame', async () => {
      const { mod } = await load()
      mod.recordFramelessStart()
      mod.clearFramelessStarts()
      expect(mod.framelessStarts()).toBe(0)
    })

    it('reads a junk count as no run at all', async () => {
      const { mod } = await load()
      counters['ntsc.frameless'] = 'banana'
      expect(mod.framelessStarts()).toBe(0)
    })
  })
})
