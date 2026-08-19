// The two pools as one front door.
//
// `pool.ts` holds what Commons and archive.org have in common as *types* and
// primitives; this holds it as *behaviour*. Everything above the sources — the
// engine, the picker, the shelf, the browser dialog — comes through here and
// never imports commons.ts or archive.ts directly, which is what collapsed the
// engine's two of everything into one: one roll, one resolve, one caption, one
// state slot per deck.
//
// The split is the import direction. commons.ts and archive.ts know nothing
// about each other and nothing about this file; this file knows both. Adding a
// third source is a module beside those two and four lines here.

import {
  ARCHIVE_POOLS,
  archiveCaption,
  archivePageUrl,
  browseArchive,
  resolveArchive,
  rollArchive,
} from './archive'
import {
  COMMONS_POOLS,
  browseCommons,
  commonsCaption,
  commonsPageUrl,
  resolveCommons,
  rollCommons,
} from './commons'

import type { Rand } from '../core/rng'
import type {
  BrowseHit,
  OnProgress,
  PoolOrigin,
  PoolPick,
  PoolRef,
} from './pool'

export type {
  BrowseHit,
  OnProgress,
  PickKind,
  PoolOrigin,
  PoolPick,
  PoolRef,
} from './pool'
export { BROWSE_LIMIT, refKey, releasePick, sameRef } from './pool'

// The two picker entries that roll, and which source each reads.
//
// Two, where this was eleven: seven Commons "channels" and three archive.org
// ones, each naming a mood ("statuary, neon, dead malls, sunsets"). They were a
// menu of gambles — every one of them a pool you could not look into — taking up
// eleven of the source dropdown's twenty-seven rows, and the browser dialog is a
// straightly better answer to the thing they were for. What survives of them is
// the curated queries, which are now `presetsOf` below: buttons in that dialog,
// where a name like "Marble busts" leads somewhere you can see.
export const POOL_MODES = ['wiki-random', 'ia-random'] as const
export type PoolMode = (typeof POOL_MODES)[number]

const POOL_MODE_SET: ReadonlySet<string> = new Set<string>(POOL_MODES)
export const isPoolMode = (mode: string): mode is PoolMode =>
  POOL_MODE_SET.has(mode)

export const MODE_ORIGIN: Record<PoolMode, PoolOrigin> = {
  'wiki-random': 'commons',
  'ia-random': 'archive',
}

// The same pairing read the other way: which picker entry names this source.
//
// Wanted by anything holding an origin that has to put a deck on it — a strip
// row's roll, which stores the origin rather than the mode because that is what
// a `PoolRef` carries and what a take records.
//
// Written out rather than inverted with `Object.fromEntries`, which cannot
// produce this type without an assertion — and an assertion here would be the
// one that matters, since a wrong entry silently rolls the other archive. The
// two tables being inverses is asserted in `modes.test.ts` instead, which is
// what actually catches a third pool added to one and forgotten in the other.
export const POOL_MODE_FOR: Record<PoolOrigin, PoolMode> = {
  commons: 'wiki-random',
  archive: 'ia-random',
}

// What a source is called in prose, for a caption's credit line and a browser
// tab.
export const ORIGIN_LABEL: Record<PoolOrigin, string> = {
  commons: 'Wikimedia Commons',
  archive: 'archive.org',
}

// Roll one file out of a source, avoiding what is already on the slot.
//
// `onProgress` reaches archive.org and nowhere else, which is not an oversight:
// a Commons transcode streams into the <video> element and starts playing off
// the front of the file, so there is no wait to report on. The archive.org half
// has to hold the whole rendition first (see the head of archive.ts) and is the
// one place in this app that makes you wait without a picture.
// `rand` is the seam the strip rolls through: a row that names a pool rather
// than a file resolves it when the row fires, and a take has to be able to walk
// the same decisions again (docs/EDITOR.md › _Seeding_). Both halves say what a
// seed can and cannot promise about the file that comes back — this is the one
// funnel, so it is the one place a seeded caller has to reach.
export const rollPool = (
  origin: PoolOrigin,
  avoid = '',
  onProgress?: OnProgress,
  rand?: Rand,
): Promise<PoolPick> =>
  origin === 'commons'
    ? rollCommons(avoid, rand)
    : rollArchive(avoid, onProgress, rand)

// One named file, resolved back into something playable. This is what a shelf
// entry is worth: both sources keep an identity rather than a url, and both can
// be asked for it again — see the note on `resolveArchive`, which is the half
// that used to be missing and the reason an archive.org clip can be kept at all.
export const resolvePool = (
  ref: PoolRef,
  onProgress?: OnProgress,
): Promise<PoolPick> =>
  ref.origin === 'commons'
    ? resolveCommons(ref)
    : resolveArchive(ref.title, onProgress)

// What a title reads as on one line, with the upstream's scaffolding off: the
// "File:" and the extension on Commons, the underscores and the de-duplicator's
// trailing date stamp on archive.org.
export const poolCaption = (ref: PoolRef): string =>
  ref.origin === 'commons'
    ? commonsCaption(ref.title)
    : archiveCaption(ref.title)

// Where a file's credit lives, worked out from the title alone. Which is what
// lets a shelf entry — a title and nothing else — offer the licence and the
// author without a request, months after it was kept.
export const poolPageUrl = (ref: PoolRef): string =>
  ref.origin === 'commons'
    ? commonsPageUrl(ref.title)
    : archivePageUrl(ref.title)

// A page of results for an arbitrary query. Ranked on both sources, which is the
// one thing a roll cannot be — see the note at the head of commons.ts for why a
// random-sorted free-text search is useless and a ranked one is not.
export const browsePool = (
  origin: PoolOrigin,
  query: string,
): Promise<BrowseHit[]> =>
  origin === 'commons' ? browseCommons(query) : browseArchive(query)

// The tested queries, as something to click in the browser rather than type.
//
// These are the pools a roll draws from, which makes them the honest starting
// points: every one has been run against the live API and returns material this
// app can use, where an arbitrary phrase may return a page of PDFs. They differ
// from a roll only in being *shown* — same query, ranked and laid out instead of
// sampled and committed to.
export const presetsOf = (
  origin: PoolOrigin,
): readonly { label: string; query: string }[] =>
  origin === 'commons' ? COMMONS_POOLS : ARCHIVE_POOLS
