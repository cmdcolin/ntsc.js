import { describe, expect, it } from 'vitest'

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// CSS modules are typed as Record<string, string>, so `styles.thisIsAtypo`
// compiles fine and resolves to undefined at runtime — the element just renders
// unstyled, and nothing fails until someone looks at that particular corner of
// the UI. That is the whole risk in moving a rule from one module to another,
// and it is a static question: does every class a component reaches for exist
// in the file it imported?

const SRC = resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name)
    return e.isDirectory()
      ? sourceFiles(path)
      : /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts')
        ? [path]
        : []
  })
}

// `composes: bare from './ui.module.css'` — the name pulled in, and from where.
// Both passes below have to know about these: the path is a string with dots in
// it, so left in place `./ui.module.css` reads as definitions of `.module` and
// `.css`, and the name is a use of the *other* sheet's class that no component
// spells out.
const COMPOSES = /composes:\s*([\w\s-]+?)\s+from\s+'([^']+)'\s*;/g

function stripComposes(css: string): string {
  return css.replaceAll(COMPOSES, '').replaceAll(/composes:[^;]*;/g, '')
}

// Class names a stylesheet defines. Comments go first so a name mentioned in
// prose doesn't count as a definition.
function definedClasses(css: string): Set<string> {
  const code = stripComposes(css.replaceAll(/\/\*[\s\S]*?\*\//g, ''))
  return new Set([...code.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m => m[1]))
}

// What a sheet reaches for in another sheet, as `<abs path>:<class>` — the same
// key the tsx scan produces, so a composed primitive counts as referenced.
function composedClasses(css: string, file: string): string[] {
  return [...css.matchAll(COMPOSES)].flatMap(m =>
    m[1].split(/\s+/).map(name => `${resolve(dirname(file), m[2])}:${name}`),
  )
}

// Every `import styles from './X.module.css'` in a file, as identifier -> path.
function moduleImports(src: string, file: string) {
  return [
    ...src.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g),
  ].map(m => ({ ident: m[1], path: resolve(dirname(file), m[2]) }))
}

// Usage scanning has to skip the import lines, or `from './ui.module.css'`
// reads as a use of a class called `module` on the identifier `ui`.
const withoutImports = (src: string) => src.replaceAll(/^import\s[^\n]*$/gm, '')

const files = sourceFiles(SRC)

describe('css modules', () => {
  it('finds the components that import one', () => {
    // a guard on the scan itself: a broken glob silently passes everything
    expect(
      files.filter(f => moduleImports(readFileSync(f, 'utf8'), f).length > 0)
        .length,
    ).toBeGreaterThan(15)
  })

  it.each(files.map(f => relative(SRC, f)))(
    '%s uses only classes that exist',
    rel => {
      const file = join(SRC, rel)
      const src = withoutImports(readFileSync(file, 'utf8'))
      const missing: string[] = []
      for (const { ident, path } of moduleImports(
        readFileSync(file, 'utf8'),
        file,
      )) {
        const defined = definedClasses(readFileSync(path, 'utf8'))
        const used = [
          ...src.matchAll(new RegExp(String.raw`\b${ident}\.(\w+)\b`, 'g')),
        ].map(m => m[1])
        for (const name of used) {
          if (!defined.has(name))
            missing.push(`${ident}.${name} (${relative(SRC, path)})`)
        }
      }
      expect(missing).toEqual([])
    },
  )

  it('has no class no component references', () => {
    // Dead rules outlive the markup that used them; .title survived a redesign
    // this way. A class only ever named by another selector (.a .b) still shows
    // up as defined *and* is not referenced from tsx — hence the second pass
    // over the stylesheets themselves. A shared primitive reached by `composes`
    // is the same case one file further out: ui.module.css's .bare is never
    // spelled `ui.bare` anywhere, and it is not dead.
    const dead: string[] = []
    const referenced = new Set<string>()
    const sheets = new Set<string>()
    for (const file of files) {
      const raw = readFileSync(file, 'utf8')
      const src = withoutImports(raw)
      for (const { ident, path } of moduleImports(raw, file)) {
        sheets.add(path)
        for (const m of src.matchAll(
          new RegExp(String.raw`\b${ident}\.(\w+)\b`, 'g'),
        )) {
          referenced.add(`${path}:${m[1]}`)
        }
      }
    }
    // Second sweep, once every sheet is known: a sheet can compose from one no
    // component imports directly.
    for (const path of [...sheets]) {
      for (const key of composedClasses(readFileSync(path, 'utf8'), path)) {
        referenced.add(key)
        sheets.add(key.slice(0, key.lastIndexOf(':')))
      }
    }
    for (const path of sheets) {
      const css = stripComposes(
        readFileSync(path, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, ''),
      )
      // a name used as a descendant/compound part is spoken for by the sheet
      const usedBySheet = new Set(
        [
          ...css.matchAll(
            /\.(-?[A-Za-z_][\w-]*)[^,{]*[\s.>+~]\.(-?[A-Za-z_][\w-]*)/g,
          ),
        ].flatMap(m => [m[1], m[2]]),
      )
      for (const name of definedClasses(css)) {
        if (!referenced.has(`${path}:${name}`) && !usedBySheet.has(name)) {
          dead.push(`${relative(SRC, path)} .${name}`)
        }
      }
    }
    expect(dead).toEqual([])
  })

  // The pass above only sees classes, and a token is the other half of the
  // stylesheet. --amber outlived its last caller this way: still declared, still
  // carrying a comment explaining what it was for, referenced nowhere — which is
  // worse than a dead class, because the comment reads as documentation of a
  // decision the app no longer makes.
  it('declares no token nothing reads', () => {
    const theme = readFileSync(join(SRC, 'theme.css'), 'utf8')
    const declared = [
      ...theme
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .matchAll(/^\s*(--[\w-]+):/gm),
    ].map(m => m[1])
    expect(declared.length).toBeGreaterThan(20)

    // Every stylesheet plus every component, since a token can also be read
    // from an inline style on an element. The theme counts as a reader of
    // itself — --mono-blocks falls back through var(--mono) — and only `var(…)`
    // is a use, so a token's own declaration line never props it up.
    const readers = [
      theme,
      ...files.map(f => readFileSync(f, 'utf8')),
      ...[...sheetPaths()].map(p => readFileSync(p, 'utf8')),
    ].join('\n')

    const uses = new Set(
      [...readers.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]),
    )
    expect(declared.filter(t => !uses.has(t))).toEqual([])
  })
})

// every .module.css any component imports, plus any they compose from
function sheetPaths(): Set<string> {
  const out = new Set<string>()
  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    for (const { path } of moduleImports(raw, file)) out.add(path)
  }
  for (const path of [...out]) {
    for (const key of composedClasses(readFileSync(path, 'utf8'), path)) {
      out.add(key.slice(0, key.lastIndexOf(':')))
    }
  }
  return out
}
