import { describe, expect, it } from 'vitest'

import { MOSAIC_PALETTE, mosaicRows, wrapText } from './teletype'

describe('wrapText', () => {
  it('leaves a line that already fits alone', () => {
    expect(wrapText('PLEASE STAND BY', 32)).toEqual(['PLEASE STAND BY'])
  })

  it('keeps the spacing of a line that fits, exactly', () => {
    // Drawings are made of the gaps: collapsing runs of spaces would be
    // invisible in prose and would shear a mosaic apart.
    expect(wrapText('█   █\n ▀▀▀ ', 32)).toEqual(['█   █', ' ▀▀▀ '])
  })

  it('wraps on word boundaries', () => {
    expect(wrapText('the quick brown fox jumps', 10)).toEqual([
      'the quick',
      'brown fox',
      'jumps',
    ])
  })

  it('keeps explicit newlines, blank ones included', () => {
    expect(wrapText('BE KIND\n\nREWIND', 32)).toEqual(['BE KIND', '', 'REWIND'])
  })

  it('breaks a word too long to fit rather than overflowing', () => {
    expect(wrapText('AAAAAAAAAA', 4)).toEqual(['AAAA', 'AAAA', 'AA'])
  })

  it('leaves no blank line behind when a broken word divides evenly', () => {
    expect(wrapText('AAAAAAAA', 4)).toEqual(['AAAA', 'AAAA'])
  })

  it('flushes the line in hand before starting an oversized word', () => {
    expect(wrapText('hi AAAAAA', 4)).toEqual(['hi', 'AAAA', 'AA'])
  })

  it('never emits a line past the column count', () => {
    const text = 'PLEASE STAND BY\nsupercalifragilistic  tracking\n\n0000 0000'
    for (const cols of [4, 8, 12, 32]) {
      for (const line of wrapText(text, cols)) {
        expect(line.length).toBeLessThanOrEqual(cols)
      }
    }
  })

  it('always yields at least one line, so the card has something to size to', () => {
    expect(wrapText('', 32)).toEqual([''])
  })
})

describe('mosaicRows', () => {
  it('says no to an ordinary character, which is drawn from the font', () => {
    expect(mosaicRows('A')).toBe(null)
    expect(mosaicRows(' ')).toBe(null)
  })

  it('lights the quadrant a glyph shows', () => {
    expect(mosaicRows('█')).toEqual(['11', '11'])
    expect(mosaicRows('▘')).toEqual(['10', '00'])
    expect(mosaicRows('▟')).toEqual(['01', '11'])
  })

  it('decodes the 2x3 mosaics from their code points', () => {
    // U+1FB00 is the first pattern in the block: top-left alone.
    expect(mosaicRows('\u{1FB00}')).toEqual(['10', '00', '00'])
    // U+1FB01 is the next: top-right alone.
    expect(mosaicRows('\u{1FB01}')).toEqual(['01', '00', '00'])
    // U+1FB3B is the last: everything but the top-left.
    expect(mosaicRows('\u{1FB3B}')).toEqual(['01', '11', '11'])
  })

  it('covers every pattern once across the block', () => {
    // The run omits the three patterns that already had characters — left
    // half, right half and full — so what is left has to be the other 60,
    // each exactly once, or the skip arithmetic is off by one somewhere.
    const seen = new Set<string>()
    for (let code = 0x1fb00; code <= 0x1fb3b; code++) {
      const rows = mosaicRows(String.fromCodePoint(code))
      expect(rows).not.toBe(null)
      seen.add(rows?.join('') ?? '')
    }
    expect(seen.size).toBe(60)
    expect(seen.has('101010')).toBe(false) // left half, U+258C
    expect(seen.has('010101')).toBe(false) // right half, U+2590
    expect(seen.has('111111')).toBe(false) // full block, U+2588
    expect(seen.has('000000')).toBe(false) // and blank is a space
  })

  it('offers only characters it can actually draw', () => {
    // Every chip in the dialog is either a mosaic or one of the three dithers;
    // a chip that fell through to the font would insert a tofu box.
    const shades = ['░', '▒', '▓']
    for (const ch of MOSAIC_PALETTE) {
      if (!shades.includes(ch)) expect(mosaicRows(ch)).not.toBe(null)
    }
    for (const shade of shades) expect(MOSAIC_PALETTE).toContain(shade)
  })
})
