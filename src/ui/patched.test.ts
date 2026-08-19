import { describe, expect, it } from 'vitest'

import { slotPatched, soundPatched } from './patched'

// What a box with a picker says it is holding. The rule is one line and every
// case is in the data: two option tables written "Name — what it is", a clip
// whose own name has a dash in it, and the two spellings of empty.
describe('what is patched into a slot', () => {
  it('names the option when nothing was loaded', () => {
    expect(slotPatched({ mode: 'bars', name: '' })).toBe('Color bars')
  })

  it('names what came through the picker once something has', () => {
    expect(slotPatched({ mode: 'file', name: 'holiday.mp4' })).toBe(
      'holiday.mp4',
    )
  })

  // The cut is only ever made on an option's own description. A loaded name is
  // handed over whole, dashes and all — clip labels have one, and the half of
  // 'Test pattern — bars, timecode, motion' before the dash is not what the box
  // is holding.
  it('leaves a loaded name alone when it has a dash in it', () => {
    const name = 'Test pattern — bars, timecode, motion'
    expect(slotPatched({ mode: 'library', name })).toBe(name)
  })

  // An empty box already says so in dashes and carries OFF_HINT; a caption
  // repeating it is ink spent on the one state the drawing says loudest.
  it('says nothing about an empty slot', () => {
    expect(slotPatched({ mode: 'none', name: '' })).toBeUndefined()
    expect(soundPatched('off', '')).toBeUndefined()
  })

  it('answers the same way for the sound', () => {
    expect(soundPatched('mic', '')).toBe('Microphone')
    expect(soundPatched('file', 'take-3.wav')).toBe('take-3.wav')
  })
})
