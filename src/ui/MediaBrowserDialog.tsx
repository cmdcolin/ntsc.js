import { useState } from 'react'

import { ORIGIN_LABEL, presetsOf } from '../sources/pools'
import { cx } from './cx'
import { Dialog } from './Dialog'
import { formatClock } from './format'
import styles from './MediaBrowser.module.css'
import { CreditLink, OtherSlotButton } from './MediaRow'
import ui from './ui.module.css'
import { useBrowseResults } from './useBrowseResults'

import type { BrowseHit, PoolOrigin, PoolRef } from '../sources/pools'
import type { StashSlot } from './fileStash'

// Search Wikimedia Commons and archive.org, and *look* before taking one.
//
// The two random sources beside this in the picker are gambles by design: they
// roll something out of a curated pool and the caption is the first you hear of
// what it was. That is the right gesture mid-set and the wrong one everywhere
// else, and until this dialog existed it was the only gesture there was — eleven
// dropdown entries, each a mood you could not look into, and on archive.org a
// commitment to a download of tens of megabytes before you could see the frame.
//
// Two things make the dialog possible rather than merely nicer, and both are
// measured facts about the APIs (sources/commons.ts, sources/archive.ts):
//
//   Ranked search works where random search does not. `sort=random` throws
//     relevance away, which is why the pools had to be hand-curated: a loose
//     query sampled uniformly returns a Greek vase and a teaspoon. Sorted by
//     relevance, an arbitrary phrase is finally worth offering, so the field
//     below is the capability the roll structurally cannot have.
//
//   A thumbnail costs nothing. Commons renders a poster frame for a clip as
//     readily as for a still, and archive.org has an image endpoint that is no
//     part of the download. Two dozen results cost one search either way.
//
// The curated pools did not go away; they are the preset buttons. A name like
// "Marble busts" now leads somewhere you can see, which is more than it could do
// as a line in a dropdown.

const ORIGINS: readonly PoolOrigin[] = ['commons', 'archive']

// What the two tabs cost, said once each. The archive.org line is the one that
// has to be there: a click on one of its results downloads the whole clip before
// anything appears, and seconds of apparently nothing is how a working feature
// reads as a broken one.
const ORIGIN_NOTE: Record<PoolOrigin, string> = {
  commons:
    'photographs and short clips, freely licensed. Plays as soon as it is picked.',
  archive:
    'tape idents, commercials, industrial film. archive.org will not serve byte ranges, so picking one downloads the whole clip first — a few seconds, sometimes twenty.',
}

function Result(props: {
  hit: BrowseHit
  slot: StashSlot
  kept: boolean
  onPlay: (ref: PoolRef, slot: StashSlot) => void
  onKeep: (ref: PoolRef, label: string) => void
}) {
  const { hit, slot } = props
  return (
    <div className={styles.cell}>
      <button
        className={styles.shot}
        title={`show ${hit.label} on source ${slot.toUpperCase()}`}
        onClick={() => props.onPlay(hit, slot)}
      >
        {/* No crossOrigin: this is an <img> in the page and never a texture
            upload, so tainting is not a question it has to answer — and asking
            for anonymous CORS here would fail on archive.org's image endpoint
            for nothing.

            No `loading="lazy"` either, which is the obvious thing to want on a
            grid and is wrong inside a dialog. A lazy image is evaluated against
            the viewport when it is inserted, and on the first search these are
            inserted into a <dialog> that is on its way to the top layer — so
            Firefox decides they are not visible and does not look again until
            something scrolls. Measured: the first search after opening the
            browser rendered 24 empty boxes and stayed that way. Two dozen
            240px thumbnails is not the case lazy loading is for. */}
        <img src={hit.thumb} alt="" />
      </button>
      <div className={styles.label} title={hit.label}>
        {hit.label}
      </div>
      <div className={styles.acts}>
        {/* Which of the two it is, and how long it runs where the listing said.
            A poster frame looks exactly like a photograph, and a clip is the one
            that brings a timeline, a cue and a speed control with it — and the
            one whose length the picture cannot show. A fifteen-second ident and
            a twenty-minute reel are the same thumbnail. */}
        <span className={styles.mark} aria-hidden>
          {hit.kind === 'video'
            ? `▶ ${hit.seconds === null ? 'clip' : formatClock(hit.seconds)}`
            : 'still'}
        </span>
        <OtherSlotButton
          slot={slot}
          label={hit.label}
          onPlay={to => props.onPlay(hit, to)}
          className={styles.act}
        />
        <button
          className={cx(styles.act, props.kept && styles.actOn)}
          title={
            props.kept
              ? `${hit.label} is on your clip shelf — click to take it off`
              : `keep ${hit.label} on your clip shelf without playing it`
          }
          aria-pressed={props.kept}
          onClick={() => props.onKeep(hit, hit.label)}
        >
          {props.kept ? '★' : '☆'}
        </button>
        <CreditLink
          origin={hit.origin}
          href={hit.page}
          label={hit.label}
          className={styles.act}
        />
      </div>
    </div>
  )
}

