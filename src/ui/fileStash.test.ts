// The reload switch, which is the one thing about the stash that is a decision
// rather than a mechanism: whether a refresh puts each deck back on the clip it
// was holding.
//
// Two things are pinned. **Absent means yes** — the app has always come back on
// last session's source, so a build that shipped this switch defaulting the
// other way would look, to everyone who has never opened it, exactly like a
// regression. And **switching it off must not clear the stash**, which is what
// makes "off" a preference rather than a one-way door; that half is the boot
// path in useEngine, so it is read out of the source the way slotView.test does.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { REOPEN_KEY, reopensOnLoad } from './fileStash'
import { writeString } from './storage'

import { readFileSync } from 'node:fs'

describe('the reload switch', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('reopens last session by default', () => {
    expect(reopensOnLoad()).toBe(true)
  })

  it('reads the two spellings the toggle writes', () => {
    writeString(REOPEN_KEY, '0')
    expect(reopensOnLoad()).toBe(false)
    writeString(REOPEN_KEY, '1')
    expect(reopensOnLoad()).toBe(true)
  })

  // `dropFile` is the call that clears a slot's stash. It belongs to the branch
  // a *link* takes — a link naming its own source replaces what was stashed —
  // and must not creep into the branch this switch guards, where the whole point
  // is that turning the switch back on finds last session's clips still there.
  it('leaves the stash alone when it is off', () => {
    const boot = readFileSync('src/ui/useEngine.ts', 'utf8')
    const start = boot.indexOf('const reopen = reopensOnLoad()')
    expect(
      start,
      'useEngine no longer reads the switch at boot',
    ).toBeGreaterThan(-1)
    const branch = boot.slice(start, boot.indexOf('debugLog', start))

    expect(branch).toContain('else if (reopen) reopenStashed')
    expect(branch.match(/dropFile/g)).toHaveLength(2)
    expect(branch).not.toContain('!reopen')
  })
})
