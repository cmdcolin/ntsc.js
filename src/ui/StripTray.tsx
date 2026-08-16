import { useRef, useState } from 'react'

import { cx } from './cx'
import { useStripApi } from './StripContext'
import { StripRow } from './StripRow'
import styles from './StripTray.module.css'
import ui from './ui.module.css'

import type { MutateAmount } from './mutate'

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

// A duration as the tray says it. Rounded *up*, which is the whole reason this
// is a function rather than `Math.round` twice: a take of four hundred
// milliseconds reads `0s` when rounded to nearest, which reads as no take at
// all — and `⎙ render 0s` beside it reads as a button that does nothing, on a
// take that renders perfectly well. Overstating a second is the harmless
// direction; understating a whole take to nothing is not.
const secs = (n: number): string => `${Math.ceil(n)}s`

// What the ⎙ button says it is about to render the length of. A table rather
// than a nested ternary because the four cases are four sentences and the
// track's name only appears in one of them — and because `default` is the one
// worth writing a full sentence for: it is the only branch where the number on
// the button was chosen by nothing at all, so it is the only one that has to
// say what would change it.
export type RenderFrom = 'take' | 'track' | 'rundown' | 'default'

const RENDER_FROM: Record<RenderFrom, (track: string) => string> = {
  take: () => ' — the recorded take, hands and all',
  track: track => ` — the length of ${track}`,
  rundown: () => ' — the whole rundown, at the lengths its rows hold for',
  default: () => ' — lay out a rundown or pick a track and it renders that',
}

