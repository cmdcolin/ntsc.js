import { useEffect } from 'react'

import { reason } from './format'
import { writeProfileParams, writeSessionParams } from './urlParams'

import type { Controls } from '../controls'
import type { SessionState } from './urlParams'

// The session, plus the three things that are about *mirroring* one rather than
// about what a session is.
//
// Extending rather than restating: this used to be `SessionState`'s thirteen
// fields written out a second time, which is the same shape as the drift
// urlParams.ts records at the interface itself — the writer and the reader kept
// apart until they disagreed. Adding a field to a link is now one edit there,
// and this hook stops compiling until the caller supplies it.
interface UrlStateArgs extends SessionState {
  // Gated on the engine existing: before it does, `controls` is the default
  // fallback and syncing would wipe the very params the loader is about to read.
  engineReady: boolean
  // Where a morph in flight is heading, or null when none is — the same
  // question `useMix.banked()` asks, and asked here for the same reason.
  //
  // It changes what a *capture* records and deliberately not what the address
  // bar says. The live URL is a mirror of the picture, so following the tween
  // is right there. A capture is a look being banked to come back to — a saved
  // profile, a strip row — and "a tween is a frame, not a look": bank the frame
  // and what comes back is a place on the way to somewhere, which nobody chose
  // and which the board cannot be returned to by any other means.
  getGlideTarget: () => Controls | null
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
export function useUrlState(args: UrlStateArgs) {
  // The session is the rest: whatever is left once the three above are taken
  // off. Nothing here lists its fields, which is the point — the list lives at
  // `SessionState` and this hook reads it by subtraction.
  const { engineReady, getGlideTarget, onError, ...session } = args
  // The whole query-string rule lives in urlParams beside the parser that has
  // to read it back; what is left here is the browser half — which params are
  // already on the address bar, and where the link points.
  const stateUrl = linkFor(
    writeSessionParams(
      new URLSearchParams(location.search),
      session,
    ).toString(),
  )

  // Keep the address bar current on every change (replaceState, so it doesn't
  // flood history). Trailing-debounced: a slider drag emits a move per frame,
  // and the browser rate-limits the history API — so coalesce to one write once
  // the value settles.
  //
  // The dependency is the finished URL rather than a memoized closure over the
  // session's thirteen fields, and that is the better dep as well as the shorter
  // one: a string compares by value, so a render that rebuilds `controls` into
  // an identical board does not restart the debounce. Which also means no
  // hand-written `useCallback` — the React Compiler holds the identity of
  // everything above (see ARCHITECTURE.md › React Compiler is on).
  // An effect's cleanup return is conditional by nature (React's own documented pattern).
  // oxlint-disable-next-line typescript/consistent-return
  useEffect(() => {
    if (engineReady) {
      const id = setTimeout(() => history.replaceState(null, '', stateUrl), 250)
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

  const copyLink = () => writeClip(stateUrl)

  // What a saved look records — the same serialization, minus the params that
  // only make sense for the session that is running (see writeProfileParams).
  const profileQuery = () =>
    writeProfileParams(new URLSearchParams(location.search), {
      ...session,
      // The destination when a morph is running, per `getGlideTarget` above.
      controls: getGlideTarget() ?? session.controls,
    }).toString()

  const copyQuery = (query: string) => writeClip(linkFor(query))

  return { copyLink, profileQuery, copyQuery }
}
