// A character generator on the input side: whatever someone types, drawn as a
// broadcast text card and handed to the chain like any other picture. Type is
// the harshest thing you can feed a composite path — full-swing white against
// black, with a vertical edge on every stem — so ringing, dot crawl and chroma
// bleed all show on letterforms long before they show on a photograph.
//
// Drawn square-pixel at 4:3 rather than on the 754-sample raster the other
// patterns use. The raster's pixels are not square, so a card drawn straight
// onto it comes back horizontally squashed once compose maps it to 4:3. Bars
// and sweep want exactly that — they are edges and gratings, and the squash is
// what puts their frequencies at the MHz they claim — but letterforms have to
// keep their proportions, so the card carries its own aspect instead.

// The glyphs are not typeset, they are *dots*. A character generator of the
// period held its font in a ROM as a few bytes per character — 5x7 ink inside
// a taller cell — and painted those dots straight into the video, so the type
// had no curves, no antialiasing and no hinting: only square dots on a grid.
// Rendering the text with the browser's rasteriser and calling it done gets
// letterforms far too clean for the rest of this app, so the card is drawn at
// dot resolution, thresholded to one bit, and then blown up with the smoothing
// off. Everything crunchy about it — broken thin strokes, stairstepped
// diagonals, letters that shift a dot as they wrap — is the ROM, not a bug.
export const CELL_W = 8
export const CELL_H = 12
// Font size used inside a cell. Small enough that thresholding it to one bit
// crushes the glyph down to a handful of dots, which is the whole point.
const CELL_PX = 11
// Coverage a dot needs before it lights. Low enough to keep thin stems alive
// at this size, high enough that the rasteriser's grey fringe doesn't survive.
const INK = 96

// 2x the raster's long edge. compose minifies the card with a linear sampler,
// and dot edges are the first thing to suffer from sampling it 1:1.
const CARD_W = 1280
const CARD_H = 960
export const TELETYPE_ASPECT = CARD_W / CARD_H

// A teletext page was 40 columns, and so is this.
export const MAX_COLS = 40
// And 24 rows, which is the page you draw on. Nothing stops a card being
// taller — a crawl usually is — but a surface has to be some fixed size, and
// this is the one the character set was designed around.
export const PAINT_ROWS = 24
// Short text is not blown up to fill the card: "HI" 400px tall is a shape, not
// type, and it stops looking like a caption.
const MIN_COLS = 8
// Fraction of each edge kept clear. Overscan ate the outer ~5% of a real
// broadcast picture, and the CRT face pass here crops in the same way.
const MARGIN = 0.07
const USABLE_W = CARD_W * (1 - 2 * MARGIN)
const USABLE_H = CARD_H * (1 - 2 * MARGIN)
// Rows that fit at one card pixel per dot, which is as small as the card ever
// draws. Past this there is nothing to see, so the rest is dropped rather than
// left to run off both edges — 500 newlines is a thing a person can paste.
const MAX_ROWS = Math.floor(USABLE_H / CELL_H)

// Long enough for a page of teletext (40x24 is 960 characters, plus the line
// breaks between the rows), short enough that the reveal stays a reveal.
// Enforced on the query-string path too, where the text arrives from a link.
export const TELETYPE_MAX = 1000

// Characters, counted the way a card counts them: a sextant lives outside the
// BMP and is two UTF-16 units, so a limit measured in `.length` would cut a
// drawn page in half and — worse — could cut it *between* the halves of a
// character, leaving a lone surrogate that draws as tofu. Every way text gets
// in comes through here.
export const clampCardText = (text: string): string =>
  Array.from(text).slice(0, TELETYPE_MAX).join('')

// A card as its owner set it: what it says, whether it rolls up the frame
// instead of sitting still, whether it is redrawn by an unsteady hand, and
// whether it arrives over a wire bad enough to misspell it. One value rather
// than four loose fields, because every layer between the dialog and the query
// string has to carry it whole.
export interface TeletypeCard {
  text: string
  crawl: boolean
  boil: boolean
  garble: boolean
}

