import { describe, expect, it } from 'vitest'

import { CONTROL_KEYS, DEFAULT_CONTROLS, LANDING_LOOK } from '../controls'
import { SOURCE_B_MODES, SOURCE_MODES } from '../sources/modes'
import { TELETYPE_DEFAULT, TELETYPE_MAX } from '../sources/teletype'
import { ALL_SLIDERS, sliderFor } from './controls'
import { mutate } from './mutate'
import { PRESETS, presetControls } from './presets'
import {
  REVERB_DEFAULT,
  SPEED_DEFAULT,
  parseSessionParams,
  urlName,
  writeProfileParams,
  writeSessionParams,
} from './urlParams'

import type { ControlKey } from '../controls'
import type { SessionState } from './urlParams'

const vhs = PRESETS.find(p => p.name === 'vhs')

describe('session params', () => {
  it('lands a bare load on the landing look', () => {
    const p = parseSessionParams('')
    expect(p.controls).toEqual(LANDING_LOOK)
    expect(p.src).toBe(null)
    expect(p.vapor).toEqual({
      speedA: SPEED_DEFAULT,
      speedB: SPEED_DEFAULT,
      reverb: REVERB_DEFAULT,
    })
  })

  it('keeps a shared link clean of the landing look', () => {
    // ?set omits controls sitting at their default, so folding B in here would
    // dirty the very look the link was made to reproduce.
    expect(parseSessionParams('?set=noiseIre:9').controls).toEqual({
      noiseIre: 9,
    })
    expect(parseSessionParams('?preset=vhs').controls.bGain).toBe(
      DEFAULT_CONTROLS.bGain,
    )
  })

  it('layers ?set over the named preset, not under it', () => {
    const p = parseSessionParams('?preset=vhs&set=noiseIre:9')
    expect(vhs).toBeDefined()
    expect(p.controls.noiseIre).toBe(9)
    // the rest of the preset survives the override
    expect(p.controls.colorUnderMix).toBe(vhs?.patch.colorUnderMix)
    // and a preset resets what it does not name, so its absent keys are default
    expect(p.controls.crtBloom).toBe(DEFAULT_CONTROLS.crtBloom)
  })

  it('clamps a hand-edited ?set to the control it names', () => {
    // Not tidiness: `frameLock:-1` reaches the render loop as a divisor of 0,
    // `lockPhase % 0` is NaN, and the picture freezes on frame 0 — which is the
    // signature docs/adr/0004 teaches people to read as a lost rendering step
    // rather than as anything in the app. Verified in the browser before this
    // was written: frameNo 0 -> 0 across five seconds, against 39 -> 89 at
    // stock. A link must not be able to counterfeit that.
    const lock = sliderFor('frameLock')
    expect(parseSessionParams('?set=frameLock:-1').controls.frameLock).toBe(
      lock.min,
    )
    expect(parseSessionParams('?set=frameLock:99').controls.frameLock).toBe(
      lock.max,
    )
    // Every control, so a range added or retuned cannot leave one unguarded.
    const wild = CONTROL_KEYS.map(k => `${k}:-9999,${k}:9999`).join(',')
    for (const [key, value] of Object.entries(
      parseSessionParams(`?set=${wild}`).controls,
    )) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries widens to string; the keys are the ones just written
      const def = sliderFor(key as ControlKey)
      expect(value).toBeGreaterThanOrEqual(def.min)
      expect(value).toBeLessThanOrEqual(def.max)
    }
  })

  it('labels a url it cannot parse with the url itself', () => {
    // `new URL` throws on a few strings even with a base, and urlName is called
    // straight from restoreSession — a throw there abandons the vaporwave
    // settings, the YouTube params and the stash reopen behind it.
    expect(urlName('http://')).toBe('http://')
    expect(urlName('https://example.com/a/b/clip%20one.mp4')).toBe(
      'clip one.mp4',
    )
  })

  it('asks for nothing when the named preset is gone', () => {
    // A link outliving a retired preset asked for that preset. Falling back to
    // the landing look would silently hand it a different picture instead.
    expect(parseSessionParams('?preset=no-such-preset').controls).toEqual({})
  })

  it('asks for a roll, and keeps the landing look out of it', () => {
    // The roll itself is applied by the caller; a link asking for one is not a
    // bare load, so the landing look must not land underneath it.
    const p = parseSessionParams('?surprise')
    expect(p.surprise).toBe(true)
    expect(p.controls).toEqual({})
    expect(parseSessionParams('').surprise).toBe(false)
  })

  it('drops control keys it does not recognise', () => {
    const p = parseSessionParams('?set=noiseIre:3,noSuchKnob:5,humAmp:nope')
    expect(p.controls).toEqual({ noiseIre: 3 })
  })

  it('takes only source modes a link can actually name', () => {
    expect(parseSessionParams('?src=tv static').src).toBe('tv static')
    expect(parseSessionParams('?src=webcam').src).toBe('webcam')
    expect(parseSessionParams('?srcb=none').srcb).toBe('none')
    // bars is the default and file/youtube carry their own url params
    expect(parseSessionParams('?src=bars').src).toBe(null)
    expect(parseSessionParams('?src=file').src).toBe(null)
    // a share grant dies with the page, so a link cannot ask for one back
    expect(parseSessionParams('?src=screen').src).toBe(null)
    expect(parseSessionParams('?srcb=screen').srcb).toBe(null)
    expect(parseSessionParams('?srcb=nonsense').srcb).toBe(null)
  })

  it('falls back on unreadable playback numbers', () => {
    const p = parseSessionParams('?speeda=0.66&speedb=oops&reverb=0.8')
    expect(p.vapor).toEqual({
      speedA: 0.66,
      speedB: SPEED_DEFAULT,
      reverb: 0.8,
    })
  })

  it('carries the source urls through untouched', () => {
    const p = parseSessionParams(
      `?iurl=${encodeURIComponent('http://x/a b.png')}&yt=${encodeURIComponent('https://y/?v=1')}`,
    )
    expect(p.iurl).toBe('http://x/a b.png')
    expect(p.yt).toBe('https://y/?v=1')
    expect(p.iurlb).toBe(null)
  })

  it('carries a teletype card, newlines and all', () => {
    const p = parseSessionParams(
      `?src=teletype&text=${encodeURIComponent('BE KIND\nREWIND')}`,
    )
    expect(p.src).toBe('teletype')
    expect(p.card).toEqual({
      text: 'BE KIND\nREWIND',
      crawl: false,
      boil: false,
    })
    expect(p.cardb).toBe(null)
  })

  it('takes ?crawl on its own as the stock card, rolling', () => {
    expect(parseSessionParams('?src=teletype&crawl').card).toEqual({
      text: TELETYPE_DEFAULT.text,
      crawl: true,
      boil: false,
    })
  })

  it('takes ?boil on its own as the stock card, boiling', () => {
    expect(parseSessionParams('?src=teletype&boil').card).toEqual({
      text: TELETYPE_DEFAULT.text,
      crawl: false,
      boil: true,
    })
  })

  it('keeps the two slots’ hands apart', () => {
    // ?boil is A's and ?boilb is B's: one card boiling and the other holding
    // still is a mix worth having, and the flags used to be easy to cross.
    const p = parseSessionParams(
      '?src=teletype&srcb=teletype&text=A&textb=B&boilb',
    )
    expect(p.card?.boil).toBe(false)
    expect(p.cardb?.boil).toBe(true)
  })

  it('clamps teletype text a link asks for', () => {
    // The reveal prints the card a chunk at a time, so an unbounded string
    // from a link is an unbounded animation.
    const p = parseSessionParams(`?text=${'A'.repeat(5000)}`)
    expect(p.card?.text).toHaveLength(TELETYPE_MAX)
  })
})

