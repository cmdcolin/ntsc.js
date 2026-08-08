// Fails if React Compiler cannot optimize a component or hook.
//
// Why this needs its own check: a bailout is not an error anywhere else. `pnpm
// build` succeeds, `tsc` succeeds, `oxlint` succeeds, the tests pass, and the
// page renders correctly — the compiler simply leaves that component
// unmemoized and says nothing. The only symptom is the panel getting slower,
// and in this app the panel is one component (`App`) that builds ~200 control
// rows, so a bailout there costs a re-render of all of them on every write.
//
// The known ways to trip it, both of which have happened here:
//
//   - reading a ref during render, including reading one *out of an object*,
//     which marks the whole object as ref-ish (see the `{ engine, engineRef }`
//     destructure in app.tsx);
//   - writing a ref during render, which is what the "latest callback" pattern
//     does if you reach for it.
//
// Run: `pnpm compiler`. Add `--verbose` to list what was optimized rather than
// only what was not.

import { transformAsync } from '@babel/core'
import compiler from 'babel-plugin-react-compiler'

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SRC = 'src'
const verbose = process.argv.includes('--verbose')

// Every event kind the plugin reports that means "this did not get optimized".
// CompileSkip is deliberately not one: it is what an opt-out directive produces,
// which is a choice somebody made rather than a fault.
const FAILURES = new Set(['CompileError', 'PipelineError'])

// Bailouts that predate this check, recorded so the gate could go in without a
// refactor in front of it. Every line is something worth fixing rather than
// something that is fine — but none of them is on the panel's hot path (`App`,
// the control rows and the look bar all optimize), which is why they can wait.
//
// Two of them are ours and two are the compiler's:
//
//   - TeletypeDialog / useShortcuts read a ref during render, the exact fault
//     app.tsx's `{ engine, engineRef }` comment warns about;
//   - TeletypePaint writes locals after render, which is the paint surface
//     accumulating strokes outside React;
//   - Meter trips an internal invariant, and VotePage uses `try/finally`, which
//     the compiler does not lower yet. Both are upstream, so re-check them on a
//     compiler upgrade rather than trying to satisfy them.
//
// Delete a line the moment its component compiles — the check says so when a
// recorded bailout stops happening.
const KNOWN = [
  ['src/ui/Meter.tsx', 'Expected value kind to be initialized'],
  ['src/ui/TeletypeDialog.tsx', 'Cannot access refs during render'],
  ['src/ui/TeletypePaint.tsx', 'Cannot modify local variables after render'],
  ['src/ui/TeletypePaint.tsx', 'Cannot modify local variables after render'],
  ['src/ui/useShortcuts.ts', 'Cannot access refs during render'],
  ['src/vote/VotePage.tsx', 'Handle TryStatement with a finalizer'],
  ['src/vote/VotePage.tsx', 'This value cannot be modified'],
]

async function sources(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await sources(full)))
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const files = (await sources(SRC)).sort()
const failures = []
const skipped = []
let optimized = 0

await Promise.all(
  files.map(async file => {
    const events = []
    try {
      await transformAsync(await readFile(file, 'utf8'), {
        filename: file,
        // Parsed rather than preset-stripped: @babel/preset-typescript is not a
        // dependency, and the compiler only needs to see the AST — nothing here
        // uses the emitted code.
        // JSX only for .tsx. Turning it on for a .ts file is not merely
        // pointless — it changes how `<T>` parses, so a plain generic arrow
        // (`const pick = <T>(xs: T[]) => …`, legal in a .ts and used in
        // clipLibrary.ts) comes back as an unclosed tag and the whole file is
        // reported as a bailout it never had.
        parserOpts: {
          plugins: file.endsWith('.tsx')
            ? ['typescript', 'jsx']
            : ['typescript'],
          sourceType: 'module',
        },
        plugins: [
          [compiler, { logger: { logEvent: (_f, e) => events.push(e) } }],
        ],
        configFile: false,
        babelrc: false,
      })
    } catch (err) {
      failures.push({ file, reason: `could not parse: ${err.message}` })
      return
    }
    for (const event of events) {
      if (FAILURES.has(event.kind)) {
        failures.push({
          file,
          fn: event.fnName,
          reason:
            event.detail?.reason ?? event.detail?.description ?? event.kind,
        })
      } else if (event.kind === 'CompileSkip') {
        skipped.push({ file, fn: event.fnName })
      } else if (event.kind === 'CompileSuccess') {
        optimized++
        if (verbose) console.log(`  ok  ${file} ${event.fnName ?? ''}`)
      }
    }
  }),
)

for (const skip of skipped) {
  console.log(`skipped: ${skip.file} ${skip.fn ?? ''} (opted out)`)
}

// Match each bailout against the baseline by file and reason, one recorded line
// consumed per occurrence, so a component that grows a *second* bailout is still
// reported.
const budget = new Map()
for (const [file, reason] of KNOWN) {
  const key = `${file}::${reason}`
  budget.set(key, (budget.get(key) ?? 0) + 1)
}
const fresh = []
for (const f of failures) {
  const key = [...budget.keys()].find(
    k => k.startsWith(`${f.file}::`) && f.reason.includes(k.split('::')[1]),
  )
  const left = key === undefined ? 0 : budget.get(key)
  if (key !== undefined && left > 0) {
    budget.set(key, left - 1)
  } else {
    fresh.push(f)
  }
}

// A recorded bailout that stopped happening is good news with an action
// attached: the line is now stale and the next real one could hide behind it.
for (const [key, left] of budget) {
  if (left > 0) {
    const [file, reason] = key.split('::')
    console.log(`fixed: ${file} no longer bails on "${reason}"`)
    console.log('       remove it from KNOWN in scripts/compilercheck.mjs')
  }
}

if (fresh.length > 0) {
  console.error(`\nReact Compiler could not optimize ${fresh.length}:`)
  for (const f of fresh) {
    console.error(`  ${f.file} ${f.fn ?? ''}\n    ${f.reason}`)
  }
  console.error(
    '\nThis component loses memoization silently — nothing else in the build\n' +
      'will tell you. See the header of scripts/compilercheck.mjs for the two\n' +
      'patterns that cause it.',
  )
  process.exit(1)
}

console.log(
  `React Compiler: ${optimized} components and hooks optimized across ` +
    `${files.length} files, ${KNOWN.length} known bailouts.`,
)