export const TELETYPE_DEFAULT: TeletypeCard = {
  text: 'PLEASE STAND BY',
  crawl: false,
  boil: false,
  garble: false,
}

// A monospace stack rather than `monospace` alone: the generic maps to
// something proportional-ish on some Linux setups, and a glyph wider than its
// cell would bleed into its neighbour. Not bold — at this size the extra weight
// closes up the counters in e/a/o once the threshold lands.
const FONT = `${CELL_PX}px "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace`

// Teletext graphics. Half of the SAA5050's character set was *mosaic*: the cell
// split into a 2x3 grid of blocks, so a page could draw as well as spell —
// which is what every weather map and football table on teletext was made of.
// The same shapes are in Unicode now, and because this card is already dots on
// a grid we paint them ourselves instead of asking the font for a glyph. That
// is both exact — a block lands on cell boundaries, so neighbours tile with no
// seam — and independent of the font, which matters because the fallbacks here
// carry the quadrants but almost never the sextants.
//
// Written out as the rows they light rather than as bit patterns, because the
// only review that catches a wrong one is holding it against the glyph.
const QUADRANTS: Record<string, string[]> = {
  '█': ['11', '11'],
  '▀': ['11', '00'],
  '▄': ['00', '11'],
  '▌': ['10', '10'],
  '▐': ['01', '01'],
  '▘': ['10', '00'],
  '▝': ['01', '00'],
  '▖': ['00', '10'],
  '▗': ['00', '01'],
  '▚': ['10', '01'],
  '▞': ['01', '10'],
  '▙': ['10', '11'],
  '▛': ['11', '10'],
  '▜': ['11', '01'],
  '▟': ['01', '11'],
}

// The 2x3 mosaics, U+1FB00 upward. The block runs through every pattern in
// order — bit per cell, top-left first — but omits the three that already had
// characters of their own, so those have to be skipped on the way back out.
const SEXTANT_FIRST = 0x1fb00
const SEXTANT_LAST = 0x1fb3b
const SEXTANT_LEFT_HALF = 0b010101
const SEXTANT_RIGHT_HALF = 0b101010

