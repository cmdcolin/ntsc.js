// The rolls worth keeping. A Commons channel is a pool, so every pick out of one
// is a picture you may never see again — the option names the pool and the next
// click replaces what came out of it — and starring is the one thing that makes a
// roll survive the next roll.
//
// A favourite is a *title* and nothing more resolvable than that. Storing the
// thumbnail url would be storing a rendering: the thumbnailer's width buckets
// change, a file gets overwritten by a better scan, a transcode ladder is
// rebuilt, and the url that worked the day it was starred 404s a year later. The
// title is the identity Commons itself keys on, and resolving it costs one
// request at the moment a favourite is played (`resolveCommons`) — which is the
// same request a roll makes anyway.
//
// Everything above `── the store ──` is list algebra over that, tested in
// wikiFavorites.test.ts; below it is the localStorage half, the same split
// clipLibrary.ts uses.

import {
  COMMONS,
  COMMONS_IDS,
  commonsCaption,
  isCommonsId,
} from '../sources/commons'
import { readArray, writeJSON } from './storage'

import type { CommonsId, CommonsKind, CommonsPick } from '../sources/commons'

export interface WikiFavorite {
  // As Commons names the page, "File:" and extension included — what
  // `resolveCommons` takes, and what makes two favourites the same one.
  title: string
  kind: CommonsKind
  // The channel that rolled it, or '' when nothing said. Kept because it is the
  // one piece of context a title cannot carry: a shelf of forty stars sorts
  // itself into the pools they came out of, and "more like this" has something
  // to roll.
  channel: CommonsId | ''
}

// A backstop, not a curation rule: the list is a row and a title each, and the
// only way to reach four figures of them is a stuck key. The oldest goes, since
// a star is a thing you do to what is on screen right now.
export const FAVORITE_LIMIT = 200

// What the current pick is stored as. `channel` comes from the caller because
// the pick itself does not know — resolving a favourite hands back the same
// shape a roll does, and by then the pool it came out of is only remembered
// here.
export const favoriteOf = (
  pick: CommonsPick,
  channel: CommonsId | '',
): WikiFavorite => ({ title: pick.title, kind: pick.kind, channel })

export const isStarred = (
  list: readonly WikiFavorite[],
  title: string,
): boolean => list.some(f => f.title === title)

// Star or unstar, whichever this title is not. Newest first, because the list is
// read top-down and the one you just starred is the one you are about to want.
export function toggleFavorite(
  list: readonly WikiFavorite[],
  fave: WikiFavorite,
): WikiFavorite[] {
  const without = list.filter(f => f.title !== fave.title)
  return without.length < list.length
    ? without
    : [fave, ...without].slice(0, FAVORITE_LIMIT)
}

export const dropFavorite = (
  list: readonly WikiFavorite[],
  title: string,
): WikiFavorite[] => list.filter(f => f.title !== title)

// The shelf as the dialog draws it: each channel with what was starred out of
// it, in the order the channels are offered in the picker, and whatever has no
// channel last. Grouping is what makes forty stars readable — the titles are
// Commons filenames, which say what a thing *is* and nothing about which pool it
// came from.
export function favoriteGroups(
  list: readonly WikiFavorite[],
): { channel: CommonsId | ''; label: string; items: WikiFavorite[] }[] {
  const groups = COMMONS_IDS.map(channel => ({
    channel,
    // The picker's own words, minus the "Commons: " every one of them opens
    // with — inside a dialog that is already about Commons it is a column of
    // the same word.
    label: COMMONS[channel].label.replace(/^Commons: /, ''),
    items: list.filter(f => f.channel === channel),
  }))
  const loose = list.filter(f => !isCommonsId(f.channel))
  return [
    ...groups.filter(g => g.items.length > 0),
    ...(loose.length === 0
      ? []
      : [{ channel: '' as const, label: 'starred elsewhere', items: loose }]),
  ]
}

// One stored entry, or undefined when it is not one. The shelf is JSON in
// localStorage: a stale schema, a hand edit or another build's leftovers all
// arrive here, and a title that is not a string is a request the API would be
// handed verbatim.
function readFavorite(raw: unknown): WikiFavorite | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const title = 'title' in raw ? raw.title : undefined
  const kind = 'kind' in raw ? raw.kind : undefined
  const channel = 'channel' in raw ? raw.channel : ''
  return typeof title === 'string' &&
    title !== '' &&
    (kind === 'photo' || kind === 'video')
    ? {
        title,
        kind,
        // A channel that has since been retired reads as no channel rather than
        // dropping the star: the file is still on Commons and still playable,
        // and the group it lands in is the only thing that changes.
        channel:
          typeof channel === 'string' && isCommonsId(channel) ? channel : '',
      }
    : undefined
}

// A stored blob, made safe to render, to key on, and to ask the API for.
export function readFavorites(raw: unknown): WikiFavorite[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : []).flatMap(entry => {
    const fave = readFavorite(entry)
    // De-duplicated on the way in, not only on the way out: the toggle keys on
    // the title, so a hand-edited list holding the same title twice would go on
    // showing one of them after it had been unstarred.
    if (fave === undefined || seen.has(fave.title)) return []
    seen.add(fave.title)
    return [fave]
  })
}

// What a row reads. The caption a roll shows, which is the filename with the
// scaffolding off — the ▶ is what distinguishes a clip from a still, since a
// stripped filename no longer carries the extension that used to say so.
export const favoriteLabel = (fave: WikiFavorite): string =>
  `${fave.kind === 'video' ? '▶ ' : ''}${commonsCaption(fave.title)}`

// ── the store ────────────────────────────────────────────────────────────────

const KEY = 'ntsc.js.wiki.favorites'

export const loadFavorites = (): WikiFavorite[] =>
  readFavorites(readArray<unknown>(KEY, []))

export const saveFavorites = (list: readonly WikiFavorite[]): void =>
  writeJSON(KEY, list)
