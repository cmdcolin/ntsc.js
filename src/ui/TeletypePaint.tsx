import { useEffect, useRef, useState } from 'react'

import {
  CELL_H,
  CELL_W,
  MAX_COLS,
  PAINT_ROWS,
  SHADE_CHARS,
  cellsToText,
  dotGrid,
  mosaicChar,
  sextantRows,
  textToCells,
} from '../sources/teletype'
import { cx } from './cx'
import styles from './TeletypePaint.module.css'
import ui from './ui.module.css'

import type { PointerEvent } from 'react'

// Drawing on the card. Half of the SAA5050's character set was mosaic — the
// cell split into a 2x3 grid of blocks — for exactly this reason: a teletext
// page was drawn on as often as it was written on, and every weather map and
// football table on Ceefax was somebody pushing blocks around a 40x24 grid.
// This is that editor.
//
// It is not a separate picture format. Every stroke lands back in the card's
// own text as the mosaic character that carries the pattern, so a drawing is
// still a string: it goes through the same box, the same query string and the
// same clipboard as the words do, and it can be half words anyway.
//
// The surface is the card's rasteriser at 1:1 — dotGrid renders one dot per
// canvas pixel and CSS blows it up with nearest-neighbour — so what is under
// the cursor is what the picture will be, at the resolution the picture has,
// rather than a preview that agrees with it most of the time.

// The brushes, in the order they sit on the toolbar. The pen works at block
// resolution (a sixth of a cell); everything else fills the cell it is over,
// which is what makes a drag with one of them a fat stroke.
const BRUSHES = [
  { id: 'pen', label: '✎', title: 'pen — one block at a time' },
  { id: '█', label: '█', title: 'solid — fill the whole cell' },
  ...SHADE_CHARS.map(ch => ({
    id: ch,
    label: ch,
    title: `shade — fill the cell with ${ch}`,
  })),
  { id: 'erase', label: '⌫', title: 'erase — or drag with the right button' },
] as const

type Brush = (typeof BRUSHES)[number]['id']

const BLANK = ['00', '00', '00']

// What a stroke does to the cell under it. The pen and the eraser work on the
// single block they are over and keep the rest of the cell, so long as the cell
// holds a pattern they can read; anything else in there — a letter, a shade, a
// quadrant that doesn't land on thirds — is replaced rather than merged into,
// because there is no sensible way to set one third of a letter.
function paintCell(cell: string, brush: Brush, bx: number, by: number): string {
  if (brush === 'erase') {
    const rows = sextantRows(cell)
    // Nothing to erase a block *out of*: take the whole cell instead, which is
    // what someone rubbing at a letter means by it.
    if (rows === null) return ' '
    return mosaicChar(rows.map((r, i) => (i === by ? withBit(r, bx, '0') : r)))
  }
  if (brush !== 'pen') return brush
  const rows = sextantRows(cell) ?? BLANK
  return mosaicChar(rows.map((r, i) => (i === by ? withBit(r, bx, '1') : r)))
}

const withBit = (row: string, i: number, bit: string): string =>
  i === 0 ? `${bit}${row[1]}` : `${row[0]}${bit}`