// Shading, as a dither at dot resolution rather than a grey: the card is one
// bit, and a real one was too. Through the chain a 50% dither is a half-rate
// checker, which is the pattern chroma bleed and dot crawl feed on.
const SHADES: Record<string, number> = { '░': 1, '▒': 2, '▓': 3 }
const SHADE_DOTS: [number, number][][] = [
  [[0, 0]],
  [
    [0, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
]

export const SHADE_CHARS = Object.keys(SHADES)

// Everything the dialog offers as a click-to-insert chip. Sextants are not
// here — there are sixty of them and no keyboard has them either; they arrive
// by being drawn, or in pasted block art.
export const MOSAIC_PALETTE = [...Object.keys(QUADRANTS), ...SHADE_CHARS]

// Rows of a mosaic character, one '1' per lit block, or null for anything that
// is an ordinary glyph. Exported for the tests: the sextant decode is
// arithmetic over a Unicode block, and arithmetic is worth pinning down.
export function mosaicRows(ch: string): string[] | null {
  const quad = QUADRANTS[ch]
  if (quad !== undefined) return quad
  const code = ch.codePointAt(0) ?? 0
  if (code < SEXTANT_FIRST || code > SEXTANT_LAST) return null
  let bits = code - SEXTANT_FIRST + 1
  if (bits >= SEXTANT_LEFT_HALF) bits++
  if (bits >= SEXTANT_RIGHT_HALF) bits++
  return [0, 1, 2].map(
    row => `${(bits >> (2 * row)) & 1}${(bits >> (2 * row + 1)) & 1}`,
  )
}

// The 2x3 pattern a cell is already holding, or null if it holds something that
// does not land on thirds — a letter, a shade, a quadrant. Paint starts from
// what is there when it can, so putting a dot next to a dot keeps the first
// one; a cell holding anything else is replaced rather than merged into.
//
// Blank and the three whole-cell blocks are patterns the sextant range doesn't
// carry (they had characters of their own long before it existed), so they are
// named here rather than decoded.
export function sextantRows(ch: string): string[] | null {
  if (ch === ' ') return ['00', '00', '00']
  if (ch === '█') return ['11', '11', '11']
  if (ch === '▌') return ['10', '10', '10']
  if (ch === '▐') return ['01', '01', '01']
  const rows = mosaicRows(ch)
  return rows !== null && rows.length === 3 ? rows : null
}

// The inverse of sextantRows: a painted pattern back to the character that
// carries it. Drawing needs this because text is the only thing a card has —
// it is what the box holds, what the link carries and what someone pastes
// somewhere else — so a picture has to survive as characters or not at all.
export function mosaicChar(rows: string[]): string {
  let bits = 0
  rows.forEach((row, r) => {
    for (let c = 0; c < 2; c++) if (row[c] === '1') bits |= 1 << (2 * r + c)
  })
  if (bits === 0) return ' '
  if (bits === 0b111111) return '█'
  if (bits === SEXTANT_LEFT_HALF) return '▌'
  if (bits === SEXTANT_RIGHT_HALF) return '▐'
  // Undo the two the block skips: a pattern past one of them sits that many
  // code points earlier than its value would suggest.
  let n = bits
  if (n > SEXTANT_RIGHT_HALF) n--
  if (n > SEXTANT_LEFT_HALF) n--
  return String.fromCodePoint(SEXTANT_FIRST + n - 1)
}

// A page as cells — one character each, wrapped and padded out to a rectangle.
// Text is ragged and a paint surface is not, so this is the shape drawing wants
// and `text` never has. Rows past the page are handed back untouched: someone
// with a long card should be able to draw on the top of it without the rest
// quietly disappearing.
export function textToCells(
  text: string,
  rows: number,
): { cells: string[][]; tail: string[] } {
  const lines = wrapText(text, MAX_COLS)
  return {
    cells: Array.from({ length: rows }, (_row, r) => {
      // By character, not by code unit: a sextant is one cell, not two halves.
      const line = Array.from(lines[r] ?? '')
      return Array.from({ length: MAX_COLS }, (_cell, c) => line[c] ?? ' ')
    }),
    tail: lines.slice(rows),
  }
}

// And back. Trailing blanks come off — a drawing in the top corner should not
// carry twenty empty rows around with it, and the card centres what it is
// given — but only down to where the untouched tail starts, or dropping them
// would drag the tail up into the picture.
export function cellsToText(cells: string[][], tail: string[] = []): string {
  const lines = cells.map(row => row.join('').replace(/\s+$/, ''))
  if (tail.length === 0) {
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  }
  return [...lines, ...tail].join('\n')
}

// Break text into lines of at most `cols` characters. Explicit newlines are
// kept (including empty ones, so a deliberate gap between stanzas survives) and
// a word longer than the line is broken rather than blowing past the margin.
//
// Everything here counts *characters*, never `.length`. A sextant is one cell
// of the page and two UTF-16 units of the string, so measuring in code units
// makes a drawn row look twice as wide as it is: a row that came off a 40-cell
// grid — and therefore fits by construction — would be sent down the re-flow
// path below, which collapses the runs of spaces that are the picture and
// snaps the overflow onto a line of its own, shoving everything under it a row
// further down the page with every stroke. Slicing by code units would be
// worse still, cutting a character between its halves.
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    // A line that already fits is taken exactly as typed. Re-flowing it would
    // be invisible in prose and fatal in a drawing, where the runs of spaces
    // between the blocks are the picture.
    const chars = Array.from(para)
    if (chars.length <= cols) {
      out.push(para)
      continue
    }
    let line: string[] = []
    for (const word of para.split(/\s+/).filter(w => w !== '')) {
      let rest = Array.from(word)
      while (rest.length > cols) {
        if (line.length > 0) {
          out.push(line.join(''))
          line = []
        }
        out.push(rest.slice(0, cols).join(''))
        rest = rest.slice(cols)
      }
      // An oversized word that divided evenly has nothing left to place, and
      // starting a line with it would leave a blank one behind.
      if (rest.length === 0) continue
      if (line.length === 0) line = rest
      else if (line.length + 1 + rest.length <= cols)
        line = [...line, ' ', ...rest]
      else {
        out.push(line.join(''))
        line = rest
      }
    }
    out.push(line.join(''))
  }
  return out
}