// The two halves of the contract, back to back. Everything below asks the same
// question — does what the writer emits survive the reader — because the one
// real bug this pair has produced was exactly that: ?srcb= wrote two of B's
// modes while the reader accepted four, so a shared link quietly downgraded
// source B to bars. Nothing caught it, because each half read fine alone.
const state = (over: Partial<SessionState> = {}): SessionState => ({
  controls: DEFAULT_CONTROLS,
  mod: [],
  sourceMode: 'bars',
  sourceBMode: 'bars',
  ytUrlA: '',
  ytUrlB: '',
  teletypeA: { text: '', crawl: false, boil: false },
  teletypeB: { text: '', crawl: false, boil: false },
  speedA: SPEED_DEFAULT,
  speedB: SPEED_DEFAULT,
  reverb: REVERB_DEFAULT,
  cueA: null,
  cueB: null,
  ...over,
})

const roundTrip = (s: SessionState) =>
  parseSessionParams(`?${writeSessionParams(new URLSearchParams(), s)}`)

describe('session round trip', () => {
  it('returns every look it was given, exactly', () => {
    // Presets cover the authored looks; a mutated one covers the odd values a
    // session actually lands on, where 4-decimal rounding could bite. It does
    // not: the finest slider step in the schema is 0.001.
    const looks = [
      DEFAULT_CONTROLS,
      ...PRESETS.map(p => presetControls(p.patch)),
      mutate(presetControls(PRESETS[3].patch), ALL_SLIDERS, 0.4, () => 0.37),
    ]
    for (const controls of looks) {
      const back = roundTrip(state({ controls }))
      expect(presetControls(back.controls)).toEqual(controls)
    }
  })

  it('returns every source mode a link can carry', () => {
    for (const sourceMode of SOURCE_MODES) {
      const back = roundTrip(state({ sourceMode, ytUrlA: 'https://y/?v=1' }))
      // file has nothing to name, a clip off the shelf names a row in *this*
      // browser's library and nothing in the reader's, the starred Commons rolls
      // are that same local list, a screen share cannot be re-granted from a
      // link, and youtube travels as its url instead
      if (
        sourceMode === 'bars' ||
        sourceMode === 'file' ||
        sourceMode === 'library' ||
        sourceMode === 'browse' ||
        sourceMode === 'screen'
      ) {
        expect(back.src).toBe(null)
      } else if (sourceMode === 'youtube') {
        expect(back.src).toBe(null)
        expect(back.yt).toBe('https://y/?v=1')
      } else {
        expect(back.src).toBe(sourceMode)
      }
    }
  })

  it('returns every source B mode a link can carry', () => {
    for (const sourceBMode of SOURCE_B_MODES) {
      const back = roundTrip(state({ sourceBMode, ytUrlB: 'https://y/?v=2' }))
      if (
        sourceBMode === 'bars' ||
        sourceBMode === 'file' ||
        sourceBMode === 'library' ||
        sourceBMode === 'browse' ||
        sourceBMode === 'screen'
      ) {
        expect(back.srcb).toBe(null)
      } else if (sourceBMode === 'youtube') {
        expect(back.srcb).toBe(null)
        expect(back.ytb).toBe('https://y/?v=2')
      } else {
        expect(back.srcb).toBe(sourceBMode)
      }
    }
  })

  it('returns a teletype card, mode and words and motion together', () => {
    const card = { text: 'BE KIND\nREWIND', crawl: true, boil: true }
    const back = roundTrip(state({ sourceMode: 'teletype', teletypeA: card }))
    expect(back.src).toBe('teletype')
    expect(back.card).toEqual(card)
    // B is on bars, so its card is not the reader's business
    expect(back.cardb).toBe(null)
  })

  it('leaves a card behind when the slot moved off teletype', () => {
    // The words are only the source while teletype is the source; a link made
    // after switching to bars must not resurrect the card on the far end.
    const back = roundTrip(
      state({
        sourceMode: 'bars',
        teletypeA: { text: 'HI', crawl: true, boil: true },
      }),
    )
    expect(back.card).toBe(null)
  })

  it('returns the playback settings', () => {
    const back = roundTrip(state({ speedA: 0.66, speedB: 1.5, reverb: 0.8 }))
    expect(back.vapor).toEqual({ speedA: 0.66, speedB: 1.5, reverb: 0.8 })
  })

  // A cue rides with the clip it was marked on, so a shared link of "this two
  // seconds of this file" opens on the two seconds and not just the file.
  it('carries a marked loop per slot', () => {
    const back = roundTrip(
      state({ cueA: { in: 4.25, out: 5.5 }, cueB: { in: 1, out: null } }),
    )
    expect(back.cueA).toEqual({ in: 4.25, out: 5.5 })
    expect(back.cueB).toEqual({ in: 1, out: null })
  })

  it('writes no cue params when nothing is cued', () => {
    const q = writeSessionParams(new URLSearchParams(), state()).toString()
    expect(q).not.toContain('cuea')
    expect(q).not.toContain('cueb')
  })

  it('leaves the params it does not manage alone', () => {
    // A link-loaded source has to survive the user then touching a slider.
    const q = writeSessionParams(
      new URLSearchParams('?iurl=http://x/a.png&debug=1&set=humAmp:9'),
      state({ controls: { ...DEFAULT_CONTROLS, noiseIre: 4 } }),
    )
    expect(q.get('iurl')).toBe('http://x/a.png')
    expect(q.get('debug')).toBe('1')
    // ...but a managed key is rewritten from live state, not merged with it
    expect(q.get('set')).toBe('noiseIre:4')
  })

  it('drops ?surprise once the roll it asked for has happened', () => {
    // The address bar is rewritten from live state, and by then ?set= holds the
    // rolled look; leaving the flag on would reroll over it on every open.
    const q = writeSessionParams(
      new URLSearchParams('?surprise'),
      state({ controls: { ...DEFAULT_CONTROLS, noiseIre: 4 } }),
    )
    expect(q.has('surprise')).toBe(false)
    expect(q.get('set')).toBe('noiseIre:4')
  })

  it('drops a managed key once its value returns to stock', () => {
    const q = writeSessionParams(
      new URLSearchParams('?set=noiseIre:4&speeda=0.5&src=sweep'),
      state(),
    )
    expect(q.get('speeda')).toBe(null)
    expect(q.get('src')).toBe(null)
    // ...except `set`, which stays as an empty marker: a stock look is a look
    // the link is asserting, and no query at all means a first arrival instead.
    expect(q.get('set')).toBe('')
    expect(parseSessionParams('?set=').controls).toEqual({})
    expect(parseSessionParams('').controls).toEqual(LANDING_LOOK)
  })
})

