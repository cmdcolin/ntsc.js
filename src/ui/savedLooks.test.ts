import { describe, expect, it } from 'vitest'

import {
  LOOK_NAME_MAX,
  cleanLookName,
  readLooks,
  removeLook,
  suggestLookName,
  upsertLook,
} from './savedLooks'

const look = (name: string, query = 'set=') => ({ name, query })

describe('saved look names', () => {
  it('collapses the whitespace a paste brings with it', () => {
    expect(cleanLookName('  worn   tape\n')).toBe('worn tape')
  })

  it('caps the length rather than refusing a long one', () => {
    const long = cleanLookName('x'.repeat(200))
    expect(long).toHaveLength(LOOK_NAME_MAX)
  })

  it('reads a name of nothing but spaces as no name', () => {
    expect(cleanLookName('   ')).toBe('')
  })
})

describe('saved look store', () => {
  it('drops stored entries of the wrong shape rather than throwing', () => {
    expect(
      readLooks([
        look('keep'),
        null,
        'nope',
        { name: 'no query' },
        { name: 7, query: 'set=' },
        { name: '  ', query: 'set=' },
      ]),
    ).toEqual([look('keep')])
  })

  it('appends a new look and overwrites an existing name in place', () => {
    const looks = [look('a'), look('b'), look('c')]
    expect(upsertLook(looks, 'd', 'set=x').map(l => l.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    const over = upsertLook(looks, 'b', 'set=x')
    expect(over.map(l => l.name)).toEqual(['a', 'b', 'c'])
    expect(over[1].query).toBe('set=x')
  })

  it('matches an overwrite against the cleaned name', () => {
    expect(upsertLook([look('worn tape')], ' worn  tape ', 'set=x')).toEqual([
      look('worn tape', 'set=x'),
    ])
  })

  it('declines to save under no name at all', () => {
    expect(upsertLook([look('a')], '  ', 'set=x')).toEqual([look('a')])
  })

  it('removes by name', () => {
    expect(removeLook([look('a'), look('b')], 'a')).toEqual([look('b')])
  })
})

describe('name suggestions', () => {
  it('offers the board’s own name while it is free', () => {
    expect(suggestLookName([look('vhs')], 'betamax')).toBe('betamax')
  })

  it('counts up only once the name is taken', () => {
    expect(suggestLookName([look('vhs')], 'vhs')).toBe('vhs 2')
    expect(suggestLookName([look('vhs'), look('vhs 2')], 'vhs')).toBe('vhs 3')
  })

  it('falls back to a plain word for a look with no name', () => {
    expect(suggestLookName([], '')).toBe('look')
    expect(suggestLookName([look('look')], '')).toBe('look 2')
  })
})
