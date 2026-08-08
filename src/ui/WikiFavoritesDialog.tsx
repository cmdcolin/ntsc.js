import { commonsPageUrl } from '../sources/commons'
import { Dialog } from './Dialog'
import ui from './ui.module.css'
import { favoriteGroups, favoriteLabel } from './wikiFavorites'
import styles from './WikiFavorites.module.css'

import type { StashSlot } from './fileStash'
import type { WikiFavorite } from './wikiFavorites'

// The rolls you starred. A Commons channel is a pool rather than a picture, so
// every pick out of one is on borrowed time — the next click on that caption
// replaces it — and this is the list of the ones that were worth keeping.
//
// A dialog rather than a fold of the sidebar, for the reason the clip shelf is
// one: browsing is a few seconds with your eye on a list, and a permanent fold
// would cost that height in every session including the ones that never open it.
// Nothing here needs an account, and nothing here is a copy of a file — a
// favourite is a title, resolved against Commons at the moment it is played.

const other = (slot: StashSlot): StashSlot => (slot === 'a' ? 'b' : 'a')

function FavoriteRow(props: {
  fave: WikiFavorite
  slot: StashSlot
  onPlay: (fave: WikiFavorite, slot: StashSlot) => void
  onForget: (title: string) => void
}) {
  const { fave, slot } = props
  const label = favoriteLabel(fave)
  return (
    <div className={styles.row}>
      <button
        className={styles.name}
        title={`show ${label} on source ${slot.toUpperCase()} — one request to Commons`}
        onClick={() => props.onPlay(fave, slot)}
      >
        {label}
      </button>
      <button
        className={styles.rowBtn}
        title={`show ${label} on source ${other(slot).toUpperCase()} instead`}
        onClick={() => props.onPlay(fave, other(slot))}
      >
        {other(slot).toUpperCase()}
      </button>
      {/* The credit. Commons files carry a licence and a photographer, and
          nothing else in this app leads to either — so every row keeps a way
          through to the file's own page, in a new tab so a set is never
          navigated away from. */}
      <a
        className={styles.rowBtn}
        href={commonsPageUrl(fave.title)}
        target="_blank"
        rel="noreferrer"
        title={`open ${label} on Commons — who shot it, and under which licence`}
      >
        ↗
      </a>
      <button
        className={styles.rowBtn}
        title={`unstar ${label}`}
        aria-label={`unstar ${label}`}
        onClick={() => props.onForget(fave.title)}
      >
        ★
      </button>
    </div>
  )
}

export function WikiFavoritesDialog(props: {
  // Which deck a plain click plays into. Every row can reach the other one from
  // its second button, so a two-deck set never has to reopen this to load B.
  slot: StashSlot
  faves: readonly WikiFavorite[]
  onPlay: (fave: WikiFavorite, slot: StashSlot) => void
  onForget: (title: string) => void
  onClose: () => void
}) {
  const groups = favoriteGroups(props.faves)
  return (
    <Dialog
      title={`Commons favorites — show on source ${props.slot.toUpperCase()}`}
      size="prose"
      onClose={props.onClose}
    >
      {props.faves.length === 0 ? (
        <div className={ui.hint}>
          nothing starred yet. Pick one of the Commons channels as a source, and
          the ★ beside the caption keeps whatever it rolled — the caption itself
          rolls the next one, which is what makes a picture you liked worth
          pinning before you go looking for another.
        </div>
      ) : (
        <div className={styles.list}>
          {groups.map(group => (
            <div key={group.channel === '' ? 'loose' : group.channel}>
              <div className={styles.head}>{group.label}</div>
              {group.items.map(fave => (
                <FavoriteRow
                  key={fave.title}
                  fave={fave}
                  slot={props.slot}
                  onPlay={props.onPlay}
                  onForget={props.onForget}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* What a star is, said once: not a download, and not a url either. Worth
          stating because both of the things it is not would behave differently —
          a copy would survive Commons deleting the file, and a stored url would
          break the day the thumbnailer changed its mind. */}
      <div className={ui.hint}>
        a star keeps the file’s name, not the picture: playing one asks Commons
        for it again, so it comes back at whatever size this app asks for today
        and costs nothing on disk. Kept in this browser — a shared link carries
        the look, not the shelf.
      </div>
    </Dialog>
  )
}
