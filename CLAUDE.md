# ntsc.js

Real-time NTSC signal-path simulator rendered entirely in WebGPU compute
shaders.

## Read first

**`docs/ARCHITECTURE.md`** — read it before changing anything non-trivial. It
covers the pass graph, buffer layouts, how to add a control end to end, and the
two invariants that are easiest to violate:

- **Which domain an effect belongs to.** A horizontal displacement means
  something different in the signal, sync, and deflection domains — they are not
  interchangeable, and routing a geometry fault through the sync path will spin
  hue that should have stayed put.
- **`decode` stages a shared tile per row**, so horizontal offsets must be
  row-uniform. Per-pixel horizontal scaling needs the staging restructured
  first.

Prefer modelling the mechanism that causes an artifact over drawing the artifact
— that is the whole premise, and it is why mechanisms here interact for free.

**`docs/adr/`** holds the decisions where the obvious thing is wrong for a
non-obvious reason. Read [0002](docs/adr/0002-webgpu-sessions-are-scarce.md)
before touching anything that creates a `GPUDevice` — see below for why.

## A tab is worth about two WebGPU sessions

Measured on Firefox Nightly / Linux: the third `GPUDevice` created in one tab
loads fine, reports no error, and that tab is never given an animation frame
again. The tab still reports `visible`, the browser stays responsive, and
**reloading lands in the same hole** — only a new tab clears it.
`scripts/rafceiling.mjs` shows it in thirty seconds against a control page that
takes 21 reloads without dropping a frame.

What follows for anyone working here:

- **When testing by hand or by harness, do not reload the app over and over in
  one tab.** Two reloads is the budget. A new tab, or a fresh browser per
  session, costs nothing and is the difference between a real result and chasing
  a freeze you caused.
- **HMR spends it too**, because a hot update recreates the engine. A dev
  session that edits `src/gpu/` or `src/ui/useEngine.ts` a few times will freeze
  the tab; that is expected, not a regression you introduced. Open a new tab and
  carry on. Disabling HMR does not help — a full reload is another session.
- **Do not add `<StrictMode>`.** It would double device creation per mount and
  spend the whole budget on first load. `src/main.tsx` carries the reason.
- A freeze with `frame 0` / `STEP-DEAD` / `clock +0ms` in the console or the
  recorder is this, not a bug in the signal path.

## Testing changes for real

Long or repeated browser runs belong on a `git worktree add --detach` copy with
its own vite server. This worktree is shared with other agents, and **your own
edits are HMR** — an `src/` write mid-run reloads the page and resets the engine
under whatever you were measuring. See the traps list in `docs/DEVELOPMENT.md`;
every one of them cost real time.

## Commits

Use Conventional Commits (`type(scope): description`) — `cliff.toml` groups the
changelog by type and renders the scope inline. Scope is optional; when used,
pick from the domains in `docs/ARCHITECTURE.md`: `signal`, `sync`, `deflection`,
`gpu`, `ui`, `midi`, `audio`, `docs`.

## Testing WebGPU (Linux)

On Linux, test WebGPU with **Firefox Nightly** (`/usr/bin/firefox-nightly`), not
Chrome. Chrome's ANGLE/Vulkan backend on Linux reports spurious
texture-allocation errors (e.g. "Requested allocation size … is smaller than the
image requires") that are driver artifacts, not app bugs. The `scripts/shot.mjs`
harness already launches Firefox Nightly with the right prefs — model new
harnesses on it.
