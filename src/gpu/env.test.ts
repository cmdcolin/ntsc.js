import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isFocused,
  isFullscreen,
  isVisible,
  pageSearch,
  sessionStore,
} from './env'

// These tests run under node, where none of the browser globals exist unless a
// test stubs one in. That is the point: every absence below is one this module
// has to answer without pretending the page is merely hidden or unfocused.
describe('env', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('with no document', () => {
    it('reports a live context rather than a hidden one', () => {
      // The render loop stands down when the page is hidden. Absent is not
      // hidden: answering "hidden" would stop the loop dead in a context that
      // has no visibility event to ever start it again.
      expect(isVisible()).toBe(true)
      expect(isFocused()).toBe(true)
    })

    it('is never fullscreen', () => {
      expect(isFullscreen()).toBe(false)
    })

    it('reads no query string, even though there is a location', () => {
      // Every JS context has a `location`; only a page's describes the session.
      // Reading `.search` off some other one would silently answer with the
      // wrong query rather than with nothing, which is the harder bug.
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
