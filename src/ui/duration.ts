// How long a file runs, asked of the browser.
//
// One question, and the answer is a number the app has otherwise only ever had
// as a side effect of playing something: `transport.a.duration` is read off the
// element on the deck, so until now a clip nobody had played had no length.
// That is what left a rundown's `'clip'` holds falling back to a bar count
// (`clipLibrary.Clip.seconds`).
//
// **A `<video>` rather than `mp4demux.ts`**, which does parse a movie header and
// would be exact. Two reasons it is the wrong tool here. The demuxer answers for
// mp4 alone, and the shelf holds whatever the browser plays — webm off Commons,
// mkv, mov; a probe that declined half the shelf would leave the same fallback
// in place for the same rows. And it wants the whole file's bytes in hand, where
// `preload = 'metadata'` reads the header and stops, which over a `blob:` is the
// same work and over anything else is not.
//
// Nothing here decodes a frame or attaches to the engine. The element is built,
// asked and thrown away inside this function, which is why it can be called from
// a click handler without a slot to put it in.

// Long enough for a large file over a slow disk, short enough that a rundown
// does not sit waiting on a clip that will never answer. What a timeout buys is
// not speed but an ending: an element whose metadata never arrives fires neither
// event, and the promise behind it would otherwise be pending for the life of
// the tab with an element hanging off it.
const GIVE_UP_MS = 15_000

// Seconds, or 0 for "cannot say" — which every caller already handles, because
// it is the same 0 an unmeasured shelf entry carries.
//
// Resolves rather than rejects on every failure. A duration is an optimisation
// on a hold that already has a fallback: a file the browser declines, a grant
// that lapsed, a stream with no length at all. None of those is worth a banner,
// and the row plays either way.
export function probeDuration(src: Blob): Promise<number> {
  return new Promise<number>(resolve => {
    const url = URL.createObjectURL(src)
    const v = document.createElement('video')
    let done = false
    const finish = (seconds: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      // Both, and in this order. Clearing `src` and reloading is what actually
      // stops a browser that has begun buffering; revoking first would leave the
      // element chasing a url that no longer resolves, which Firefox reports as
      // a media error on an element nobody is listening to any more.
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
      // A live stream reads Infinity and an element with no metadata reads NaN.
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0)
    }
    const timer = setTimeout(() => finish(0), GIVE_UP_MS)
    v.addEventListener('loadedmetadata', () => finish(v.duration), {
      once: true,
    })
    v.addEventListener('error', () => finish(0), { once: true })
    // Muted and never played, so nothing here needs an autoplay grant — and
    // `metadata` is the whole ask: the header, not the picture.
    v.muted = true
    v.preload = 'metadata'
    v.src = url
  })
}