describe('a saved look', () => {
  it('carries the source addresses and drops the rest of the live query', () => {
    const q = writeProfileParams(
      new URLSearchParams(
        '?iurl=http://x/a.png&vurl=http://x/b.mp4&preset=vhs&debug=1',
      ),
      state({ controls: { ...DEFAULT_CONTROLS, noiseIre: 4 } }),
    )
    expect(q.get('iurl')).toBe('http://x/a.png')
    expect(q.get('vurl')).toBe('http://x/b.mp4')
    // The two a kept look must not inherit: ?preset= would re-apply an authored
    // patch under controls this look has since edited back to stock (?set= omits
    // them), and ?debug= is a state of this session, not of the look.
    expect(q.has('preset')).toBe(false)
    expect(q.has('debug')).toBe(false)
    expect(q.get('set')).toBe('noiseIre:4')
  })

  it('reads back the look that was saved, over a preset in the live query', () => {
    // The case ?preset= would have broken: one of the preset's own controls
    // dragged back to stock before saving. ?set= omits it (it is at its default),
    // so a preset left alongside would hand the value back on recall.
    const key = CONTROL_KEYS.find(k => vhs?.patch[k] !== undefined)
    expect(key).toBeDefined()
    const controls = presetControls(vhs?.patch ?? {})
    if (key !== undefined) controls[key] = DEFAULT_CONTROLS[key]
    const back = parseSessionParams(
      `?${writeProfileParams(new URLSearchParams('?preset=vhs'), state({ controls }))}`,
    )
    expect(presetControls(back.controls)).toEqual(controls)
  })
})

