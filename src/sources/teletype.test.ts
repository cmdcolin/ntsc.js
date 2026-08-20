import { describe, expect, it } from 'vitest'

import {
  MAX_COLS,
  MOSAIC_PALETTE,
  PAINT_ROWS,
  TELETYPE_MAX,
  boilOffsets,
  cellsToText,
  clampCardText,
  garbleRows,
  graphicsCode,
  mosaicChar,
  mosaicRows,
  patternRows,
  sextantRows,
  textToCells,
  wrapText,
} from './teletype'

// Every 2x3 pattern, as the rows a cell is described by.
const patterns = (): string[][] =>
  Array.from({ length: 64 }, (_, bits) =>
    [0, 1, 2].map(r => `${(bits >> (2 * r)) & 1}${(bits >> (2 * r + 1)) & 1}`),
  )

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
        expect(Array.from(line).length).toBeLessThanOrEqual(cols)
      }
    }
  })

  it('measures a line in characters, not code units', () => {
    // A sextant is two UTF-16 units, so a full row of them is 80 units wide
    // and 40 cells wide. Counting units folds a row that fits.
    const row = '🬀'.repeat(40)
    expect(wrapText(row, 40)).toEqual([row])
  })

  it('keeps the gaps in a drawn row that is wider than 20 mosaics', () => {
    // The failure that made a drag scramble the page: past the point where the
    // row's code units passed the column count, the re-flow path collapsed the
    // spaces between the blocks and pushed the overflow onto the next line.
    const row = '🬀   '.repeat(10)
    expect(wrapText(row, 40)).toEqual([row])
  })

  it('breaks an oversized word between characters, not inside one', () => {
    expect(wrapText('🬀'.repeat(6), 4)).toEqual(['🬀🬀🬀🬀', '🬀🬀'])
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

  it('round-trips every pattern a drawing can be made of', () => {
    // Paint reads a cell, sets one block and writes it back, so a pattern that
    // came back as a different character than it went in as would change the
    // five blocks nobody touched.
    for (const rows of patterns()) {
      expect(sextantRows(mosaicChar(rows))).toEqual(rows)
    }
  })

  it('gives distinct characters to distinct patterns', () => {
    expect(new Set(patterns().map(mosaicChar)).size).toBe(64)
  })

  it('uses the characters that already existed rather than a sextant', () => {
    expect(mosaicChar(['00', '00', '00'])).toBe(' ')
    expect(mosaicChar(['11', '11', '11'])).toBe('█')
    expect(mosaicChar(['10', '10', '10'])).toBe('▌')
    expect(mosaicChar(['01', '01', '01'])).toBe('▐')
    expect(mosaicChar(['10', '00', '00'])).toBe('\u{1FB00}')
  })

  it('reads a cell holding something that is not on thirds as unpaintable', () => {
    // A letter, a shade and a quadrant have no 2x3 pattern to add a block to,
    // so paint replaces them instead of trying to merge into them.
    expect(sextantRows('A')).toBe(null)
    expect(sextantRows('▒')).toBe(null)
    expect(sextantRows('▀')).toBe(null)
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

describe('the paint grid', () => {
  it('lays text out as a rectangle of cells', () => {
    const { cells, tail } = textToCells('HI', 3)
    expect(cells.length).toBe(3)
    expect(cells.every(row => row.length === MAX_COLS)).toBe(true)
    expect(cells[0].slice(0, 3)).toEqual(['H', 'I', ' '])
    expect(cells[2].every(c => c === ' ')).toBe(true)
    expect(tail).toEqual([])
  })

  it('keeps a mosaic whole, rather than as two halves of a code point', () => {
    const { cells } = textToCells('\u{1FB00}\u{1FB01}', 1)
    expect(cells[0].slice(0, 2)).toEqual(['\u{1FB00}', '\u{1FB01}'])
  })

  it('comes back as the text it went in as', () => {
    const text = 'HI\n  \u{1FB00}█\nBYE'
    const { cells, tail } = textToCells(text, 8)
    expect(cellsToText(cells, tail)).toBe(text)
  })

  it('drops the blank rows under a drawing rather than carrying them around', () => {
    const { cells, tail } = textToCells('X', 24)
    expect(cellsToText(cells, tail)).toBe('X')
  })

  it('keeps the rows past the page, and the blanks holding them up', () => {
    // A card can be taller than the surface; drawing on the top of one must not
    // quietly drop the bottom of it, or shuffle it upward.
    const { cells, tail } = textToCells('TOP\n\n\nDEEP', 3)
    expect(tail).toEqual(['DEEP'])
    expect(cellsToText(cells, tail)).toBe('TOP\n\n\nDEEP')
  })

  it('holds a drawn page still through the round trip a stroke makes', () => {
    // Every block a drag lays down goes cells -> text -> cells, so anything the
    // trip moves gets moved again on the next sample: a page that does not come
    // back identical does not wobble, it walks away.
    const { cells, tail } = textToCells('', PAINT_ROWS)
    for (let c = 0; c < MAX_COLS; c += 3) cells[0][c] = '\u{1FB00}'
    for (let c = 0; c < MAX_COLS; c++) cells[5][c] = '█'
    cells[9][20] = 'X'
    const back = textToCells(cellsToText(cells, tail), PAINT_ROWS)
    expect(back.cells).toEqual(cells)
  })

  it('never makes a page too long to store', () => {
    // A full 40x24 of drawn blocks is the biggest thing the surface can
    // produce, and it has to survive the trip through a link.
    const full = Array.from({ length: 24 }, () =>
      Array.from({ length: MAX_COLS }, () => '\u{1FB00}'),
    )
    const text = cellsToText(full)
    expect(Array.from(text).length).toBeLessThanOrEqual(TELETYPE_MAX)
    expect(clampCardText(text)).toBe(text)
  })
})

describe('boilOffsets', () => {
  const COLS = 40
  const ROWS = 24
  const at = (o: Int8Array, c: number, r: number): [number, number] => [
    o[(r * COLS + c) * 2],
    o[(r * COLS + c) * 2 + 1],
  ]

  it('offsets every cell by at most one dot', () => {
    // Two dots is most of a stroke at this cell size, and a card that moved by
    // that much would read as a different drawing rather than the same one
    // redrawn.
    for (let phase = 0; phase < 8; phase++) {
      const o = boilOffsets(COLS, ROWS, phase)
      expect(o).toHaveLength(COLS * ROWS * 2)
      expect(Array.from(o).every(v => v >= -1 && v <= 1)).toBe(true)
    }
  })

  it('gives the same phase the same hand every time', () => {
    // The grid is rebuilt from the phase on every tick and again whenever the
    // card is re-printed; a phase that drew differently the second time would
    // boil at the timer's rate rather than at the hand's.
    expect(boilOffsets(COLS, ROWS, 3)).toEqual(boilOffsets(COLS, ROWS, 3))
  })

  it('draws a different hand for the next phase', () => {
    const a = boilOffsets(COLS, ROWS, 0)
    const b = boilOffsets(COLS, ROWS, 1)
    expect(a).not.toEqual(b)
  })

  it('moves neighbours together rather than shivering each cell alone', () => {
    // The one property that separates a boil from noise: per-cell independent
    // jitter tears a drawing into a grid of seams. Nine offsets are in play
    // (-1/0/1 on each axis, the middle twice as likely as either end), so an
    // uncorrelated field would have adjacent cells agree about 14% of the time.
    // The field's wavelength is what buys the rest — see BOIL_CELLS.
    let agree = 0
    let pairs = 0
    for (let phase = 0; phase < 6; phase++) {
      const o = boilOffsets(COLS, ROWS, phase)
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c + 1 < COLS; c++) {
          const [ax, ay] = at(o, c, r)
          const [bx, by] = at(o, c + 1, r)
          if (ax === bx && ay === by) agree++
          pairs++
        }
      }
    }
    expect(agree / pairs).toBeGreaterThan(0.7)
  })

  it('does not move the whole page the same way', () => {
    // The other half of it: a field so smooth that every cell agrees is the
    // card sliding, not boiling — the picture would translate as one block and
    // nothing on it would move relative to anything else.
    const o = boilOffsets(COLS, ROWS, 5)
    const distinct = new Set<string>()
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) distinct.add(at(o, c, r).join(','))
    }
    expect(distinct.size).toBeGreaterThan(3)
  })
})