export function MediaBrowserDialog(props: {
  // Which deck a plain click plays into. Every result can reach the other one
  // from its second button, so a two-deck set never has to reopen this to load
  // B.
  slot: StashSlot
  // Whether a result is already on the clip shelf, asked per row rather than
  // handed over as a list: the shelf is the app's state and this dialog holds
  // none of it.
  kept: (ref: PoolRef) => boolean
  onPlay: (ref: PoolRef, slot: StashSlot) => void
  onKeep: (ref: PoolRef, label: string) => void
  onClose: () => void
}) {
  const [origin, setOrigin] = useState<PoolOrigin>('commons')
  const [query, setQuery] = useState('')
  // What was last actually asked for, as opposed to what is in the field. The
  // two differ while someone is typing, and it is `asked` the search keys on, so
  // a request goes out on Enter or a preset and never per keystroke — each one is
  // a request to somebody else's API.
  const [asked, setAsked] = useState('')
  // Everything about the results, as one value: the four states are exclusive
  // and the union says so (useBrowseResults.ts). Switching tabs re-asks the same
  // phrase of the other archive, which is the comparison the tabs exist for.
  const found = useBrowseResults(origin, asked)

  const run = (phrase: string) => {
    setQuery(phrase)
    setAsked(phrase)
  }

  return (
    <Dialog
      title={`Browse — show on source ${props.slot.toUpperCase()}`}
      size="prose"
      onClose={props.onClose}
    >
      <div className={styles.tabs}>
        {ORIGINS.map(o => (
          <button
            key={o}
            className={cx(styles.tab, o === origin && styles.tabOn)}
            aria-pressed={o === origin}
            onClick={() => setOrigin(o)}
          >
            {ORIGIN_LABEL[o]}
          </button>
        ))}
      </div>

      <form
        className={styles.search}
        onSubmit={e => {
          e.preventDefault()
          run(query)
        }}
      >
        <input
          className={styles.field}
          type="search"
          value={query}
          placeholder={`search ${ORIGIN_LABEL[origin]}`}
          aria-label={`search ${ORIGIN_LABEL[origin]}`}
          onChange={e => setQuery(e.target.value)}
        />
        <button className={cx(ui.btn, ui.btnFlush)} type="submit">
          search
        </button>
      </form>

      {/* The pools a random pick draws from, as somewhere to start. Worth having
          in front of an empty field: an arbitrary phrase can return a page of
          scanned documents, where every one of these has been run against the
          live API and returns material this app can use. */}
      <div className={styles.presets}>
        {presetsOf(origin).map(preset => (
          <button
            key={preset.label}
            className={styles.preset}
            title={`search ${ORIGIN_LABEL[origin]} for ${preset.label.toLowerCase()} — one of the pools a random pick rolls out of`}
            onClick={() => run(preset.query)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {found.status === 'busy' ? (
        <div className={ui.hint}>searching {ORIGIN_LABEL[origin]}…</div>
      ) : found.status === 'failed' ? (
        <div className={cx(ui.hint, ui.warn)}>{found.error}</div>
      ) : found.status === 'idle' ? (
        <div className={ui.hint}>
          type a phrase, or take one of the pools above. Results are ranked, so
          words that would be useless to a random pick work here — which is the
          whole reason this is not another entry in the dropdown.
        </div>
      ) : found.hits.length === 0 ? (
        <div className={ui.hint}>nothing came back for “{asked}”</div>
      ) : (
        <div className={styles.grid}>
          {found.hits.map(hit => (
            <Result
              key={`${hit.origin}\n${hit.title}`}
              hit={hit}
              slot={props.slot}
              kept={props.kept(hit)}
              onPlay={props.onPlay}
              onKeep={props.onKeep}
            />
          ))}
        </div>
      )}

      <div className={ui.hint}>{ORIGIN_NOTE[origin]}</div>
    </Dialog>
  )
}
