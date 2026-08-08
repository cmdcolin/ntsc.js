import { useEffect, useRef, useState } from 'react'

import { signIn, signOut, wasSignedIn, watchAuth } from '../ui/cloud'
import { VOTE_SOURCE_NAMES } from './prepare'
import { useVoteEngines } from './useVoteEngines'
import { useVoting } from './useVoting'
import styles from './vote.module.css'

import type { EngineApi } from '../gpu/engineapi'
import type { CloudUser } from '../ui/cloud'
import type { VoteSource } from './prepare'
import type { Choice } from './votes'

// The labelling tool: two looks, live, one question, a few hundred times.
//
// **Nothing on this page names what it is showing.** No preset names, no weights,
// no seeds, no "the left one is vhs". That is not tidiness — a labeller who can see
// that the left canvas is built on a preset they already like is not judging the
// canvas, and the model would learn that preference back out of the data as if it
// had come from the pictures. The recipe is in the record and nowhere on screen.
//
// The other half of the same rule is in the stylesheet: the two canvases are
// identical as boxes, because anything that makes one side prettier to look *at*
// becomes a bias the dataset carries.

// Reading the sign-in state without making every visitor pay for the Firebase SDK.
// Same trade cloud.ts describes: the ~110kB is fetched on a load that already
// knows this browser has signed in before, or on a press of the button, and a
// session that does neither downloads none of it.
function useVoteAuth() {
  const [user, setUser] = useState<CloudUser | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!wasSignedIn()) return undefined
    let live = true
    const stop = watchAuth(u => {
      if (live) setUser(u)
    })
    return () => {
      live = false
      void stop.then(off => off())
    }
  }, [])

  return {
    user,
    busy,
    start: async () => {
      setBusy(true)
      try {
        setUser(await signIn())
      } catch {
        // A dismissed popup is not an error worth a banner — the page keeps
        // working, votes keep queueing, and the button is still there.
      } finally {
        setBusy(false)
      }
    },
    stop: async () => {
      await signOut()
      setUser(null)
    },
  }
}

// What each engine is actually presenting, as a health readout rather than a
// performance toy: a pair judged at 8 fps is a pair whose motion the labeller
// never really saw, and since two engines share one device it is worth being able
// to see whether they are keeping up with each other.
//
// Read from the engines' own `onStats` rather than by counting rAF callbacks on
// the page, and the difference matters. The render loop has a fallback timer for
// exactly the case where a browser stops delivering rAF at full rate — an occluded
// or unfocused window — so a page-side rAF counter reads near zero while the engine
// is still stepping and the picture is still developing. It measures how often
// *this document* is painted, not how fast the signal path is running, and it
// reported 1 fps on a page whose canvases were visibly blooming.
function useEngineFps(engines: readonly [EngineApi, EngineApi] | null) {
  const [rates, setRates] = useState<readonly [number, number]>([0, 0])
  useEffect(() => {
    if (engines === null) return undefined
    engines[0].onStats = s => {
      setRates(prev => [s.fps, prev[1]])
    }
    engines[1].onStats = s => {
      setRates(prev => [prev[0], s.fps])
    }
    return () => {
      // Handed back to a no-op rather than left pointing at a dead setState.
      for (const engine of engines) engine.onStats = () => undefined
    }
  }, [engines])
  return rates
}