describe('garbleRows', () => {
  const page = (ch: string, rows = 24, cols = 40): string[][] =>
    Array.from({ length: rows }, () => Array.from(ch.repeat(cols)))
  const flat = (p: string[][]): string => p.map(row => row.join('')).join('\n')
  const damage = (before: string[][], after: string[][]): number => {
    let n = 0
    before.forEach((row, r) =>
      row.forEach((ch, c) => {
        if (after[r][c] !== ch) n++
      }),
    )
    return n
  }

  it('reads a graphics code back as the blocks it draws', () => {
    // Six blocks in a seven-bit code with a gap in the middle of it. Wrong by
    // one bit and a garbled row draws the right shapes in the wrong places,
    // which is exactly the kind of thing only arithmetic catches.
    for (const rows of patterns()) {
      const code = graphicsCode(rows)
      expect(patternRows(code)).toEqual(rows)
      expect(code >= 0x20 && code <= 0x7f).toBe(true)
      expect(code >= 0x40 && code < 0x60).toBe(false)
    }
  })

  it('hands back every row at exactly the length it took', () => {
    // The card sizes itself to its widest row. A garble that added or dropped
    // a cell would resize the block, and a crawling one would change period,
    // every time a bit flipped.
    const before = page('X')
    const after = garbleRows(before, 7)
    expect(after.map(row => row.length)).toEqual(before.map(row => row.length))
  })

  it('draws only characters the card has a glyph for', () => {
    // A flip lands the code anywhere in seven bits, and a third of that range
    // is control codes. One reaching the grid would print as tofu or as
    // nothing at all rather than as the hole or the block it stands for.
    for (let phase = 0; phase < 12; phase++) {
      for (const row of garbleRows(page('e'), phase)) {
        for (const ch of row) {
          const code = ch.codePointAt(0) ?? 0
          const drawable =
            (code >= 0x20 && code <= 0x7e) || mosaicRows(ch) !== null
          expect(drawable).toBe(true)
        }
      }
    }
  })

  it('misspells a page rather than replacing it', () => {
    // Wrong in a few cells is a page fighting a signal; wrong everywhere is
    // noise with a font. Both ends are worth pinning: the rate is the one
    // number in here that was picked by eye.
    const clean = page('X')
    for (let phase = 0; phase < 8; phase++) {
      const hit = damage(clean, garbleRows(clean, phase))
      expect(hit / (24 * 40)).toBeGreaterThan(0.02)
      expect(hit / (24 * 40)).toBeLessThan(0.15)
    }
  })

  it('gives the same tick the same page every time', () => {
    // The grid is rebuilt from the phase on every timer tick and again on
    // every re-print. A tick that garbled differently the second time would
    // re-roll at the timer's rate rather than at the feed's.
    expect(flat(garbleRows(page('X'), 5))).toBe(flat(garbleRows(page('X'), 5)))
  })

  it('does not break and heal the whole page at once', () => {
    // Rows are overwritten one pass of the magazine at a time, so a tick
    // clears some rows and leaves the rest sitting on their mistakes. A page
    // that re-rolled every row together would strobe.
    const clean = page('X')
    for (let phase = 0; phase < 8; phase++) {
      const before = garbleRows(clean, phase)
      const after = garbleRows(clean, phase + 1)
      const moved = before.filter(
        (row, r) => row.join('') !== after[r].join(''),
      )
      expect(moved.length).toBeGreaterThan(0)
      expect(moved.length).toBeLessThan(before.length)
    }
  })

  it('takes a row into graphics when a hit lands on a control code', () => {
    // The catastrophe worth having: one flipped bit under 0x20 puts the rest
    // of the row into the mosaic set, where the code that drew a digit draws a
    // block. Rare per cell, so this looks across a page and a few ticks.
    let runs = 0
    for (let phase = 0; phase < 12; phase++) {
      for (const row of garbleRows(page('0'), phase)) {
        const blocks = row.filter(ch => mosaicRows(ch) !== null).length
        if (blocks >= 3) runs++
      }
    }
    expect(runs).toBeGreaterThan(0)
  })

  it('leaves the capitals standing in a graphics row', () => {
    // 0x40-0x5F holds the same letters in both halves of the set — the gap the
    // sixth block sits either side of — so a row that has gone to graphics
    // keeps its capitals and turns everything around them into blocks. Which
    // is why a garbled page reads as words in a field of rubble rather than as
    // rubble. Held against a page of digits, where the same rows go solid.
    const worst = (ch: string): number => {
      let most = 0
      for (let phase = 0; phase < 12; phase++) {
        for (const row of garbleRows(page(ch), phase)) {
          most = Math.max(most, row.filter(c => mosaicRows(c) !== null).length)
        }
      }
      return most
    }
    expect(worst('X')).toBeLessThan(5)
    expect(worst('0')).toBeGreaterThan(20)
  })
})

describe('clampCardText', () => {
  it('counts characters, not the units they are stored in', () => {
    // A sextant is two UTF-16 units. Measured by .length, a drawn page would be
    // cut in half.
    const drawn = '\u{1FB00}'.repeat(TELETYPE_MAX)
    expect(Array.from(clampCardText(drawn)).length).toBe(TELETYPE_MAX)
  })

  it('never cuts a character in half', () => {
    const clamped = clampCardText('\u{1FB00}'.repeat(TELETYPE_MAX + 10))
    // A lone surrogate has no code point of its own to come back as.
    expect(Array.from(clamped).every(c => c.codePointAt(0)! > 0xffff)).toBe(
      true,
    )
  })
})
