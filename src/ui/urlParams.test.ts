import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTROLS } from '../controls'
import { PRESETS } from './presets'
import {
  LANDING_LOOK,
  REVERB_DEFAULT,
  SPEED_DEFAULT,
  parseSessionParams,
} from './urlParams'

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

  it('asks for nothing when the named preset is gone', () => {
    // A link outliving a retired preset asked for that preset. Falling back to
    // the landing look would silently hand it a different picture instead.
    expect(parseSessionParams('?preset=no-such-preset').controls).toEqual({})
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
})
