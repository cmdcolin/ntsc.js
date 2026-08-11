import { useRef, useState } from 'react'

import { cx } from './cx'
import { useStripApi } from './StripContext'
import { StripRow } from './StripRow'
import styles from './StripTray.module.css'
import ui from './ui.module.css'

// The rundown, under the picture.
//
// Under it rather than in the panel because a strip is what a hand works during
// a take, and the panel is where a circuit gets dialed in — and because 332px
// does not hold a rundown. Shut, it is one line: the app is what it was before
// the strip existed, which is the property docs/EDITOR.md › _a second page_
// promises in exchange for the strip not being one.
//
// **The drag lives here, not on the card.** Reordering needs every card's
// geometry, and pointer capture has to be taken and released on the same
// element — so the list captures, the list hit-tests, and a card contributes a
// `data-index` and a drag handle. The alternative (capture on the card, listen
// on the list) reads fine and throws on release.
//
// Pointer events rather than HTML5 drag-and-drop, like every other drag in this
// app: `dataTransfer` has no touch support and a drag image that fights
// styling. See the list in docs/EDITOR.md › _Interaction_.

interface Drag {
  from: number
  pointerId: number
  // Where the press landed, so travel can be measured without a second ref.
  x: number
  // Whether it has become a drag. A press that never travels is a click on the
  // card, and treating every press as a drag would make firing a row impossible.
  moved: boolean
}

// How far a pointer must travel before a press is a drag, in px. Not 1: a
// finger drifts while pressing, and a touchscreen would otherwise never
// register a plain tap.
const DRAG_SLOP = 5

export function StripTray(props: { onCapture: () => void }) {
  const api = useStripApi()
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  // Set when a drag actually reordered, and read by the click that follows the
  // pointerup. Without it, dragging a row also fires it — the click still
  // arrives, and the card's whole face is the fire button.
  const swallowClick = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Which card a point is over, hit-tested against the cards themselves rather
  // than by dividing by a width: cards are as wide as their labels, so there is
  // no width to divide by.
  const cardUnder = (clientX: number): number | null => {
    const list = listRef.current
    if (list === null) return null
    for (const card of list.querySelectorAll<HTMLElement>('[data-index]')) {
      const box = card.getBoundingClientRect()
      if (clientX >= box.left && clientX <= box.right) {
        return Number(card.dataset.index)
      }
    }
    return null
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setOver(null)
    if (d === null) return
    if (e.currentTarget.hasPointerCapture(d.pointerId)) {
      e.currentTarget.releasePointerCapture(d.pointerId)
    }
    if (!d.moved) return
    swallowClick.current = true
    const to = cardUnder(e.clientX)
    if (to !== null) api.moveRow(d.from, to)
  }

  const rows = api.strip.rows
  return (
    <div className={cx(styles.tray, open && styles.open)}>
      <div className={styles.bar}>
        <button
          className={cx(ui.bare, styles.disclose)}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className={styles.caret}>{open ? '▾' : '▸'}</span> strip
          <span className={styles.count}>
            {rows.length === 0 ? 'empty' : `${rows.length} rows`}
          </span>
        </button>
        {!open ? null : (
          <>
            <button
              className={cx(ui.btn, api.running && ui.active)}
              onClick={() => (api.running ? api.stop() : api.start())}
              disabled={rows.length === 0}
              title={api.running ? 'stop the walk' : 'play from the top'}
            >
              {api.running ? '■ stop' : '▶ play'}
            </button>
            <button
              className={ui.btn}
              onClick={props.onCapture}
              title="add what is on the board now as a row"
            >
              + row
            </button>
            <button
              className={cx(ui.btn, api.strip.loop && ui.active)}
              onClick={() => api.setLoop(!api.strip.loop)}
              title="come back round at the end, or stop there"
            >
              ↻ loop
            </button>
            {/* Shown rather than hidden, because it is the one number that makes
                a take findable again — a rundown whose rows roll is a different
                video every play, so "which take was that" needs an answer. */}
            <button
              className={cx(ui.bare, styles.seed)}
              onClick={() => api.reseed()}
              title="a new seed — same rundown, different rolls"
            >
              seed {api.strip.seed.toString(36)}
            </button>
          </>
        )}
      </div>
      {!open ? null : rows.length === 0 ? (
        <p className={cx(ui.hint, styles.empty)}>
          A rundown is a list of looks that plays itself. Set the board up,
          press
          <b> + row</b>, and do it again — each row holds for its own count and
          arrives its own way.
        </p>
      ) : (
        <div
          className={styles.list}
          ref={listRef}
          role="list"
          onPointerDown={e => {
            // Only from the handle. The chips and the ✕ are their own actions,
            // and a drag started from one would make them unpressable on a
            // touchscreen, where every press moves a little.
            const handle =
              e.target instanceof Element
                ? e.target.closest('[data-drag]')
                : null
            const index = handle === null ? null : cardUnder(e.clientX)
            if (index === null) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = {
              from: index,
              pointerId: e.pointerId,
              x: e.clientX,
              moved: false,
            }
          }}
          onPointerMove={e => {
            const d = drag.current
            if (d === null) return
            if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_SLOP) return
            d.moved = true
            setOver(cardUnder(e.clientX))
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={e => {
            if (swallowClick.current) {
              swallowClick.current = false
              e.stopPropagation()
              e.preventDefault()
            }
          }}
        >
          {rows.map((row, i) => (
            <StripRow
              key={row.id}
              row={row}
              index={i}
              live={api.row === i}
              dragging={over === i}
            />
          ))}
        </div>
      )}
    </div>
  )
}
