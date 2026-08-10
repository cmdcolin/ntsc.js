import { useCallback, useEffect } from 'react'

import { reason } from './format'
import { writeProfileParams, writeSessionParams } from './urlParams'

import type { Controls } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'
import type { TeletypeCard } from '../sources/teletype'
import type { Cue } from './cue'
import type { ModRouting } from './modSlots'

interface UrlStateArgs {
  controls: Controls
  // What is moving, so a shared link carries the motion and not just the look.
  mod: readonly ModRouting[]
  // Gated on the engine existing: before it does, `controls` is the default
  // fallback and syncing would wipe the very params the loader is about to read.
  engineReady: boolean
  sourceMode: SourceMode
  sourceBMode: SourceBMode
  // YouTube source URLs + vaporwave look, so a refresh or shared link restores
  // the clips slowed down. Audio-out isn't serialized: browsers block unmuted
  // autoplay, so a restored clip must start muted and be un-muted by a click.
  ytUrlA: string
  ytUrlB: string
  // Each slot's teletype card, so a shared link carries the words and the roll
  // as well as the mode.
  teletypeA: TeletypeCard
  teletypeB: TeletypeCard
  speedA: number
  speedB: number
  reverb: number
  // Each slot's cue point, so a shared link of a clip carries the loop that was
  // marked on it as well as the clip itself.
  cueA: Cue | null
  cueB: Cue | null
  // Where a refused copy is reported. The clipboard is the one thing in here
  // the page does not control: it can be denied outright.
  onError: (message: string) => void
}

// Where a query string points. Split out from the writers because a saved look
// is stored as the query alone: it outlives the origin it was saved on (a dev
// server this morning, the deployed page tonight), so the link is assembled at
// the moment it is copied rather than baked into the store.
const linkFor = (query: string) =>
  `${location.origin}${location.pathname}${query ? `?${query}` : ''}`

// Mirrors the live look into the query string so a reload or shared link
// restores it, and hands back a copy-to-clipboard action — plus the two halves
// the saved-look library needs: the query string for the look on screen, and the
// link for a query string it kept.
export function useUrlState({
  controls,
  mod,
  engineReady,
  sourceMode,
  sourceBMode,
  ytUrlA,
  ytUrlB,
  teletypeA,
  teletypeB,
  speedA,
  speedB,
  reverb,
  cueA,
  cueB,
  onError,
}: UrlStateArgs) {
  // The whole query-string rule lives in urlParams beside the parser that has
  // to read it back; what is left here is the browser half — which params are
  // already on the address bar, and where the link points.
  const session = useCallback(
    () => ({
      controls,
      mod,
      sourceMode,
      sourceBMode,
      ytUrlA,
      ytUrlB,
      teletypeA,
      teletypeB,
      speedA,
      speedB,
      reverb,
      cueA,
      cueB,
    }),
    [
      controls,
      mod,
      sourceMode,
      sourceBMode,
      ytUrlA,
      ytUrlB,
      teletypeA,
      teletypeB,
      speedA,
      speedB,
      reverb,
      cueA,
      cueB,
    ],
  )

  const stateUrl = useCallback(
    () =>
      linkFor(
        writeSessionParams(
          new URLSearchParams(location.search),
          session(),
        ).toString(),
      ),
    [session],
  )

  // Keep the address bar current on every change (replaceState, so it doesn't
  // flood history). Trailing-debounced: a slider drag emits a move per frame,
  // and the browser rate-limits the history API — so coalesce to one write once
  // the value settles.
  // An effect's cleanup return is conditional by nature (React's own documented pattern).
  // oxlint-disable-next-line typescript/consistent-return
  useEffect(() => {
    if (engineReady) {
      const url = stateUrl()
      const id = setTimeout(() => history.replaceState(null, '', url), 250)
      return () => clearTimeout(id)
    }
  }, [engineReady, stateUrl])

  // Whether the text actually reached the clipboard. `writeText` rejects for
  // reasons that have nothing to do with the link and everything to do with
  // where the page is running: an insecure origin (plain http on a LAN, which is
  // exactly how this gets shown on a projector), a denied permission, a browser
  // that wanted a fresher user gesture than the one that arrived here. Swallowed
  // — which it was — the saved-look row still ticked, and the palette's copy was
  // silent whether it worked or not, so the failure looked identical to success
  // right up until the paste.
  // Written with await rather than a rejection handler because the failure
  // arrives in two shapes: on an insecure origin the clipboard API is not
  // refusing but *absent*, so reading `.writeText` off it throws synchronously
  // where a permission denial rejects. Inside an async function both are the
  // same catch.
  const writeClip = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (e) {
      onError(`could not copy to the clipboard: ${reason(e)}`)
      return false
    }
  }

  const copyLink = () => writeClip(stateUrl())

  // What a saved look records — the same serialization, minus the params that
  // only make sense for the session that is running (see writeProfileParams).
  const profileQuery = () =>
    writeProfileParams(
      new URLSearchParams(location.search),
      session(),
    ).toString()

  const copyQuery = (query: string) => writeClip(linkFor(query))

  return { copyLink, profileQuery, copyQuery }
}
