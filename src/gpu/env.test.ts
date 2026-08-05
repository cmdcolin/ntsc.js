import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isFocused,
  isFullscreen,
  isVisible,
  pageSearch,
  sessionStore,
} from './env'

// These tests run under node, where none of the browser globals exist unless a
// test stubs one in — which is exactly the shape of a worker, and the reason
// this module exists.
describe('env', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('with no document (a worker)', () => {
    it('reports a live context rather than a hidden one', () => {
      // The render loop stands down when the page is hidden. A worker has no
      // page, so answering "hidden" here would stop the loop dead in exactly
      // the context that was supposed to keep it running.
      expect(isVisible()).toBe(true)
      expect(isFocused()).toBe(true)
    })

    it('is never fullscreen', () => {
      expect(isFullscreen()).toBe(false)
    })

    it('reads no query string, even though a worker has a location', () => {
      // A worker's `location` is its own script URL. Reading `.search` off it
      // would silently answer with the bundle's query rather than the page's,
      // so the session's params have to arrive by message instead.
      vi.stubGlobal('location', { search: '?dbg=3&debug' })
      expect(pageSearch()).toBe('')
    })

    it('has no session store', () => {
      expect(sessionStore()).toBe(null)
    })
  })

  describe('with a document (the main thread)', () => {
    it('passes the document state straight through', () => {
      vi.stubGlobal('document', {
        visibilityState: 'hidden',
        hasFocus: () => false,
        fullscreenElement: {},
      })
      expect(isVisible()).toBe(false)
      expect(isFocused()).toBe(false)
      expect(isFullscreen()).toBe(true)
    })

    it('reads the page query string', () => {
      vi.stubGlobal('document', { visibilityState: 'visible' })
      vi.stubGlobal('location', { search: '?preset=vhs' })
      expect(pageSearch()).toBe('?preset=vhs')
    })
  })
})
