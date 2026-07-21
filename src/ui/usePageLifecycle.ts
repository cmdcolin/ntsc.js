import { useEffect } from 'react'

import type { Engine } from '../gpu/pipeline'
import type { RefObject } from 'react'

// The browser can stop delivering rAF around tab hide/show, fullscreen exit, and
// Firefox's freeze/discard of a backgrounded tab; each of these re-arms the loop
// (kick() is a no-op when it's already healthy). The console breadcrumbs name
// the last transition before any lockup. A bfcache restore carries a dead
// GPUDevice, so that one reloads instead.
export function usePageLifecycle(
  engineRef: RefObject<Engine | null>,
  onFullscreenChange: (fullscreen: boolean) => void,
) {
  useEffect(() => {
    const log = (m: string) => console.log(`[lifecycle] ${m}`)
    const onFs = () => {
      const fs = document.fullscreenElement !== null
      onFullscreenChange(fs)
      log(`fullscreen ${fs ? 'entered' : 'exited'}`)
      engineRef.current?.kick()
    }
    const onVisible = () => {
      log(`visibility -> ${document.visibilityState}`)
      if (document.visibilityState === 'visible') engineRef.current?.kick()
    }
    const onFocus = () => engineRef.current?.kick()
    const onFreeze = () => log('freeze (tab suspended by browser)')
    const onResume = () => {
      log('resume (tab un-suspended)')
      engineRef.current?.kick()
    }
    const onPageHide = (e: PageTransitionEvent) =>
      log(`pagehide (persisted=${e.persisted})`)
    const onPageShow = (e: PageTransitionEvent) => {
      log(`pageshow (persisted=${e.persisted})`)
      if (e.persisted) location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('focus', onFocus)
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('visibilitychange', onVisible)
    document.addEventListener('freeze', onFreeze)
    document.addEventListener('resume', onResume)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('freeze', onFreeze)
      document.removeEventListener('resume', onResume)
    }
  }, [engineRef, onFullscreenChange])
}
