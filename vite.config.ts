import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

import pkg from './package.json' with { type: 'json' }
import { ytdlp } from './vite-plugin-ytdlp.ts'

import { execSync } from 'node:child_process'

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// Relative base so the build runs from any sub-path (Pages project site, a
// moved/renamed repo, a subfolder). Dev + screenshot harness stay at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  // React Compiler memoizes components and hook results itself, so the UI
  // doesn't hand-maintain useMemo/useCallback around the engine handoffs.
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), ytdlp()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  // Two pages: the instrument, and the labelling tool that builds a preference
  // dataset out of it (src/vote). The vote page is its own entry rather than a
  // dialog because it wants the whole screen and its own engine, and because
  // nothing in it should cost the app a byte — a visitor to index.html never
  // downloads it.
  //
  // Naming any input at all means naming index.html too: rollupOptions.input
  // replaces vite's default entry rather than adding to it, so leaving it out
  // would build a project whose main page is the vote page.
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        vote: 'vote.html',
      },
    },
  },
  // Preferred port for the screenshot harness (scripts/shot.mjs, README);
  // falls back to the next free port if it's taken.
  //
  // forwardConsole patches console.* to relay logs to the dev server, which
  // reports every message at the patch site inside Vite's client instead of
  // where it was logged. The render loop's whole diagnostic story is console
  // breadcrumbs, so the real source location is worth more than the relay.
  server: { port: 5199, forwardConsole: false },
  // **`pnpm test` must not run other checkouts' tests.** Work here happens in
  // `git worktree` copies under `.claude/worktrees/`, which are full checkouts
  // with their own `src/` — and vitest's default `include` is a glob over the
  // whole tree, so a run from the primary checkout collects every worktree's
  // suite as well as its own. Measured: 374 test files and 6746 tests against
  // this checkout's 68 and 1357.
  //
  // That is not merely slow. It means a half-finished branch someone else is
  // working on can fail *your* test run, in files you have never opened, and
  // the failure names a path that looks like yours because every worktree has
  // the same layout.
  //
  // Spread over the defaults rather than replacing them, so `node_modules` and
  // `dist` stay excluded — passing a bare array here silently drops both.
  test: { exclude: [...configDefaults.exclude, '**/.claude/**'] },
}))
