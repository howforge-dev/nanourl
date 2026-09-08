// Message-protocol helpers shared between src/sw.ts's `message` event
// handler and BuildInfo.svelte's "reload" button — split out (same pattern
// as sw-routes.ts) so vitest can exercise the predicate without a real
// ServiceWorkerGlobalScope. See tests/sw-messages.test.ts.
//
// A new service worker never
// calls self.skipWaiting() on its own — it parks itself as
// `registration.waiting` until every client of the previous worker
// naturally drops off, or until the user explicitly asks for the update via
// BuildInfo's "reload" button, which posts SKIP_WAITING_MESSAGE to that
// waiting worker. Only the worker itself calls skipWaiting(), from its own
// `message` handler — see src/sw.ts.

/** The exact message BuildInfo.svelte posts to `registration.waiting`. */
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

/** True for exactly that message — anything else (an unrelated message, a
 * malformed payload, `undefined`) is ignored rather than accidentally
 * calling skipWaiting() on some other postMessage entirely. */
export function isSkipWaitingMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'SKIP_WAITING';
}
