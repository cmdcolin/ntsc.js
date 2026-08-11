// Poll an in-page reading until it is the one being waited for, and hand back
// whatever the last reading was either way.
//
// **A fixed sleep is right for something that has already happened by the time
// the next line runs, and wrong for anything the browser does on its own
// clock.** Most of what a harness here does is the first kind — a click, a
// React render, a chip stepping — which is why the short sleeps in these
// scripts are fine. The second kind is anything waiting on a decoder, a
// `play()` promise, or a *rendered frame*, and that last one is the trap worth
// naming: an occluded window throttles rAF, so anything the app clocks off
// frames — a morph, a hold bar, a lock age — may simply not have moved yet.
// `docs/DEVELOPMENT.md` has both of the failures this was written for.
//
// **Handing the last reading back rather than throwing is the whole point of
// not using `waitForFunction`**, which rejects on a timeout: one arm going slow
// would abandon every assertion after it and report a `TimeoutError` naming
// nothing it saw. This way a thing that genuinely never arrives fails one check
// with its value in the message, and the run continues.
//
// Its own module so it can be tested without a browser — the logic here is a
// loop and a deadline, and proving a loop by launching Firefox ten times is the
// same mistake in the other direction.
export const until = async (read, ok, opts = {}) => {
  const { budget = 8000, every = 100 } = opts
  const deadline = Date.now() + budget
  let seen = await read()
  while (!ok(seen) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, every))
    seen = await read()
  }
  return seen
}
