# Architecture decision records

Short notes on decisions that are expensive to rediscover — where the reasoning
matters more than the diff, and where a later reader would otherwise be within
their rights to "fix" the thing on purpose.

This is not a process. Most changes need no record at all; `ARCHITECTURE.md`
covers how the system is built and the code comments carry the local why. An ADR
earns its place when **the obvious thing is wrong for a non-obvious reason** —
usually a measured constraint the code cannot state for itself.

One file per decision, `NNNN-kebab-title.md`, numbered in order and never
renumbered. Keep the shape:

- **Status** — accepted / superseded by NNNN. Records are not edited into a new
  opinion; a reversal is a new record that supersedes this one, because the
  wrong turn is usually the more useful half.
- **Context** — what was measured or observed. Numbers, not adjectives.
- **Decision** — what was done.
- **Consequences** — what this costs, and what it forbids. The forbidding is the
  point: it is what stops the decision being quietly undone.

Where the working-out lives, when it is long: `docs/handoffs/`. An ADR should be
readable without it.

| #                                                 | decision                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| [0001](0001-hang-rebuilds-not-ends.md)            | A GPU hang rebuilds the device instead of ending the session            |
| [0002](0002-webgpu-sessions-are-scarce.md)        | Treat per-tab WebGPU sessions as a scarce budget _(superseded by 0004)_ |
| [0003](0003-delete-the-worker-engine.md)          | Delete the worker-hosted engine                                         |
| [0004](0004-never-destroy-a-presenting-device.md) | Never destroy a GPUDevice that has been presenting                      |
| [0005](0005-saved-profiles-need-an-account.md)    | Saved profiles live in Firestore, and need an account                   |
