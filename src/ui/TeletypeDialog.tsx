import { useRef, useState } from 'react'

import { MOSAIC_PALETTE, TELETYPE_MAX } from '../sources/teletype'
import { cx } from './cx'
import { Dialog } from './Dialog'
import dlg from './dialog.module.css'
import ui from './ui.module.css'

import type { TeletypeCard } from '../sources/teletype'

// Starters, mostly so the box is never a blank stare. They are also the three
// things a text card on this chain is actually for: the slate a station puts up
// when there is nothing to show, the one a tape puts up when there is nothing
// to lock to, and a stanza with a line break in it.
const STARTERS = ['PLEASE STAND BY', 'NO SIGNAL', 'BE KIND\nREWIND']

export function TeletypeDialog(props: {
  slot: 'a' | 'b'
  initial: TeletypeCard
  onSubmit: (card: TeletypeCard) => void
  onClose: () => void
}) {
  const [text, setText] = useState(props.initial.text)
  const [crawl, setCrawl] = useState(props.initial.crawl)
  const box = useRef<HTMLTextAreaElement>(null)
  const submit = () => props.onSubmit({ text, crawl })
  // Insert at the caret, through the textarea itself: it puts the caret after
  // what it inserted and leaves undo intact, neither of which we get from
  // rewriting the value out from under it. Deprecated but universally
  // implemented; if it ever isn't, the character still lands at the end.
  const insert = (ch: string) => {
    const el = box.current
    el?.focus()
    if (el === null || !document.execCommand('insertText', false, ch)) {
      setText(`${text}${ch}`)
    }
  }
  return (
    <Dialog
      title={`Teletype into source ${props.slot.toUpperCase()}`}
      size="prose"
      onClose={props.onClose}
    >
      <p className={ui.helpText}>
        Type anything. It’s printed onto a text card a character at a time and
        then treated as an ordinary picture, so the bandwidth, ringing and
        dot-crawl controls all chew on the letterforms. Line breaks are kept and
        long lines wrap at 40 columns — a teletext page. ⌘/Ctrl+Enter sends it.
      </p>
      <form
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={box}
          className={dlg.textArea}
          rows={6}
          // Columns are the layout, so a long line scrolls rather than folding
          // somewhere the card itself would not fold it.
          wrap="off"
          maxLength={TELETYPE_MAX}
          placeholder="PLEASE STAND BY"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          data-autofocus
        />
        {/* Half of a teletext character set was mosaic — the cell split into
            blocks — which is what every weather map on Ceefax was drawn with.
            The card paints these itself rather than asking the font, so they
            tile with no seam and land exactly on the dot grid. */}
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
          Blocks draw as dots, not glyphs — build a picture out of them, or
          paste block art from anywhere. Sextant characters (▘ at 2×3) work too.
        </p>
        <label className={dlg.check}>
          <input
            type="checkbox"
            checked={crawl}
            onChange={e => setCrawl(e.target.checked)}
          />
          crawl — roll it up the frame, on repeat, instead of holding still
        </label>
        <div className={dlg.cardRow}>
          <div>
            {STARTERS.map(starter => (
              <button
                key={starter}
                className={ui.btn}
                type="button"
                onClick={() => setText(starter)}
              >
                {starter.replace('\n', ' ')}
              </button>
            ))}
          </div>
          <button className={cx(ui.btn, ui.btnFlush)} type="submit">
            Send
          </button>
        </div>
      </form>
    </Dialog>
  )
}
