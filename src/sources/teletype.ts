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

// A card as its owner set it: what it says, and whether it rolls up the frame
// instead of sitting still. One value rather than two loose fields, because
// every layer between the dialog and the query string has to carry it whole.
export interface TeletypeCard {
  text: string
  crawl: boolean
}

export const TELETYPE_DEFAULT: TeletypeCard = {
  text: 'PLEASE STAND BY',
  crawl: false,
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
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    // A line that already fits is taken exactly as typed. Re-flowing it would
    // be invisible in prose and fatal in a drawing, where the runs of spaces
    // between the blocks are the picture.
    if (para.length <= cols) {
      out.push(para)
      continue
    }
    let line = ''
    for (const word of para.split(/\s+/).filter(w => w !== '')) {
      let rest = word
      while (rest.length > cols) {
        if (line !== '') {
          out.push(line)
          line = ''
        }
        out.push(rest.slice(0, cols))
        rest = rest.slice(cols)
      }
      // An oversized word that divided evenly has nothing left to place, and
      // starting a line with it would leave a blank one behind.
      if (rest === '') continue
      if (line === '') line = rest
      else if (line.length + 1 + rest.length <= cols) line += ` ${rest}`
      else {
        out.push(line)
        line = rest
      }
    }
    out.push(line)
  }
  return out
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
// being drawn on.
export function dotGrid(
  rows: string[][],
  cols: number,
  cursor = true,
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
    const y = r * CELL_H
    // Per character, not per line: the cell grid is the layout, and letting the
    // font's own advance place them would put the dots between columns.
    row.forEach((ch, col) => {
      // A drawn page is mostly holes, and a space is a glyph like any other as
      // far as the rasteriser is concerned — measuring one 960 times a redraw
      // is the whole cost of painting on a full page.
      if (ch === ' ') return
      const x = col * CELL_W
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
export interface TeletypeBuild {
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

export function buildTeletype(text: string, crawl = false): TeletypeBuild {
  // A cell holds one character, whatever it took to write it down: a glyph
  // outside the BMP is one cell, not two half-surrogates rendered as tofu.
  const rows = wrapText(text, MAX_COLS)
    .slice(0, crawl ? CRAWL_MAX_ROWS : MAX_ROWS)
    .map(line => Array.from(line))
  const widest = rows.reduce((n, r) => Math.max(n, r.length), 0)
  // One spare column for the cursor, so a line that fills the row still has
  // somewhere to put it.
  const cols = Math.min(MAX_COLS + 1, Math.max(MIN_COLS, widest + 1))
  const grid = dotGrid(rows, cols)

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