describe('motion on a link', () => {
  const mod = [
    {
      target: 'fbZoom' as const,
      source: 'sine' as const,
      rateHz: 0.5,
      depth: 0.2,
    },
    {
      target: 'cfbMix' as const,
      source: 'lorenz' as const,
      rateHz: 2,
      depth: 0.45,
    },
  ]

  it('carries every routing back, exactly', () => {
    expect(roundTrip(state({ mod })).mod).toEqual(mod)
  })

  it('carries a beat lock, and leaves a free-running rate four fields wide', () => {
    const locked = [{ ...mod[0], syncDiv: 3 }, mod[1]]
    const q = writeSessionParams(new URLSearchParams(), state({ mod: locked }))
    expect(q.get('mod')).toBe('fbZoom:sine:0.5:0.2:3,cfbMix:lorenz:2:0.45')
    expect(roundTrip(state({ mod: locked })).mod).toEqual(locked)
  })

  it('drops a division the current list no longer has, keeping the routing', () => {
    // The reader indexes straight into SYNC_DIVISIONS, so a hand-edited or
    // outlived index has to come back as a free-running rate rather than as a
    // lock that throws on the first frame.
    const [r] = parseSessionParams('?mod=fbZoom:sine:0.5:0.2:99').mod ?? []
    expect(r).toEqual(mod[0])
  })

  it('says "nothing is moving" out loud rather than by omission', () => {
    // Same argument as the empty ?set= marker: a link is a statement about a
    // session, so a still look has to be distinguishable from an old link that
    // never had an opinion — which leaves the reader's own bay alone.
    const q = writeSessionParams(new URLSearchParams(), state())
    expect(q.get('mod')).toBe('')
    expect(parseSessionParams('?mod=').mod).toEqual([])
    expect(parseSessionParams('?set=').mod).toBe(null)
  })

  it('drops a routing whose control or source no longer exists', () => {
    const back = parseSessionParams(
      '?mod=fbZoom:sine:0.5:0.2,gone:sine:1:1,fbMix:notASource:1:1',
    )
    expect(back.mod).toEqual([mod[0]])
  })

  it('clamps a hand-edited rate or depth into range', () => {
    const [r] = parseSessionParams('?mod=fbZoom:sine:900:12').mod ?? []
    expect(r).toEqual({
      target: 'fbZoom',
      source: 'sine',
      rateHz: 10,
      depth: 1,
    })
  })

  it('caps how many routings a link can install', () => {
    const many = Array.from({ length: 30 }, () => 'fbMix:sine:1:0.3').join(',')
    expect(parseSessionParams(`?mod=${many}`).mod).toHaveLength(8)
  })

  it('takes a preset at its word about motion, and ?mod= over that', () => {
    // Presets that move are the point of the feature, so this asserts one
    // exists rather than skipping when none does.
    const moving = PRESETS.find(p => p.mod !== undefined)
    expect(moving, 'no preset carries motion').toBeDefined()
    const name = encodeURIComponent(moving?.name ?? '')
    expect(parseSessionParams(`?preset=${name}`).mod).toEqual(moving?.mod)
    // Someone who re-patched the bay after picking a preset copied this link:
    // the routings on it are the statement, not the preset's own.
    expect(
      parseSessionParams(`?preset=${name}&mod=fbZoom:sine:0.5:0.2`).mod,
    ).toEqual([mod[0]])
  })
})
