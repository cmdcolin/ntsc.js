// The keyboard is shared with the browser, and this is the seam where that goes
// wrong. Every gesture here is a bare letter or a digit, and the browser has its
// own reading of most of those chords once Ctrl or Cmd is down: ⌘F is find, ⌘C
// is copy, ⌘1 picks a tab.
//
// The rule used to be written per branch — `r`, `i` and `o` each carried their
// own `!ctrlKey && !metaKey`, and `f`, `c` and the digits were each missed. So
// ⌘F went fullscreen behind the find bar, copying text out of the panel flashed
// the stage to stock (and on macOS could stick, since a keyup with Cmd held is
// not reliably delivered), and ⌘1 recalled a saved look on the way to a tab.
// Nothing failed when that happened, which is why it lasted: the whole rule
// lived inside an effect nothing could call.

import { describe, expect, it } from 'vitest'

import { resolveShortcut } from './useShortcuts'

import type { Keystroke } from './useShortcuts'

// A keystroke with nothing held. `code` is derived so the digit cases can be
// written as `press('1')` — the resolver reads digits off `code`, deliberately,
// so that shift+1 is slot 1 and not `!`.
const press = (key: string, over: Partial<Keystroke> = {}): Keystroke => ({
  key,
  code: /^[1-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  typing: false,
  ...over,
})

// Every bare-key gesture the app binds, with what it should do untouched.
const BARE: [string, string][] = [
  ['f', 'fullscreen'],
  ['c', 'compare'],
  ['r', 'record'],
  ['s', 'still'],
  ['i', 'tapCue'],
  ['o', 'retrigger'],
  ['t', 'fire'],
  ['1', 'recallSlot'],
  ['9', 'recallSlot'],
]

describe('what a keystroke means', () => {
  it('answers every bare gesture', () => {
    for (const [key, want] of BARE) {
      expect(resolveShortcut(press(key))?.do).toBe(want)
    }
  })

  // The regression. Asserted as "the bare meaning does not survive" rather than
  // "nothing happens", because ⌘S is a real binding of its own — that is the
  // whole reason the bare-`s` still grab had to learn about modifiers first.
  // Both spellings, since Ctrl is Linux/Windows and Cmd is macOS, and the bug
  // only ever showed on whichever one the author was not using.
  it('never lets a bare gesture answer to Ctrl or Cmd', () => {
    for (const [key, bare] of BARE) {
      expect(resolveShortcut(press(key, { ctrlKey: true }))?.do).not.toBe(bare)
      expect(resolveShortcut(press(key, { metaKey: true }))?.do).not.toBe(bare)
    }
  })

  // The specific chords the bug handed to the app. Each of these has a browser
  // meaning the app must not also act on.
  it('gives ⌘F, ⌘C and ⌘1 back to the browser entirely', () => {
    for (const held of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(resolveShortcut(press('f', held))).toBeNull()
      expect(resolveShortcut(press('c', held))).toBeNull()
      expect(resolveShortcut(press('1', held))).toBeNull()
    }
  })

  it('leaves every bare gesture alone while text is being typed', () => {
    for (const [key] of BARE) {
      expect(resolveShortcut(press(key, { typing: true }))).toBeNull()
    }
  })

  // The four chords that are ours *because* they are modified. ⌘S is the one
  // that has to win over both the browser's save-page dialog and the bare-`s`
  // still grab — getting this wrong once downloaded a png and opened the dialog.
  it('claims the modified chords the app defines', () => {
    for (const held of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(resolveShortcut(press('k', held))?.do).toBe('palette')
      expect(resolveShortcut(press('s', held))?.do).toBe('saveProfile')
      expect(resolveShortcut(press('z', held))?.do).toBe('undo')
      expect(resolveShortcut(press('y', held))?.do).toBe('redo')
      expect(resolveShortcut(press('z', { ...held, shiftKey: true }))?.do).toBe(
        'redo',
      )
    }
  })

  // Those four are reachable from the filter box and the name box on purpose:
  // that is where you are standing when you decide you wanted the palette, or
  // decided to save.
  it('keeps the modified chords reachable while typing', () => {
    expect(
      resolveShortcut(press('k', { ctrlKey: true, typing: true }))?.do,
    ).toBe('palette')
    expect(
      resolveShortcut(press('s', { ctrlKey: true, typing: true }))?.do,
    ).toBe('saveProfile')
  })

  it('takes Escape from anywhere, typing or not', () => {
    expect(resolveShortcut(press('Escape'))?.do).toBe('escape')
    expect(resolveShortcut(press('Escape', { typing: true }))?.do).toBe(
      'escape',
    )
  })

  it('matches letters whatever the shift/caps state', () => {
    expect(resolveShortcut(press('F'))?.do).toBe('fullscreen')
    expect(resolveShortcut(press('R'))?.do).toBe('record')
  })
})

describe('auto-repeat', () => {
  // A held key repeats at the OS rate. Which gestures may hear that is a real
  // distinction, not an oversight — see the resolver's own notes.
  it('drops the one-shots, which a held key would otherwise fire in a stream', () => {
    for (const key of ['c', 'r', 's', 'o', 't', '1']) {
      expect(resolveShortcut(press(key, { repeat: true }))).toBeNull()
    }
  })

  it('lets `i` repeat, so leaning on it gives a run of short loops', () => {
    expect(resolveShortcut(press('i', { repeat: true }))?.do).toBe('tapCue')
  })
})

describe('shift picks the slot, and the saved-look verb', () => {
  it('sends the cue gestures to B', () => {
    expect(resolveShortcut(press('i'))).toEqual({ do: 'tapCue', slot: 'a' })
    expect(resolveShortcut(press('i', { shiftKey: true }))).toEqual({
      do: 'tapCue',
      slot: 'b',
    })
    expect(resolveShortcut(press('o', { shiftKey: true }))).toEqual({
      do: 'retrigger',
      slot: 'b',
    })
  })

  it('turns a recall into an overwrite', () => {
    expect(resolveShortcut(press('3'))).toEqual({ do: 'recallSlot', n: 3 })
    expect(resolveShortcut(press('3', { shiftKey: true }))).toEqual({
      do: 'saveSlot',
      n: 3,
    })
  })

  // Read off `code`, so the digit survives the shifted spelling of the key. On a
  // US layout shift+3 is '#', and reading `key` would have lost the slot.
  it('finds the digit under its shifted spelling', () => {
    expect(
      resolveShortcut({ ...press('3'), key: '#', shiftKey: true }),
    ).toEqual({ do: 'saveSlot', n: 3 })
  })

  it('takes the numpad too, and ignores 0', () => {
    expect(resolveShortcut({ ...press('4'), code: 'Numpad4' })?.do).toBe(
      'recallSlot',
    )
    expect(resolveShortcut({ ...press('0'), code: 'Digit0' })).toBeNull()
  })
})
