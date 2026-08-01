import { useCallback, useEffect, useState } from 'react'

import { writeSessionParams } from './urlParams'

import type { Controls } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'

interface UrlStateArgs {
  controls: Controls
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
  speedA: number
  speedB: number
  reverb: number
}

// Mirrors the live look into the query string so a reload or shared link
// restores it, and hands back a copy-to-clipboard action with its transient
// "copied" flash.
export function useUrlState({
  controls,
  engineReady,
  sourceMode,
  sourceBMode,
  ytUrlA,
  ytUrlB,
  speedA,
  speedB,
  reverb,
}: UrlStateArgs) {
  const [copied, setCopied] = useState(false)

  // The whole query-string rule lives in urlParams beside the parser that has
  // to read it back; what is left here is the browser half — which params are
  // already on the address bar, and where the link points.
  const stateUrl = useCallback(() => {
    const q = writeSessionParams(new URLSearchParams(location.search), {
      controls,
      sourceMode,
      sourceBMode,
      ytUrlA,
      ytUrlB,
      speedA,
      speedB,
      reverb,
    })
    const query = q.toString()
    return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`
  }, [
    controls,
    sourceMode,
    sourceBMode,
    ytUrlA,
    ytUrlB,
    speedA,
    speedB,
    reverb,
  ])

  // Keep the address bar current on every change (replaceState, so it doesn't
  // flood history). Trailing-debounced: a slider drag emits a move per frame,
  // and the browser rate-limits the history API — so coalesce to one write once
  // the value settles.
  useEffect(() => {
    if (engineReady) {
      const url = stateUrl()
      const id = setTimeout(() => history.replaceState(null, '', url), 250)
      return () => clearTimeout(id)
    }
  }, [engineReady, stateUrl])

  const copyLink = () => {
    navigator.clipboard
      .writeText(stateUrl())
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }

  return { copyLink, copied }
}