// Boil: the card redrawn a few times a second by a hand that cannot hold still.
// The text does not change — this is one card, and what a link carries is still
// that one card — but every cell's dots land up to a dot off where they landed
// last time, so the strokes crawl and the letterforms shiver.
//
// The reason it is worth having on a *composite* path, rather than being a cute
// wobble: type is the harshest thing you can feed this chain, and a still card
// gives still artifacts — the ringing parks on the same stems, the dot crawl
// sits. Move the dots a dot and the chain has to decide all of it again every
// frame, so the crawl actually crawls and the chroma bleed shimmers. The source
// moves; nothing in the signal path knows about it (see teletypeSlot).
//
// Offsets are in dots, and only ever -1, 0 or 1. Two is already most of a
// stroke's width at this cell size and reads as a different drawing rather than
// as the same one redrawn.
const BOIL_DOTS = 1
// Wavelength of the field, in cells. This is the number that makes a boil look
// like a hand: per-cell independent jitter would shiver every cell on its own
// and tear a drawing into a grid of seams — a fault in the character generator,
// not a hand. Sampled from a smooth field instead, neighbours lean together,
// solid areas stay solid, and only the *edges* of a shape move.
//
// Six cells is where that lands. Measured over a 40x24 page (a 3x3 grid of
// possible offsets, so an uncorrelated field would have adjacent cells agree
// about 14% of the time): 2.5 cells agrees 61% and still cracks a filled area
// open too often, 6 agrees 81%, and past ~10 the page starts leaning as one
// block, which is the card sliding rather than boiling. A drawn shape is a
// handful of cells across, so at 6 it mostly moves as a whole with its
// extremities lagging — which is what a redrawn line does.
const BOIL_CELLS = 6

// Lattice hash and the 2-D value-noise field over it. Local rather than
// `signal/noise`'s: that one is a 1-D series sampled along time, and a field
// sampled diagonally through it streaks — the drawing would shear along one
// diagonal instead of wobbling.
function boilHash(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 0x80000000 - 1
}

const smoothstep = (f: number): number => f * f * (3 - 2 * f)

function boilField(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smoothstep(x - xi)
  const v = smoothstep(y - yi)
  const top = boilHash(xi, yi, seed) * (1 - u) + boilHash(xi + 1, yi, seed) * u
  const bot =
    boilHash(xi, yi + 1, seed) * (1 - u) + boilHash(xi + 1, yi + 1, seed) * u
  return top * (1 - v) + bot * v
}

// Where every cell's dots land on boil frame `phase`: dx, dy per cell, row
// major. Exported for the tests — this is the whole mechanism, and it is
// arithmetic, which is the part worth pinning down in node where there is no
// canvas to look at.
//
// Consecutive phases are *uncorrelated* fields rather than a drift through one:
// a boil is the drawing redrawn, not the drawing moved, so there is nothing to
// pan through. x and y take their own seed off the phase, or every cell would
// move along the same diagonal.
export function boilOffsets(
  cols: number,
  rows: number,
  phase: number,
): Int8Array {
  const out = new Int8Array(cols * rows * 2)
  for (let r = 0; r < rows; r++) {
    const y = r / BOIL_CELLS
    for (let c = 0; c < cols; c++) {
      const x = c / BOIL_CELLS
      const i = (r * cols + c) * 2
      out[i] = Math.round(BOIL_DOTS * boilField(x, y, phase * 2))
      out[i + 1] = Math.round(BOIL_DOTS * boilField(x, y, phase * 2 + 1))
    }
  }
  return out
}

