// The static server's port, in one place.
//
// `playwright.config.ts` always passes `--port`, so `serve.ts`'s own default
// is dead code, but "dead" and "wrong" look identical until someone runs
// `tsx e2e/serve.ts` by hand and gets a different port from the one the config
// would have used. Both read this.
//
// 4173 is `vite preview`'s default, which is exactly why the config refuses to
// adopt an existing server on it: a sibling worktree's preview may already be
// there. Override with `PW_PORT=4408 pnpm exec playwright test`.
export const DEFAULT_PREVIEW_PORT = 4173;