export function VotePage() {
  const leftCanvas = useRef<HTMLCanvasElement>(null)
  const rightCanvas = useRef<HTMLCanvasElement>(null)
  const [source, setSource] = useState<VoteSource>('bars')
  const { engines, error } = useVoteEngines([leftCanvas, rightCanvas])
  const auth = useVoteAuth()
  const rates = useEngineFps(engines)
  const { pair, phase, vote, reroll, cast, pending } = useVoting({
    engines,
    source,
    uid: auth.user?.uid ?? null,
  })
  // Signed in as well as developed: a vote nobody can be attributed to is one
  // that would rot unsent, so the page asks for an account at the point somebody
  // has shown they want to contribute rather than in front of the first pair.
  const armed = phase === 'ready' && pair !== null && auth.user !== null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const choice: Choice | null =
        e.key === 'ArrowLeft'
          ? 'a'
          : e.key === 'ArrowRight'
            ? 'b'
            : e.key === 'ArrowDown'
              ? 'skip'
              : e.key === 'n'
                ? 'neither'
                : null
      if (choice !== null) {
        e.preventDefault()
        vote(choice)
      } else if (e.key === 'r') {
        e.preventDefault()
        reroll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
    // `vote` is a fresh closure every render and reads the live pair, so binding
    // the listener per render is the correct thing rather than a cost to avoid.
  })

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <h1 className={styles.title}>which look is cooler?</h1>
        <div className={styles.spacer} />
        <span className={styles.count}>{cast} voted</span>
        {pending > 0 && (
          <span
            className={styles.queued}
            title="Votes held in this browser until you sign in"
          >
            {pending} unsent
          </span>
        )}
        <span
          className={
            rates[0] > 0 && Math.min(...rates) < 20
              ? styles.queued
              : styles.count
          }
          title="Presented frames per second, per side. Two engines share one GPU device; below ~20 the motion is hard to judge, and a big gap between the two sides would mean they are not being given the same picture to judge."
        >
          {Math.round(rates[0])}/{Math.round(rates[1])} fps
        </span>
        <select
          className={styles.btn}
          value={source}
          onChange={e => {
            // Narrowed by lookup rather than asserted: the value off a <select> is
            // a string, and `find` hands back the union member or nothing.
            const next = VOTE_SOURCE_NAMES.find(n => n === e.target.value)
            if (next !== undefined) setSource(next)
          }}
          title="What the looks are rendered over"
        >
          {VOTE_SOURCE_NAMES.map(name => (
            <option key={name} value={name}>
              over {name}
            </option>
          ))}
        </select>
        {auth.user === null ? (
          <button
            className={styles.btn}
            disabled={auth.busy}
            onClick={() => void auth.start()}
          >
            sign in to save
          </button>
        ) : (
          <button className={styles.btn} onClick={() => void auth.stop()}>
            sign out{auth.user.name === null ? '' : ` (${auth.user.name})`}
          </button>
        )}
      </div>

      <p className={styles.blurb}>
        Two rolls of the signal path, live, over the same source and on the same
        clock. Pick the one you would rather keep — or say neither, which is
        just as useful. Vote first, sign in whenever; nothing is lost in the
        meantime.
      </p>

      {error !== '' && (
        <p className={styles.error}>
          WebGPU did not start: {error}. On Linux this page wants Firefox
          Nightly.
        </p>
      )}

      <div className={styles.pair}>
        <div className={styles.side}>
          {/* The engine canvas *is* the preview — there is no recording step any
              more, so what you are looking at is the signal path running. */}
          <canvas ref={leftCanvas} className={styles.clip} />
          <button
            className={styles.pick}
            disabled={!armed}
            onClick={() => {
              vote('a')
            }}
          >
            ← this one
          </button>
        </div>
        <div className={styles.side}>
          <canvas ref={rightCanvas} className={styles.clip} />
          <button
            className={styles.pick}
            disabled={!armed}
            onClick={() => {
              vote('b')
            }}
          >
            this one →
          </button>
        </div>
      </div>

      <div className={styles.keys}>
        {armed ? (
          <>
            <span>
              <span className={styles.key}>←</span>{' '}
              <span className={styles.key}>→</span> pick
            </span>
            <span>
              <span className={styles.key}>↓</span> skip
            </span>
            <span>
              <span className={styles.key}>n</span> both bad
            </span>
            <span>
              <span className={styles.key}>r</span> another pair
            </span>
            <button
              className={styles.btn}
              onClick={() => {
                vote('skip')
              }}
            >
              skip
            </button>
            <button
              className={styles.btn}
              onClick={() => {
                vote('neither')
              }}
            >
              both bad
            </button>
          </>
        ) : auth.user === null && phase === 'ready' ? (
          <span className={styles.notice}>
            Watch as long as you like — an account is what gives a vote
            somewhere to go, so sign in above when you want them counted.
          </span>
        ) : (
          <span className={styles.notice}>
            {phase === 'flushing'
              ? 'clearing the last pair out of the feedback loops…'
              : 'letting both looks develop — feedback and tape faults take a few seconds to arrive…'}
          </span>
        )}
      </div>
    </div>
  )
}
