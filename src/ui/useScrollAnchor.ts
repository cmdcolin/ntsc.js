import { useEffect } from 'react'

import type { RefObject } from 'react'

// Keep everything *below* an element where it is when the element changes
// height out of sight above the fold.
//
// The panel is one long scroller, and the things that grow on their own sit at
// the top of it — "This look" is above every control you can reach. So a row
// arriving there while you are working eight stages down pushes the row under
// your pointer 44px down the screen (measured: one row plus its group caption),
// with nothing on screen to say why: the thing that grew is out of view.
//
// The browser is supposed to do exactly this — it is what `overflow-anchor` is
// for, and the panel reports `auto` — but Firefox does not anchor here: driving
// the real panel, the section grew 44px and `scrollTop` did not move by a
// pixel. So the panel turns anchoring off outright (see app.module.css) and
// this does the job by hand, which also means one behaviour in every engine
// rather than ours on top of Chrome's.
//
// Only out of sight, and that limit is the whole design. A section growing
// while you are looking at it explains itself, and compensating for it would
// scroll the preset chips off the screen you just clicked one on.
export function useScrollAnchor(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (el === null) return undefined
    // Measured only when the element's box actually changes, so an ordinary
    // control write — sixty a second during a drag, and the panel already the
    // expensive part of one — costs nothing here. A layout effect reading rects
    // per commit would forced-reflow the whole panel for the same answer.
    let last = el.getBoundingClientRect().height
    const observer = new ResizeObserver(entries => {
      const height =
        entries[0]?.borderBoxSize[0]?.blockSize ??
        el.getBoundingClientRect().height
      const grew = height - last
      last = height
      if (grew === 0) return
      // Resolved per resize rather than held from mount: the panel is portaled
      // into the popout window, which puts this element in another document
      // under a different scroller.
      const scroller = scrollerOf(el)
      if (scroller === null) return
      const scroll = scroller.scrollTop
      // The element's own top, in the scroller's content rather than the
      // window — the number that says whether any of it is on screen. It does
      // not move when the element grows downward, so this reads the same
      // before and after.
      const top =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroll
      if (top >= scroll) return
      // Growth is always affordable: the scrollable range grew by exactly as
      // much. A shrink can hit the top of the panel and clamp, which is the
      // one case where something below still moves.
      scroller.scrollTop = scroll + grew
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}
