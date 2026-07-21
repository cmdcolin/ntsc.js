// Stamped at build time from package.json + the current git commit
// (see vite.config.ts `define`). Bumped via `pnpm push:{patch,minor,major}`.
declare const __APP_VERSION__: string
declare const __GIT_SHA__: string

export const version = __APP_VERSION__
export const gitSha = __GIT_SHA__
export const versionLabel = `v${version}`