export function StripTray(props: {
  // Takes the jitter amount for a shake row, or nothing for an ordinary
  // capture. The tray cannot build a session string itself — that needs the
  // whole app's state — so both go out through one callback.
  onCapture: (jitter?: MutateAmount) => void
  // The music, if any: what is loaded, and the same picker the Sound stage
  // opens. A second door to one hook rather than a second hook — a rundown is
  // where you decide you want a track, and the panel's own picker is four
  // sections down behind a fold.
  track: { name: string; onPick: () => void }
  // The offline render. `seconds` is how long a take would be, and `from` is
  // which of the four answers it came from — a recorded performance's length
  // first, then the loaded track's (a piece cut to a song is as long as the
  // song), then the rundown's own, and a default under all three.
  //
  // Named rather than inferred from the other props, because the button has to
  // say what it is about to render the length *of* and it cannot work that out:
  // a tray with a track picked and a rundown laid out has two lengths in it and
  // one of them is the answer. The tooltip said "pick a track and it renders
  // the length of the song" for as long as there was nothing else it could be,
  // which stopped being true the day the rundown could answer.
  render: {
    progress: number | null
    seconds: number
    from: RenderFrom
    start: () => void
    cancel: () => void
  }
  // The automation tape (docs/EDITOR.md › _Live input has no offline meaning_).
  // ● starts the walk with the tape rolling, ■ seals it, and ⎙ replays it into
  // the render — so a performance made at whatever rate the tab managed comes
  // back as a file at 60.
  record: {
    rolling: boolean
    seconds: number
    start: () => void
    stop: () => void
    clear: () => void
  }
}) {
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
              className={cx(ui.btn, styles.transport, api.running && ui.active)}
              onClick={() => {
                if (!api.running) {
                  api.start()
                  return
                }
                api.stop()
                // Whatever started the walk, this is the one button that ends
                // it, so it is the one that has to seal the tape — a ● take
                // stopped from here and left rolling would go on recording the
                // knobs somebody turned after the piece was over and call them
                // part of it. A no-op when nothing is rolling.
                props.record.stop()
              }}
              disabled={rows.length === 0}
              title={api.running ? 'stop the walk' : 'play from the top'}
            >
              {api.running ? '■ stop' : '▶ play'}
            </button>
            {/* ● is ▶ with the tape rolling. Everything a hand does to the board
                while it runs — a slider, a preset, a knob on a controller, a
                morph — is written down against the frame it happened on, and ⎙
                replays it into the render. That is what makes performing and
                rendering the same take rather than two: the picture you played
                at whatever rate the tab managed comes back as a file at 60.

                Its own button rather than a mode on ▶ because they answer
                different questions. ▶ is "show me the piece"; ● is "this one
                counts", which is a thing you decide about one run out of ten.

                And not disabled on an empty tray, which is the one place it
                parts company with ▶: a hand performing over a clip with no
                rundown at all is a take, and it is the take ⎙ rendered before
                there was a rundown to render. `start` on an empty strip stays
                stopped rather than pretending to run, so what ● does there is
                exactly the recording and nothing else. */}
            <button
              className={cx(ui.btn, props.record.rolling && ui.active)}
              onClick={() =>
                props.record.rolling
                  ? props.record.stop()
                  : props.record.start()
              }
              title={
                props.record.rolling
                  ? 'stop, and keep what the hands did'
                  : 'record every control move — with the rundown, if there is one'
              }
            >
              ● rec
            </button>
            {/* The tape, once there is one: what ⎙ is going to replay, and the
                only way to throw it away without recording over it. A bare
                readout rather than a button-looking thing, because for most of
                its life it is a fact rather than a control — the same register
                the seed and the track name are in.

                The digits are held at a fixed width. A take crossing ten
                seconds, or a hundred, would otherwise widen this and slide + row
                and + shake out from under the pointer — the rule the row cards
                already follow one layer in (docs/EDITOR.md › _Nothing in the
                tray moves_). */}
            {props.record.rolling || props.record.seconds <= 0 ? null : (
              <button
                className={cx(ui.bare, styles.tape)}
                onClick={props.record.clear}
                title={`${secs(props.record.seconds)} of recorded control moves — click to throw it away`}
              >
                ⏺
                <span className={styles.tapeLen}>
                  {secs(props.record.seconds)}
                </span>
                ✕
              </button>
            )}
            <button
              className={ui.btn}
              onClick={() => props.onCapture()}
              title="add what is on the board now as a row"
            >
              + row
            </button>
            {/* The third filling, which had a model and a card and no way to
                make one. A shake row keeps whatever is up and jitters the look
                when it fires — so a rundown can wander without naming where it
                is going, which is the whole reason the roll and the shake are
                row kinds rather than buttons. */}
            <button
              className={ui.btn}
              onClick={() => props.onCapture('normal')}
              title="add a row that shakes the look rather than setting one"
            >
              + shake
            </button>
            <button
              className={cx(ui.btn, api.strip.loop && ui.active)}
              onClick={() => api.setLoop(!api.strip.loop)}
              title="come back round at the end, or stop there"
            >
              ↻ loop
            </button>
            {/* Rendering is not recording, which is why both exist. The
                recorder follows the picture in real time; this takes the frames
                away from the screen and writes a file whose timing is the
                simulation's rather than the tab's — faster than real time when
                the GPU allows, slower when it does not, and the same length
                either way. */}
            {props.render.progress === null ? (
              <button
                className={cx(ui.btn, styles.readout)}
                onClick={props.render.start}
                title={`render ${secs(props.render.seconds)} to a constant-framerate MP4${RENDER_FROM[props.render.from](props.track.name)}`}
              >
                ⎙ render {secs(props.render.seconds)}
              </button>
            ) : (
              <button
                className={cx(ui.btn, styles.readout, ui.active)}
                onClick={props.render.cancel}
                title="stop the render and keep the picture"
              >
                {Math.round(props.render.progress * 100)}% · cancel
              </button>
            )}
            {/* ▶ takes the track from the top with the walk, so a rundown and
                the song it was cut to start together. The name is shown because
                that is the whole confirmation there is that pressing play will
                start anything. */}
            <button
              className={cx(ui.bare, styles.track)}
              onClick={props.track.onPick}
              title={
                props.track.name === ''
                  ? 'pick a track — play then starts it with the rundown'
                  : `${props.track.name} — starts from the top with the rundown`
              }
            >
              ♪ {props.track.name === '' ? 'no track' : props.track.name}
            </button>
            {/* The rundown's own walk back, and a button rather than ctrl+z on
                purpose. ctrl+z already means "put that knob back" and is used
                constantly; making it mean "put that row back" when the pointer
                happens to be down here is the version of undo people stop
                trusting. Two stacks, two reaches. */}
            <span className={styles.walk}>
              <button
                className={cx(ui.bare, styles.step)}
                onClick={() => api.undo()}
                disabled={!api.canUndo}
                title="undo the last change to the rundown"
              >
                ↶
              </button>
              <button
                className={cx(ui.bare, styles.step)}
                onClick={() => api.redo()}
                disabled={!api.canRedo}
                title="redo"
              >
                ↷
              </button>
            </span>
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
