import { describe, expect, it } from 'vitest'

import { normaliseAvcc, writeMp4 } from './mp4'

import type { Sample } from './mp4'

// Walk the box tree the way a demuxer does: length, four-character type, then
// either children or a payload. Enough to assert structure without pulling in a
// parser, and it fails loudly on a length that does not add up — which is the
// single most likely thing to be wrong in a writer like this.
interface Box {
  type: string
  start: number
  size: number
  body: Uint8Array
}

function boxes(buf: Uint8Array, from = 0, to = buf.length): Box[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Box[] = []
  let at = from
  while (at + 8 <= to) {
    const size = view.getUint32(at)
    const type = String.fromCharCode(...buf.slice(at + 4, at + 8))
    if (size < 8 || at + size > to) {
      throw new Error(`bad box ${type} size ${size} at ${at} (limit ${to})`)
    }
    out.push({ type, start: at, size, body: buf.slice(at + 8, at + size) })
    at += size
  }
  if (at !== to) throw new Error(`trailing ${to - at} bytes`)
  return out
}

const find = (list: Box[], type: string): Box => {
  const hit = list.find(b => b.type === type)
  if (hit === undefined)
    throw new Error(`no ${type} in ${list.map(b => b.type).join(',')}`)
  return hit
}

// Children of a plain container, and of `stsd` — which is a full box (four
// bytes of version and flags) *and* carries an entry count before its entries.
const kids = (b: Box): Box[] => boxes(b.body)
const stsdKids = (b: Box): Box[] => boxes(b.body, 8, b.body.length)

const u32At = (b: Uint8Array, at: number): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at)

const sample = (n: number, key = false): Sample => ({
  data: Uint8Array.from({ length: n }, (_, i) => i & 0xff),
  key,
})

const AVCC = Uint8Array.from([
  1, 0x42, 0xc0, 0x2a, 0xff, 0xe1, 0, 5, 0x67, 0x42, 0xc0, 0x2a, 0xd9, 1, 0, 4,
  0x68, 0xcb, 0x8c, 0xb2,
])

const file = (samples: Sample[], fps = { num: 60, den: 1 }) =>
  writeMp4({ width: 640, height: 480, fps, avcc: AVCC, samples })

