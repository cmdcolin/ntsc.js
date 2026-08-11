// Is this run's window still being drawn?
//
// Every harness here launches a *headed* Firefox, because headless cannot
// present a WebGPU swap chain. So the run depends on a window nobody promised
// to leave alone — and clicking away from it is enough to ruin the measurement
// or hang the run outright. That happens often enough to be worth catching.
//
// **The signal has to be rAF delivery, not a visibility event.** An occluded
// window — one simply covered by another — goes on reporting
// `visibilityState: 'visible'` on Linux, which is the same fact `CLAUDE.md`
// records about a tab that has lost its rendering step. `pagehide` and
// `visibilitychange` catch a minimise, a tab switch or a navigation, and they
// are worth listening for because they are instant; they do not catch the
// common case. Counting frames does, because ~1 Hz against an expected 60 is
// unmistakable.
//
// **An occluded window is not a failing test**, and conflating the two is the
// whole point of this file. A harness that exits non-zero here sends somebody
// looking for a bug in a feature that was never exercised. So a stall exits
// `STALL_EXIT`, which `sweep.mjs` reports as its own outcome, distinct from
// both a pass and a failure: rerun it with the window in front.
//
// `cuecheck` had the first version of this idea, ad hoc — "too few samples
// means the tab stopped being rendered, which is a fact about this machine's
// GPU rather than about the loop" — and retried rather than reported. This is
// that instinct, generalised and made loud.

// EX_TEMPFAIL. Not 1, which means "checks failed", and not 0.
export const STALL_EXIT = 75

// Whether a run of samples says the window stopped being drawn.
//
// Pure, and separated from the polling for the reason the rest of this session
// kept running into: the arithmetic is the part that can be wrong, and proving
// it by covering up a browser window is not a test anybody will run twice.
//
// `samples` are `{ at, frames }`, oldest first — wall-clock milliseconds and a
// monotonic count of animation frames the page has been given. The judgement is
// a *rate* rather than a count, because an occluded window is throttled to
// about 1 Hz rather than stopped: "no frames at all" would miss it.
export function stalledAt(samples, opts = {}) {
  const { minFps = 5, graceMs = 6000 } = opts
  const last = samples.at(-1)
  if (last === undefined) return null
  // The newest sample that is *at least* a grace period old, so the window
  // judged over is the tightest one that still covers it. Anything shorter
  // would turn one slow moment into a verdict.
  //
  // Written the other way round first — the oldest sample *within* graceMs,
  // then a check that the span was at least graceMs — which are contradictory:
  // that `first` is at most graceMs old by construction, so only an exact tie
  // got past the check and the watchdog could not fire at all. The unit tests
  // below passed it anyway, because sampling every 1000ms divides a 6000ms
  // grace exactly and lands on the tie every time. It took a live run at 200ms
  // to show it, which is why there is now a case here with spacing that does
  // not divide.
  const first = samples.filter(s => last.at - s.at >= graceMs).at(-1)
  if (first === undefined) return null
  // The count going *backwards* is a new document, not a slow one: a fresh page
  // starts a fresh counter. Harnesses navigate on purpose — `poolcheck` reloads
  // to prove the clip shelf survives it — so this has to be "start again", and
  // the caller drops the samples either side of the join. Reported as a rate
  // without this guard it read `-47.0 animation frames a second`, which is the
  // arithmetic saying plainly that it had been handed two different documents.
  if (last.frames < first.frames) return null
  const secs = (last.at - first.at) / 1000
  const fps = (last.frames - first.frames) / secs
  return fps < minFps
    ? `${fps.toFixed(1)} animation frames a second over ${secs.toFixed(0)}s`
    : null
}

// Install the counter and watch it. Returns `{ stop }`.
//
// **Not for a harness that steps frames by hand.** `rendercheck`, `reccheck`,
// `pixelcheck` and friends drive the engine inside one long `page.evaluate`,
// which blocks the page's main thread on purpose — no rAF is delivered while it
// runs, and that is the harness working correctly, not a window being taken
// away. Those are immune to the problem this catches anyway: a window nobody is
// drawing does not stop `vf.step()`. Use it on the interaction harnesses, which
// are the ones that wait on wall-clock time and hang when the frames stop.
export async function watchFrames(page, opts = {}) {
  const { minFps = 5, graceMs = 6000, pollMs = 1000, label = '' } = opts
  // The counter belongs to a *document*, so it has to be reinstalled on every
  // one — a harness that navigates would otherwise be watching a page that no
  // longer exists, silently, which is the failure mode this file is against.
  const install = () => {
    if (window.__frameWatch !== undefined) return
    const w = { frames: 0, hidden: false }
    window.__frameWatch = w
    const tick = () => {
      w.frames += 1
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    // The one event worth keeping, and instant where counting is slow: a
    // minimise or a tab switch. **Not `pagehide`** — that fires on a navigation
    // the harness asked for, and killing a run at its own `page.goto` would be
    // the watchdog inventing the fault it exists to report.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') w.hidden = true
    })
  }
  await page.evaluateOnNewDocument(install)
  await page.evaluate(install)

  const samples = []
  let timer = null
  const give = async reason => {
    clearInterval(timer)
    console.log(
      `\nSTALL  ${label === '' ? 'this run' : label} lost its frames — ${reason}.` +
        `\n       A headed window that is covered, minimised or navigated away` +
        `\n       stops being drawn, and everything measured after that is` +
        `\n       about the window manager. Put it in front and run again.`,
    )
    await page
      .browser()
      .close()
      .catch(() => {})
    process.exit(STALL_EXIT)
  }

  timer = setInterval(() => {
    void page
      .evaluate(() => ({
        frames: window.__frameWatch?.frames ?? 0,
        hidden: window.__frameWatch?.hidden ?? false,
      }))
      // A page that cannot be reached is not a stall to report — the harness is
      // closing, or already failing for a reason of its own that deserves to be
      // the one printed.
      .then(read => {
        if (read.hidden) return give('the window was hidden or minimised')
        // A fresh document restarts the count, so the samples either side of a
        // navigation cannot be compared. Start again rather than subtract them.
        const prev = samples.at(-1)
        if (prev !== undefined && read.frames < prev.frames) samples.length = 0
        samples.push({ at: Date.now(), frames: read.frames })
        // Enough history to cover the grace window several times over, derived
        // rather than a round number: at a fast poll a fixed cap can throw away
        // the very samples the window needs, and the run then never judges.
        const keep = Math.max(8, Math.ceil((graceMs / pollMs) * 3))
        while (samples.length > keep) samples.shift()
        const why = stalledAt(samples, { minFps, graceMs })
        return why === null ? undefined : give(why)
      })
      .catch(() => {})
  }, pollMs)
  // Never the reason a run is held open at the end.
  timer.unref?.()
  return {
    stop: () => clearInterval(timer),
  }
}