// The blocks a straight line between two of them passes through — Bresenham,
// on the 80x72 grid of blocks rather than the 40x24 grid of cells.
//
// A pointer arrives as a handful of samples a second, and at any speed worth
// drawing at those samples are blocks apart: without this a stroke comes out as
// a dotted line, and the faster the hand the more of it is missing.
function* blockLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Generator<[number, number]> {
  const dx = Math.abs(bx - ax)
  const dy = -Math.abs(by - ay)
  const sx = ax < bx ? 1 : -1
  const sy = ay < by ? 1 : -1
  let err = dx + dy
  let [x, y] = [ax, ay]
  for (;;) {
    yield [x, y]
    if (x === bx && y === by) return
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

export function TeletypePaint(props: {
  text: string
  onChange: (text: string) => void
  // Pushed before each stroke, so undo steps by stroke rather than by block.
  onSnapshot: () => void
}) {
  const [brush, setBrush] = useState<Brush>('pen')
  const canvas = useRef<HTMLCanvasElement>(null)
  const { cells, tail } = textToCells(props.text, PAINT_ROWS)

  // Redrawn only when the text actually changed: a drag spends most of its
  // moves inside the block it is already in, and those set the same string,
  // which React drops before it ever reaches here.
  useEffect(() => {
    const el = canvas.current
    const g = el?.getContext('2d')
    if (!el || !g) return
    const grid = dotGrid(
      textToCells(props.text, PAINT_ROWS).cells,
      MAX_COLS,
      false,
    )
    g.drawImage(grid, 0, 0)
  }, [props.text])

  // Where the last event landed, so a move can be joined to it. Held even when
  // it was off the surface: a stroke that swings outside and comes back should
  // come back along the line it actually travelled, not from the edge.
  const from = useRef<[number, number] | null>(null)

  // Which block a pointer is over, in blocks from the top-left of the page.
  // The canvas is laid out by CSS and scales with the dialog, so the event's
  // own pixels are not the canvas's — everything goes through fractions of the
  // box. Not clamped to the page: an off-surface point is a real position for
  // the line to be drawn from, and the blocks are clipped rather than the line.
  const at = (e: PointerEvent): [number, number] | null => {
    const el = canvas.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    return [
      Math.floor(((e.clientX - box.left) / box.width) * MAX_COLS * 2),
      Math.floor(((e.clientY - box.top) / box.height) * PAINT_ROWS * 3),
    ]
  }

  const paint = (e: PointerEvent, joined: boolean) => {
    const to = at(e)
    if (to === null) return
    const start = (joined ? from.current : null) ?? to
    from.current = to
    // Right button erases whatever the toolbar says, the way every paint
    // program has since the first one — it is the fastest fix for a bad stroke
    // that isn't undo.
    const b = e.buttons & 2 ? 'erase' : brush
    let changed = false
    for (const [x, y] of blockLine(start[0], start[1], to[0], to[1])) {
      if (x < 0 || y < 0 || x >= MAX_COLS * 2 || y >= PAINT_ROWS * 3) continue
      const [c, r] = [x >> 1, Math.floor(y / 3)]
      const next = paintCell(cells[r][c], b, x & 1, y % 3)
      if (next === cells[r][c]) continue
      cells[r][c] = next
      changed = true
    }
    if (changed) props.onChange(cellsToText(cells, tail))
  }

  return (
    <>
      <div className={styles.tools}>
        {BRUSHES.map(b => (
          <button
            key={b.id}
            className={cx(styles.tool, brush === b.id && styles.on)}
            type="button"
            title={b.title}
            aria-pressed={brush === b.id}
            onClick={() => setBrush(b.id)}
          >
            {b.label}
          </button>
        ))}
        <button
          className={cx(ui.btn, ui.btnFlush, styles.clear)}
          type="button"
          title="wipe the page"
          onClick={() => {
            props.onSnapshot()
            props.onChange('')
          }}
        >
          clear
        </button>
      </div>
      <div className={styles.frame}>
        <canvas
          ref={canvas}
          className={styles.surface}
          width={MAX_COLS * CELL_W}
          height={PAINT_ROWS * CELL_H}
          // Every move of a held pointer, captured, so a stroke that wanders off
          // the canvas and comes back is one stroke rather than three.
          onPointerDown={e => {
            if (e.button !== 0 && e.button !== 2) return
            e.currentTarget.setPointerCapture(e.pointerId)
            props.onSnapshot()
            paint(e, false)
          }}
          onPointerMove={e => {
            if (e.buttons !== 0) paint(e, true)
          }}
          onContextMenu={e => e.preventDefault()}
        />
        <div className={styles.grid} />
      </div>
      <p className={ui.hint}>
        Blocks are characters — a drawing is still the card’s text, so it wraps,
        pastes and shares like the words do. Right-drag erases; ⌘/ctrl+Z undoes
        a stroke.
      </p>
    </>
  )
}