describe('writeMp4', () => {
  const out = file([sample(100, true), sample(60), sample(70), sample(80)])
  const top = boxes(out)

  // If the lengths did not add up, `boxes` would have thrown building `top`.
  it('writes a tree whose box lengths account for every byte', () => {
    expect(top.map(b => b.type)).toEqual(['ftyp', 'mdat', 'moov'])
  })

  it('brands the file so a player knows what it is', () => {
    expect(String.fromCharCode(...find(top, 'ftyp').body.slice(0, 4))).toBe(
      'isom',
    )
  })

  it('puts every sample in mdat, in order', () => {
    const mdat = find(top, 'mdat')
    expect(mdat.body.length).toBe(100 + 60 + 70 + 80)
    // The first sample's bytes are its own ramp, so a mis-ordered concat shows.
    expect(Array.from(mdat.body.slice(0, 4))).toEqual([0, 1, 2, 3])
  })

  const stbl = () => {
    const moov = find(top, 'moov')
    const trak = find(kids(moov), 'trak')
    const mdia = find(kids(trak), 'mdia')
    const minf = find(kids(mdia), 'minf')
    return find(kids(minf), 'stbl')
  }

  // The whole point of the file: one entry saying every sample is the same
  // length. An editor reads a frame rate off this and conforms to it.
  it('states one duration for every sample, which is what CFR is', () => {
    const stts = find(kids(stbl()), 'stts')
    expect(u32At(stts.body, 4)).toBe(1) // one entry
    expect(u32At(stts.body, 8)).toBe(4) // covering four samples
    expect(u32At(stts.body, 12)).toBe(1) // one tick each
  })

  // 60fps is timescale 60 / delta 1; 29.97 has to stay 30000/1001 rather than
  // becoming a decimal an editor rounds its own way.
  it('keeps a broadcast rate exact rather than decimal', () => {
    const drop = file([sample(10, true)], { num: 30000, den: 1001 })
    const mdia = find(
      kids(find(kids(find(boxes(drop), 'moov')), 'trak')),
      'mdia',
    )
    const mdhd = find(kids(mdia), 'mdhd')
    expect(u32At(mdhd.body, 12)).toBe(30000) // timescale
    expect(u32At(mdhd.body, 16)).toBe(1001) // one sample long
    const stts = find(
      kids(find(kids(find(kids(mdia), 'minf')), 'stbl')),
      'stts',
    )
    expect(u32At(stts.body, 12)).toBe(1001)
  })

  it('lists every sample size individually, since encoded frames differ', () => {
    const stsz = find(kids(stbl()), 'stsz')
    expect(u32At(stsz.body, 4)).toBe(0) // 0 = sizes follow
    expect(u32At(stsz.body, 8)).toBe(4)
    expect([0, 1, 2, 3].map(i => u32At(stsz.body, 12 + i * 4))).toEqual([
      100, 60, 70, 80,
    ])
  })

  // The offset has to point at the first byte of the first sample, or every
  // frame is read from the wrong place and the file decodes to nothing.
  it('points the chunk offset at the samples themselves', () => {
    const stco = find(kids(stbl()), 'stco')
    const offset = u32At(stco.body, 8)
    const mdat = find(top, 'mdat')
    expect(offset).toBe(mdat.start + 8)
    expect(Array.from(out.slice(offset, offset + 4))).toEqual([0, 1, 2, 3])
  })

  // Without an stss a player takes every frame as a cut point, which is wrong
  // the moment the encoder emits a P-frame — and scrubbing lands on garbage.
  it('names the sync samples when they are not all sync samples', () => {
    const stss = find(kids(stbl()), 'stss')
    expect(u32At(stss.body, 4)).toBe(1)
    expect(u32At(stss.body, 8)).toBe(1) // sample numbers are 1-based
  })

  // And omits the table when every frame is one: its absence is what the
  // format uses to say so, and writing it out would be a table the size of the
  // movie saying nothing.
  it('omits it when every frame is a keyframe', () => {
    const all = file([sample(10, true), sample(10, true)])
    const s = find(
      kids(find(kids(find(kids(find(boxes(all), 'moov')), 'trak')), 'mdia')),
      'minf',
    )
    expect(kids(find(kids(s), 'stbl')).map(b => b.type)).not.toContain('stss')
  })

  // Firefox's own description is malformed — see `normaliseAvcc`. These are the
  // exact bytes it produced on Nightly, and what ffmpeg writes for the same
  // stream.
  describe('the parameter sets', () => {
    const firefox = Uint8Array.from([
      0x01, 0x42, 0xc0, 0x2a, 0x03, 0x01, 0x00, 0x06, 0x67, 0x67, 0x42, 0xc0,
      0x2a, 0xd9, 0x01, 0x00, 0x05, 0x68, 0x68, 0xcb, 0x8c, 0xb2,
    ])

    it('sets the reserved bits the spec fixes at 1', () => {
      const fixed = normaliseAvcc(firefox)
      expect(fixed[4]).toBe(0xff)
      expect(fixed[5]).toBe(0xe1)
    })

    it('drops the duplicated NAL header off each set', () => {
      const fixed = normaliseAvcc(firefox)
      const spsLen = (fixed[6] << 8) | fixed[7]
      expect(Array.from(fixed.slice(8, 8 + spsLen))).toEqual([
        0x67, 0x42, 0xc0, 0x2a, 0xd9,
      ])
      const at = 8 + spsLen
      expect(fixed[at]).toBe(1) // one PPS
      expect(Array.from(fixed.slice(at + 3))).toEqual([0x68, 0xcb, 0x8c, 0xb2])
    })

    it('takes the profile and level off the SPS, not the broken header', () => {
      const fixed = normaliseAvcc(firefox)
      expect(Array.from(fixed.slice(0, 4))).toEqual([1, 0x42, 0xc0, 0x2a])
    })

    // The bug is one browser's. On a correct record nothing may be touched —
    // and a real SPS's second byte is profile_idc, which cannot equal its own
    // NAL header, so the un-doubling is unambiguous.
    it('leaves a well-formed record alone', () => {
      const good = Uint8Array.from([
        0x01, 0x42, 0xc0, 0x20, 0xff, 0xe1, 0x00, 0x05, 0x67, 0x42, 0xc0, 0x20,
        0xd9, 0x01, 0x00, 0x04, 0x68, 0xcb, 0x8c, 0xb2,
      ])
      expect([...normaliseAvcc(good)]).toEqual([...good])
    })

    it('hands back anything too short to be a record rather than inventing one', () => {
      const stub = Uint8Array.from([1, 2, 3])
      expect([...normaliseAvcc(stub)]).toEqual([1, 2, 3])
    })
  })

  it('carries the parameter sets, without which nothing decodes', () => {
    const avc1 = find(stsdKids(find(kids(stbl()), 'stsd')), 'avc1')
    // avc1's own header is 78 bytes before its children begin.
    const avcC = find(boxes(avc1.body, 78, avc1.body.length), 'avcC')
    expect([...avcC.body]).toEqual([...AVCC])
  })

  it('records the frame size where a player looks for it', () => {
    const avc1 = find(stsdKids(find(kids(stbl()), 'stsd')), 'avc1')
    const view = new DataView(
      avc1.body.buffer,
      avc1.body.byteOffset,
      avc1.body.byteLength,
    )
    expect(view.getUint16(24)).toBe(640)
    expect(view.getUint16(26)).toBe(480)
  })

  it('survives a single-frame movie', () => {
    expect(() => boxes(file([sample(10, true)]))).not.toThrow()
  })

  it('scales to a movie long enough to matter', () => {
    const many = Array.from({ length: 3600 }, (_, i) =>
      sample(50, i % 120 === 0),
    )
    const big = file(many)
    expect(() => boxes(big)).not.toThrow()
    const stts = find(
      kids(
        find(
          kids(
            find(kids(find(kids(find(boxes(big), 'moov')), 'trak')), 'mdia'),
          ),
          'minf',
        ),
      ),
      'stbl',
    )
    expect(u32At(find(kids(stts), 'stts').body, 8)).toBe(3600)
  })
})