// Garble: the page as it comes off a signal the decoder is barely holding.
//
// A teletext page is not a picture, it is characters — sent in the vertical
// blanking a packet at a time, forty bytes to a row, seven bits and an odd
// parity bit to a byte. Nothing is retransmitted on request. A byte that
// arrives wrong is displayed wrong, and stays wrong until the magazine comes
// round to that row again and overwrites it, which is why a page off a weak
// aerial is never fuzzy the way a picture is: it is *misspelt*, and it holds
// each mistake for the better part of a second before healing a row at a time
// while the next row breaks.
//
// So a hit lands on the byte and not on the glyph, and the three things that
// can come of it are the three things you actually saw on a bad page:
//
//   - One bit flips, parity fails, and the decoder throws the character away
//     and leaves a hole. Most of a garble is holes, because a marginal feed
//     makes single-bit errors far more often than double ones.
//   - Two bits flip, parity passes, and the character the flipped bits name
//     prints instead. Near-misses rather than noise — the wrong letter is
//     always a letter or two away from the right one.
//   - A flip carries the code under 0x20, where the *control* codes live, and
//     a control code owns the rest of its row: 0x11-0x17 put the row into the
//     mosaic set, where the code that drew a letter draws a block. One hit,
//     and the back half of the line is graphics.
//   - The hit lands not on the text but on the *address* the packet carries,
//     and a whole row is delivered to the wrong line of the page: one line
//     printed twice, somewhere else left holding what it had. The address is
//     five bits, so a row never moves by an arbitrary distance — it moves by
//     one, two, four, eight or sixteen rows, and a packet addressed off the
//     end of the page is simply lost.
//
// The rate is the one number here that is taste rather than mechanism. A feed
// bad enough to show this on a fifteen-character card would be dropping whole
// rows; this is set to what makes a short card visibly unwell, and the split
// between holes and wrong characters is even rather than the ten-to-one a real
// bit error rate gives, because the wrong character is the half that reads as
// *received* rather than as missing.
const GARBLE_RATE = 0.07
// Ticks a row keeps its damage for, and how far apart consecutive rows sit in
// that cycle. Coprime, so every row in a page is at a different point of its
// own refresh and the page never heals all at once — one row clearing while
// its neighbour breaks is the whole texture of a page fighting a weak signal.
const ROW_TICKS = 3
const ROW_SKEW = 2
// Packets whose row address takes the hit instead of their text. Rare next to
// the character rate, because the address is the one field a real service
// protected — Hamming coded, so it takes more than a bit to break — and
// because a line landing in the wrong place is loud: at anything like the
// character rate the page would read as shuffled rather than as received.
const ADDRESS_RATE = 1 / 30

