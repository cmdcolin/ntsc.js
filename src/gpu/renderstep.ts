// A witness for the step requestAnimationFrame rides on, read through a path
// that is not requestAnimationFrame.
//
// When both of the loop's rAF chains go flat, two very different faults look
// identical from inside the page, and asking rAF again cannot separate them:
//
//   - The browser has stopped running the rendering step for this tab. Nothing
//     the app draws can reach the screen, and no reload recovers it, because
//     that step belongs to the tab rather than to the document — which is
//     exactly the shape of a freeze that survives a refresh. The only way out
//     is a new tab.
//   - The step is still running and only the animation-frame callbacks are
//     being dropped. Far narrower, and the setTimeout fallback genuinely
//     bridges it: the frames it renders do reach a screen, so giving up on the
//     fallback there throws away a working picture.
//
// ResizeObserver callbacks are delivered from that same rendering step. So
// changing an element's size from a timer and counting the callbacks that come
// back reads the step directly — ticking means it runs, flat means it does not
// — without going anywhere near rAF.
export interface RenderStep {
  // Callbacks delivered since the witness was started.
  ticks: () => number
  // Give the observer something to deliver at the next rendering step. Called
  // once per watchdog beat, so a beat's tick delta is 1 while the step runs and
  // 0 once it stops.
  nudge: () => void
  stop: () => void
}

// Returns null where there is nothing to observe with — a worker, or a unit
// test's stubbed document. Callers must read that as "no reading available"
// rather than as a dead step: absence of the witness is not evidence.
export function watchRenderStep(): RenderStep | null {
  try {
    const probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    // Off-screen rather than hidden or display:none. It has to keep being laid
    // out — an element with no box never changes size, so the observer would
    // have nothing to deliver and a healthy step would read as a dead one.
    probe.style.cssText =
      'position:fixed;top:-4px;left:-4px;width:1px;height:1px;pointer-events:none'
    let ticks = 0
    let wide = false
    const ro = new ResizeObserver(() => {
      ticks += 1
    })
    document.body.appendChild(probe)
    // Observing delivers once on its own, so a live step has already ticked by
    // the first beat and the witness needs no warm-up reading.
    ro.observe(probe)
    return {
      ticks: () => ticks,
      nudge: () => {
        wide = !wide
        probe.style.width = wide ? '2px' : '1px'
      },
      stop: () => {
        ro.disconnect()
        probe.remove()
      },
    }
  } catch {
    return null
  }
}
