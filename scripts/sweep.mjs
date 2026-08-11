// Which browser harnesses still work?
//
//   node scripts/sweep.mjs [port] [--only name,name] [--skip name,name]
//
// Needs a dev server on that port, on a worktree copy if anything else might be
// editing (docs/DEVELOPMENT.md). Runs each check against it in turn and prints
// one line per harness, then a roll-up.
//
// **Why this exists.** The unit suite runs on every push; not one browser
// harness does, because they need Firefox Nightly with WebGPU and CI has
// neither. So a harness can stop working and say nothing — and two of them had.
// `poolcheck`, the only coverage of the two live archives, was failing all
// twenty-six of its checks; `composecheck` was reading the chain map's zoom
// slider and reporting a CSS layer as broken that was not. Both were found by
// accident, months of commits after the panel change that broke them. A sweep
// is the cheapest thing that would have caught either.
//
// It reports each harness's own exit code and nothing cleverer. These scripts
// already print a line per check and exit non-zero on failure; the job here is
// only to run all of them and say which ones came back green, so a harness that
// has quietly died is a line in a list rather than a discovery.
//
// **Not everything in scripts/ belongs here**, and what is left out is as much
// the point as what is in:
//
//   - the device-torture harnesses (`deviceloss`, `devicetear`, `gpusleep`,
//     `rafceiling`, `soak`) deliberately break or exhaust a GPU device, which
//     is not something to do to a machine on the way past — and adr/0004 is
//     about what one of them costs a tab. Run those on purpose.
//   - the generators (`docshots`, `panelshots`, `gallery`, `logo`, `diagrams`,
//     `clips`, `labels`, `contact`) write files rather than judging anything.
//   - `compilercheck` and `guidecheck` need no server and already run in CI as
//     `pnpm compiler` and `pnpm guide:check`.
//   - `perf`, `loopseek`, `pullstep`, `codeccheck`, `pixdiff` and `affinity`
//     are measurements. They report numbers a human reads; there is no pass to
//     report. The two newest are why the frame-exact pull is built the way it
//     is — one closed the seek route and one opened the decoder route — and
//     both are worth re-running deliberately against a new browser build rather
//     than on the way past.
//
// **Two entries bring their own server**, which is a departure worth naming:
// `demuxcheck` and `pullcheck` build their own fixtures and serve them, because
// what they test is a file being read rather than the app being driven. They
// take the port and ignore it.

import { STALL_EXIT } from './frames.mjs'

import { spawn } from 'node:child_process'
import process from 'node:process'

const arg = name => {
  const at = process.argv.indexOf(name)
  return at > 0 ? (process.argv[at + 1] ?? '') : null
}
const port = (process.argv[2] ?? '5199').replace(/^--.*/, '5199')
const only = arg('--only')?.split(',').filter(Boolean) ?? null
const skip = arg('--skip')?.split(',').filter(Boolean) ?? []
const origin = `http://localhost:${port}`

// Each harness takes the server a different way, which is history rather than
// design — spelled out here rather than normalised, because rewriting fourteen
// argument conventions is a bigger change than this file is worth.
const HARNESSES = [
  { name: 'faultcheck', args: [port] },
  { name: 'traycheck', args: [port] },
  { name: 'prerollcheck', args: [port] },
  { name: 'clockcheck', args: [port] },
  { name: 'rendercheck', args: [port] },
  { name: 'reccheck', args: [port] },
  { name: 'cuecheck', args: [port] },
  { name: 'sourcecheck', args: [`${origin}/`] },
  { name: 'composecheck', args: [`${origin}/`] },
  { name: 'panelcheck', args: [`${origin}/`] },
  { name: 'midicheck', args: [`${origin}/`] },
  { name: 'pixelcheck', args: ['--url', `${origin}/`] },
  // These two serve themselves; see the note above.
  { name: 'demuxcheck', args: [] },
  { name: 'pullcheck', args: ['--frames=60'] },
  // Last, and on its own footing: this one talks to Wikimedia and archive.org,
  // so it is the only entry here that can fail for a reason that is nobody's
  // bug. A run that fails only this is a network, not a regression.
  { name: 'poolcheck', args: [origin], live: true },
]

const wanted = HARNESSES.filter(
  h => (only === null || only.includes(h.name)) && !skip.includes(h.name),
)

const run = h =>
  new Promise(resolve => {
    const began = Date.now()
    const child = spawn(
      process.execPath,
      [`scripts/${h.name}.mjs`, ...h.args],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    // A harness that hangs is a harness that failed, and one of them holding
    // the sweep open all afternoon would defeat the point of running them all.
    const killer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000)
    child.on('close', code => {
      clearTimeout(killer)
      resolve({
        ...h,
        code,
        out,
        secs: Math.round((Date.now() - began) / 1000),
      })
    })
  })

console.log(`sweeping ${wanted.length} harnesses against ${origin}\n`)
const results = []
for (const h of wanted) {
  process.stdout.write(`  ${h.name.padEnd(14)} `)
  const r = await run(h)
  results.push(r)
  // The harness's own last line is the most useful summary it has — every one
  // of these ends with a verdict.
  const last =
    r.out
      .trimEnd()
      .split('\n')
      .filter(l => l.trim() !== '')
      .at(-1) ?? ''
  const mark = r.code === 0 ? 'ok  ' : r.code === STALL_EXIT ? 'STALL' : 'FAIL'
  console.log(`${mark} ${String(r.secs).padStart(3)}s  ${last.slice(0, 68)}`)
}

// Three outcomes, not two. A harness whose window was covered or clicked away
// measured nothing, and calling that a failure sends the next person looking
// for a bug in a feature that never ran — see frames.mjs. It is not a pass
// either, so the sweep still exits non-zero and says what to do about it.
const stalled = results.filter(r => r.code === STALL_EXIT)
const bad = results.filter(r => r.code !== 0 && r.code !== STALL_EXIT)
console.log(
  `\n${results.length - bad.length - stalled.length}/${results.length} green` +
    (stalled.length === 0
      ? ''
      : `, ${stalled.length} stalled (${stalled.map(r => r.name).join(', ')}) —` +
        ` those measured nothing. Leave the window in front and run them again.`),
)
for (const r of bad) {
  console.log(
    `\n--- ${r.name} (exit ${r.code})${r.live ? ' — live network' : ''}`,
  )
  // The failing lines, not the whole run: these scripts print a line per check
  // and the passing ones are noise here.
  const lines = r.out
    .split('\n')
    .filter(l => /FAIL|Error|error:/.test(l))
    .slice(0, 12)
  console.log(lines.length === 0 ? r.out.slice(-600) : lines.join('\n'))
}
process.exit(bad.length === 0 && stalled.length === 0 ? 0 : 1)
