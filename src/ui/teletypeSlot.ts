// What makes a teletype a teletype: the card is redrawn a few times a second
// with one more chunk of the text on it, and then — if the card is set to
// crawl — it keeps going, rolling the block up the frame for as long as the
// slot holds it.
//
// Both are timers rather than anything in the chain because that is all they
// are: the *source* changes, not the signal path, exactly as it would if
// someone were feeding the modulator from a character generator with a keyboard
// on it. stopSlot owns the teardown (see videoSlot.ts), so every source change
// already stops whichever of the two is running.

import {
  TELETYPE_ASPECT,
  buildTeletype,
  crawlPeriod,
  drawBuild,
  drawCrawl,
  drawTeletype,
  makeTeletypeCard,
} from '../sources/teletype'

import type { TeletypeCard } from '../sources/teletype'
import type { VideoSlot } from './videoSlot'

// Characters per second, and how often the card is redrawn while printing.
// 12 Hz is under the display rate on purpose: each tick is a full 1280x960
// draw and upload, and the reveal is meant to read as a printer rather than as
// smooth animation — a Teletype Model 33 managed ten characters a second.
const CPS = 14
const TICK_MS = 1000 / 12
// However long the text, it has finished printing inside this. A full-length
// card at printer speed would take the better part of a minute, and by then the
// reveal has stopped being a flourish and become a wait.
const MAX_MS = 6000

// The roll. 30 Hz is a video source's worth of uploads a second, which is what
// this becomes while it runs — the draw itself is one blit of a grid built
// once, so the upload is the whole cost. Speed is in card pixels rather than
// rows, so a two-word card and a page of text travel at the same pace.
const CRAWL_HZ = 30
const CRAWL_PX_PER_S = 70

// `reveal` is what makes this a teletype rather than a caption: the card prints
// a character at a time. It is off for an edit to a card that is already up —
// retyping a word should change the word, not send the whole card back to the
// printer, and with the box committing on every keystroke it would never get
// past the first one.
export function printCard(
  slot: VideoSlot,
  card: TeletypeCard,
  reveal = true,
): void {
  // Whatever this slot was printing or rolling is over: two timers drawing into
  // two canvases and both calling setImage would flicker between them.
  slot.typer.current?.stop()
  const canvas = makeTeletypeCard()
  const show = () => slot.setImage(canvas, TELETYPE_ASPECT)
  let timer: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  // A crawl is never finished, so the handle stays live until the slot is
  // retired; a still card drops it once the last character has landed.
  slot.typer.current = { stop }

  const crawl = () => {
    const build = buildTeletype(card.text, true)
    const period = crawlPeriod(build)
    let offset = 0
    // Advanced by elapsed time rather than a fixed step per tick: a browser
    // clamps timers to 1 Hz in a tab it isn't painting, and a card that had
    // been rolling in the background for a minute should come back where a
    // clock says it is, not a minute behind.
    let last = performance.now()
    timer = setInterval(() => {
      const now = performance.now()
      offset = (offset + ((now - last) / 1000) * CRAWL_PX_PER_S) % period
      last = now
      drawCrawl(canvas, build, offset)
      show()
    }, 1000 / CRAWL_HZ)
  }

  // The finished card, built once whether or not it rolls: the crawl needs the
  // build anyway, and the still one gets the same grid without the vertical
  // squeeze a mid-reveal redraw would have applied.
  const settle = () => {
    stop()
    if (card.crawl) {
      crawl()
    } else {
      drawBuild(canvas, buildTeletype(card.text))
      show()
      slot.typer.current = null
    }
  }
  if (!reveal) {
    settle()
    return
  }

  // Printed by character rather than by code unit: a mosaic block lives outside
  // the BMP, and a reveal that stopped between its two halves would put a lone
  // surrogate on the card — a tofu box, for one tick, on every drawn cell it
  // passed through.
  const chars = Array.from(card.text)
  const step = Math.max(
    Math.round((CPS * TICK_MS) / 1000),
    Math.ceil(chars.length / (MAX_MS / TICK_MS)),
    1,
  )
  let shown = 0
  // Frame zero is the bare cursor on black, so the source it replaced is gone
  // the moment the reveal starts rather than a tick later.
  drawTeletype(canvas, '')
  show()
  timer = setInterval(() => {
    shown = Math.min(chars.length, shown + step)
    if (shown < chars.length) {
      drawTeletype(canvas, chars.slice(0, shown).join(''))
      show()
      return
    }
    settle()
  }, TICK_MS)
}
