import { useEffect, useRef, useState } from 'react'

import { MOSAIC_PALETTE, clampCardText } from '../sources/teletype'
import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import { TeletypePaint } from './TeletypePaint'
import ui from './ui.module.css'

import type { TeletypeCard } from '../sources/teletype'

// Starters, mostly so the box is never a blank stare. They are also the three
// things a text card on this chain is actually for: the slate a station puts up
// when there is nothing to show, the one a tape puts up when there is nothing
// to lock to, and a stanza with a line break in it.
const STARTERS = ['PLEASE STAND BY', 'NO SIGNAL', 'BE KIND\nREWIND']

// How many strokes back you can go. Deep enough to rescue a drawing from a bad
// drag, shallow enough that the whole stack is a few pages of text.
const UNDO_DEPTH = 50

export function TeletypeDialog(props: {
  slot: 'a' | 'b'
  initial: TeletypeCard
  // Applied as it is edited, and only when this slot is *already* showing a
  // card — see retypeTeletype. It is what makes drawing feel like drawing:
  // the block lands on the picture at the same time as on the page.
  onLive: (card: TeletypeCard) => void
  onSubmit: (card: TeletypeCard) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'type' | 'draw'>('type')
  const [text, setText] = useState(props.initial.text)
  const [crawl, setCrawl] = useState(props.initial.crawl)
  const [boil, setBoil] = useState(props.initial.boil)
  const [garble, setGarble] = useState(props.initial.garble)
  const box = useRef<HTMLTextAreaElement>(null)
  // Snapshots of the text, one per stroke. A ref rather than state: nothing
  // renders from it, and it has to survive the switch between the two modes.
  const undo = useRef<string[]>([])

  const edit = (next: Partial<TeletypeCard>) => {
    const card = { text, crawl, boil, garble, ...next }
    setText(card.text)
    setCrawl(card.crawl)
    setBoil(card.boil)
    setGarble(card.garble)
    props.onLive(card)
  }
  const snapshot = () => {
    undo.current.push(text)
    if (undo.current.length > UNDO_DEPTH) undo.current.shift()
  }
  const undoStroke = () => {
    const was = undo.current.pop()
    if (was !== undefined) edit({ text: was })
  }
  // Read through a ref so the listener below is attached once per mode rather
  // than re-attached on every stroke, and still sees the current text.
  const latest = useRef(undoStroke)
  latest.current = undoStroke

  // ⌘/ctrl+Z while drawing. On the window and in the capture phase, ahead of
  // the app's own undo (useShortcuts), which is bound the same way and means
  // the controls by it — with a drawing open and a pen in hand, Z means the
  // last stroke, and only one of the two can have it.
  //
  // Only while drawing: the type tab is a textarea, and its own undo stack is
  // a better one than anything kept here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        mode === 'draw' &&
        e.key.toLowerCase() === 'z' &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault()
        e.stopPropagation()
        latest.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode])

  // Insert at the caret, through the textarea itself: it puts the caret after
  // what it inserted and leaves undo intact, neither of which we get from
  // rewriting the value out from under it. Deprecated but universally
  // implemented; if it ever isn't, the character still lands at the end.
  const insert = (ch: string) => {
    const el = box.current
    el?.focus()
    if (el === null || !document.execCommand('insertText', false, ch)) {
      edit({ text: text + ch })
    }
  }

  return (
    <Dialog
      title={`Teletype into source ${props.slot.toUpperCase()}`}
      // The page is 40 cells across whatever it is shown at, so a card wide
      // enough to draw on is one where a block is a target rather than a speck.
      size={mode === 'draw' ? 'paint' : 'prose'}
      onClose={props.onClose}
    >
      <div className={dlg.tabs}>
        {(['type', 'draw'] as const).map(m => (
          <button
            key={m}
            className={cx(dlg.tab, mode === m && dlg.tabOn)}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
          >
            {m === 'type' ? '✎ type' : '▚ draw'}
          </button>
        ))}
      </div>
      <form
        onSubmit={e => {
          e.preventDefault()
          props.onSubmit({ text, crawl, boil, garble })
        }}
      >
        {mode === 'type' ? (
          <>
            <p className={ui.helpText}>
              Type anything. It lands on the card as you go and is then treated
              as an ordinary picture, so the bandwidth, ringing and dot-crawl
              controls all chew on the letterforms. Line breaks are kept and
              long lines wrap at 40 columns — a teletext page.
            </p>
            <textarea
              ref={box}
              className={dlg.textArea}
              rows={6}
              // Columns are the layout, so a long line scrolls rather than
              // folding somewhere the card itself would not fold it.
              wrap="off"
              placeholder="PLEASE STAND BY"
              value={text}
              onChange={e => edit({ text: clampCardText(e.target.value) })}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  props.onSubmit({ text, crawl, boil, garble })
                }
              }}
              data-autofocus
            />
            {/* Half of a teletext character set was mosaic — the cell split
                into blocks — which is what every weather map on Ceefax was
                drawn with. The card paints these itself rather than asking the
                font, so they tile with no seam and land on the dot grid. */}
            <div className={dlg.chips}>
              {MOSAIC_PALETTE.map(ch => (
                <button
                  key={ch}
                  className={dlg.chip}
                  type="button"
                  title={`insert ${ch}`}
                  onClick={() => insert(ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
            <p className={ui.hint}>
              Blocks draw as dots, not glyphs — or use the draw tab and push
              them around with a cursor, which is what a teletext page was made
              on. Pasted block art works too.
            </p>
          </>
        ) : (
          <TeletypePaint
            text={text}
            onChange={next => edit({ text: next })}
            onSnapshot={snapshot}
          />
        )}
        <label className={dlg.check}>
          <input
            type="checkbox"
            checked={crawl}
            onChange={e => edit({ crawl: e.target.checked })}
          />
          crawl — roll it up the frame, on repeat, instead of holding still
        </label>
        {/* The card is redrawn eight times a second with every cell's dots
            landing up to a dot off. It is one card — the words and the drawing
            don't change, and a link still carries exactly this — but a chain
            fed a still card gives still artifacts, and a boiling one has to
            decide the ringing and the dot crawl again every frame. */}
        <label className={dlg.check}>
          <input
            type="checkbox"
            checked={boil}
            onChange={e => edit({ boil: e.target.checked })}
          />
          boil — redraw it by an unsteady hand, so the strokes crawl
        </label>
        {/* Teletext arrived as characters in the vertical blanking, seven bits
            and a parity bit each, with nothing to ask for a resend: a bit that
            arrived wrong stayed wrong until the row came round again. Holes
            where parity caught it, wrong letters where it didn't, and blocks
            for the rest of a row whose control code took the hit. */}
        <label className={dlg.check}>
          <input
            type="checkbox"
            checked={garble}
            onChange={e => edit({ garble: e.target.checked })}
          />
          garble — receive it over a bad wire, so the page keeps misspelling
          itself
        </label>
        <div className={dlg.cardRow}>
          <div>
            {STARTERS.map(starter => (
              <button
                key={starter}
                className={ui.btn}
                type="button"
                onClick={() => {
                  snapshot()
                  edit({ text: starter })
                }}
              >
                {starter.replace('\n', ' ')}
              </button>
            ))}
          </div>
          {/* The card is already on screen; this sends it back to the printer
              to be typed out again from nothing, which is the flourish the
              source is for and the only thing left that a live edit doesn't
              do. */}
          <button
            className={cx(ui.btn, ui.btnFlush)}
            type="submit"
            title="print it again, a character at a time"
          >
            Print
          </button>
        </div>
      </form>
    </Dialog>
  )
}