function garbleHash(col: number, row: number, epoch: number): number {
  let h =
    Math.imul(col | 0, 0x2545f491) ^
    Math.imul(row | 0, 0x9e3779b1) ^
    Math.imul(epoch | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h ^= h >>> 15
  return h >>> 0
}

// The 2x3 blocks a graphics code draws, and the code that draws a given 2x3.
// Six blocks in a seven-bit code, and they are not contiguous: bit 5 is the
// one that says "this half of the set is graphics" and carries no block of its
// own, so the sixth block is up at bit 6. That gap is why the capitals at
// 0x40-0x5F survive in a graphics row — a garbled row keeps its letters and
// turns everything around them into blocks.
export const patternRows = (code: number): string[] => {
  const bit = (n: number) => (code >> n) & 1
  return [`${bit(0)}${bit(1)}`, `${bit(2)}${bit(3)}`, `${bit(4)}${bit(6)}`]
}

export const graphicsCode = (rows: string[]): number => {
  const bit = (r: number, c: number) => (rows[r][c] === '1' ? 1 : 0)
  return (
    0x20 |
    bit(0, 0) |
    (bit(0, 1) << 1) |
    (bit(1, 0) << 2) |
    (bit(1, 1) << 3) |
    (bit(2, 0) << 4) |
    (bit(2, 1) << 6)
  )
}

// One received page: the cells as they came out of the decoder on tick
// `phase`. Every row comes back exactly as long as it went in — the card sizes
// itself to its widest row, and a garble that could add or drop a cell would
// resize the block and shove a crawl off its period every time a bit flipped.
//
// Exported for the tests, like boilOffsets and for the same reason: this is
// the whole mechanism, it is arithmetic over character codes, and node can
// check every one of them without a canvas.
export function garbleRows(page: string[][], phase: number): string[][] {
  return page.map((row, r) => {
    const epoch = Math.floor((phase + r * ROW_SKEW) / ROW_TICKS)
    // Whose bytes this line is holding. Off a column the cells cannot reach,
    // so a mis-addressed row and the characters in it are independent rolls
    // rather than the same one read twice.
    const addr = garbleHash(MAX_COLS + 8, r, epoch)
    const step = 1 << ((addr >>> 4) % 5)
    const from = ((addr >>> 8) & 1) === 0 ? r - step : r + step
    // A packet addressed off the end of the page is lost, and a line nothing
    // arrived for keeps what it had — which on a card that is not being
    // retyped is its own text, so the loss is invisible and only the landing
    // shows. Cut to this line's own length either way: the transmission is
    // forty cells wide whatever the text is, and a row that came back longer
    // than it went would resize the card.
    const sent =
      addr >>> 20 < ADDRESS_RATE * 0x1000 && from >= 0 && from < page.length
        ? Array.from({ length: row.length }, (_cell, c) => page[from][c] ?? ' ')
        : row
    // Set the row is in, which a hit on a control code can change part way
    // along it — so this is carried left to right and never reset per cell.
    let graphics = false
    return sent.map((ch, c) => {
      // What the transmission would have carried for this cell. A drawn
      // mosaic is a graphics code rather than the code point Unicode files it
      // under, so a hit on a drawing moves one block, not one astral digit.
      const mosaic = sextantRows(ch)
      const drawn = mosaic !== null && ch !== ' '
      const code =
        mosaic === null ? (ch.codePointAt(0) ?? 0x20) : graphicsCode(mosaic)
      const h = garbleHash(c, r, epoch)
      let out = code
      if (h >>> 20 < GARBLE_RATE * 0x1000) {
        // The shades and the quadrants have no seven-bit code — they are the
        // palette's, not the transmission's — so there is nothing to flip and
        // a hit can only take the cell out.
        if (code > 0x7e) return ' '
        if (((h >>> 8) & 1) === 0) return ' '
        const first = (h >>> 4) % 7
        const other = (h >>> 12) % 6
        out = code ^ (1 << first) ^ (1 << (other >= first ? other + 1 : other))
      }
      if (out < 0x20 || out === 0x7f) {
        if (out >= 0x10 && out <= 0x17) graphics = true
        else if (out <= 0x07) graphics = false
        return ' '
      }
      if (out > 0x7e) return String.fromCharCode(out)
      if ((graphics || drawn) && (out < 0x40 || out >= 0x60))
        return mosaicChar(patternRows(out))
      return String.fromCharCode(out)
    })
  })
}

export const makeTeletypeCard = (): OffscreenCanvas =>
  new OffscreenCanvas(CARD_W, CARD_H)

// The dither tiles, built on first use — this module is imported by tests in
// node, where OffscreenCanvas does not exist until something asks for one.
let tiles: OffscreenCanvas[] | null = null
function shadeTile(level: number): OffscreenCanvas {
  tiles ??= SHADE_DOTS.map(dots => {
    const tile = new OffscreenCanvas(2, 2)
    const g = tile.getContext('2d')
    if (!g) throw new Error('no 2d context')
    g.fillStyle = '#fff'
    for (const [x, y] of dots) g.fillRect(x, y, 1, 1)
    return tile
  })
  return tiles[level - 1]
}

// The character grid at dot resolution: one glyph or mosaic per cell, placed on
// the cell rather than by the font's own advance, then knocked down to one bit.
// Every dot comes back either lit or black, which is the state a ROM could be
// in.
//
// Exported because the paint surface draws with it too: what you are drawing on
// is the card's own rasteriser at 1:1, so there is no second renderer to keep
// honest and no way for the preview to disagree with the picture. It wants the
// cursor left off — that block belongs to a card being typed, not to a page
// being drawn on — and it never boils: a page you are drawing on has to hold
// still under the cursor.
//
// `boil` is one frame's worth of per-cell dot offsets (boilOffsets). A cell
// pushed off the far edge loses a dot column to the canvas bounds; the card
// keeps 7% of each edge clear anyway, so there is nothing out there to lose.
export function dotGrid(
  rows: string[][],
  cols: number,
  cursor = true,
  boil: Int8Array | null = null,
): OffscreenCanvas {
  const grid = new OffscreenCanvas(cols * CELL_W, rows.length * CELL_H)
  const g = grid.getContext('2d')
  if (!g) throw new Error('no 2d context')
  g.font = FONT
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fff'
  // Anchored to the grid origin, so a run of shaded cells tiles as one field
  // instead of restarting its checker at every cell boundary.
  const dither = new Map<number, CanvasPattern | null>()
  rows.forEach((row, r) => {
    // Per character, not per line: the cell grid is the layout, and letting the
    // font's own advance place them would put the dots between columns.
    row.forEach((ch, col) => {
      // A drawn page is mostly holes, and a space is a glyph like any other as
      // far as the rasteriser is concerned — measuring one 960 times a redraw
      // is the whole cost of painting on a full page.
      if (ch === ' ') return
      // The hand, if there is one. Applied to the cell's origin rather than to
      // its dots individually: a cell is the unit a character generator places,
      // so a boiled cell is the same glyph a dot to the left — not a glyph with
      // its own dots scrambled, which is noise rather than an unsteady hand.
      const j = boil === null ? 0 : (r * cols + col) * 2
      const x = col * CELL_W + (boil === null ? 0 : boil[j])
      const y = r * CELL_H + (boil === null ? 0 : boil[j + 1])
      const shade = SHADES[ch]
      const mosaic = mosaicRows(ch)
      if (shade !== undefined) {
        if (!dither.has(shade))
          dither.set(shade, g.createPattern(shadeTile(shade), 'repeat'))
        const pattern = dither.get(shade)
        if (pattern) {
          g.fillStyle = pattern
          g.fillRect(x, y, CELL_W, CELL_H)
          g.fillStyle = '#fff'
        }
      } else if (mosaic !== null) {
        const bh = CELL_H / mosaic.length
        const bw = CELL_W / mosaic[0].length
        mosaic.forEach((blocks, br) => {
          for (let bc = 0; bc < blocks.length; bc++) {
            if (blocks[bc] === '1') g.fillRect(x + bc * bw, y + br * bh, bw, bh)
          }
        })
      } else {
        g.fillText(ch, x + CELL_W / 2, y + CELL_H / 2)
      }
    })
  })
  // The block cursor a teletype leaves sitting where it stopped printing. It
  // goes in before the threshold so it is just another lit run of dots.
  const last = rows.length - 1
  if (cursor) {
    g.fillRect(
      rows[last].length * CELL_W + 1,
      last * CELL_H + 1,
      CELL_W - 2,
      CELL_H - 2,
    )
  }

  const img = g.getImageData(0, 0, grid.width, grid.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const on = img.data[i + 3] >= INK ? 242 : 8
    img.data[i] = on
    img.data[i + 1] = on
    img.data[i + 2] = on
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return grid
}

// What a card is drawn from: the dot grid, and its size once every dot is a
// whole number of card pixels. Built once and kept, because a crawl re-blits it
// thirty times a second and rasterising, thresholding and scaling the grid
// again each time would be the entire cost of an otherwise cheap animation.
interface TeletypeBuild {
  grid: OffscreenCanvas
  // Card pixels per dot, and the block's size once scaled by it.
  zoom: number
  w: number
  h: number
}

// Rows between the tail of a crawl and its head coming back round. Without a
// gap a repeating message runs into itself and reads as one long line.
const CRAWL_GAP_ROWS = 2
// A crawling card is not bounded by the frame — being longer than the screen is
// the point — so only the memory is: this is far past any card a person types
// into a 1000-character box, and it keeps a paste of nothing but newlines from
// asking for a canvas measured in tens of thousands of pixels.
const CRAWL_MAX_ROWS = 250

// `boilPhase` null is a still hand, `garblePhase` null a clean feed. Anything
// else is which redraw this is — the dimensions come out identical either way
// (the offsets move dots inside the grid and a garble swaps a cell for a cell,
// neither resizes anything), which is what lets a card be rebuilt every tick
// without the block changing size or the crawl changing period.
export function buildTeletype(
  text: string,
  crawl = false,
  boilPhase: number | null = null,
  garblePhase: number | null = null,
): TeletypeBuild {
  // A cell holds one character, whatever it took to write it down: a glyph
  // outside the BMP is one cell, not two half-surrogates rendered as tofu.
  const page = wrapText(text, MAX_COLS)
    .slice(0, crawl ? CRAWL_MAX_ROWS : MAX_ROWS)
    .map(line => Array.from(line))
  const rows = garblePhase === null ? page : garbleRows(page, garblePhase)
  const widest = rows.reduce((n, r) => Math.max(n, r.length), 0)
  // One spare column for the cursor, so a line that fills the row still has
  // somewhere to put it.
  const cols = Math.min(MAX_COLS + 1, Math.max(MIN_COLS, widest + 1))
  const grid = dotGrid(
    rows,
    cols,
    true,
    boilPhase === null ? null : boilOffsets(cols, rows.length, boilPhase),
  )

  // Whole dots only. A fractional scale would make some dots a pixel wider
  // than their neighbours, which reads as a blurry font rather than a coarse
  // one — and coarse is what we are after.
  //
  // A crawl is sized on width alone. Fitting the height too is what a still
  // card wants, but for a rolling one it would shrink the type to nothing to
  // fit a page that was always going to be taller than the frame.
  const fit = crawl
    ? USABLE_W / grid.width
    : Math.min(USABLE_W / grid.width, USABLE_H / grid.height)
  const zoom = Math.max(1, Math.floor(fit))
  return { grid, zoom, w: grid.width * zoom, h: grid.height * zoom }
}

// How far a crawl travels before it is back where it started.
export const crawlPeriod = (build: TeletypeBuild): number =>
  build.h + CRAWL_GAP_ROWS * CELL_H * build.zoom

const blank = (card: OffscreenCanvas): OffscreenCanvasRenderingContext2D => {
  const g = card.getContext('2d')
  if (!g) throw new Error('no 2d context')
  g.fillStyle = '#080808'
  g.fillRect(0, 0, CARD_W, CARD_H)
  g.imageSmoothingEnabled = false
  return g
}

// The still card: the block, centered.
export function drawBuild(card: OffscreenCanvas, build: TeletypeBuild): void {
  const g = blank(card)
  g.drawImage(
    build.grid,
    (CARD_W - build.w) / 2,
    (CARD_H - build.h) / 2,
    build.w,
    build.h,
  )
}

// The rolling card, `offset` pixels up from the bottom of the frame. Repeats
// are stacked a period apart so the head follows the tail with no dead screen
// in between — a short message becomes a rolling announcement rather than one
// line that vanishes for ten seconds.
export function drawCrawl(
  card: OffscreenCanvas,
  build: TeletypeBuild,
  offset: number,
): void {
  const g = blank(card)
  const period = crawlPeriod(build)
  const x = (CARD_W - build.w) / 2
  for (let y = CARD_H - (offset % period); y > -build.h; y -= period) {
    g.drawImage(build.grid, x, y, build.w, build.h)
  }
}

// Draw `text` into a card, reusing the canvas — the typing reveal redraws
// several times a second and a fresh 1280x960 canvas per frame is pure churn.
export function drawTeletype(
  card: OffscreenCanvas,
  text: string,
): OffscreenCanvas {
  drawBuild(card, buildTeletype(text))
  return card
}

export const teletype = (text: string): OffscreenCanvas =>
  drawTeletype(makeTeletypeCard(), text)
