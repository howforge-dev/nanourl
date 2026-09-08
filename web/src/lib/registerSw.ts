// Registers the offline-shell service worker (src/sw.ts) — called
// once from every page entry's main.ts. Deferred to the window `load` event
// so it never competes with a page's own critical first work, most notably
// index.html's redirect fast path (Redirect.svelte's hash-decode-then-
// location.replace flow): `load` fires only once every subresource of the
// *current* navigation has finished, well after that flow has already begun
// (it starts synchronously off the codec load, inside App.svelte's onMount,
// which runs long before `load`) — registration is armed here but never
// actually starts before the redirect decision is already in flight.
// Feature-detected: silently a no-op in a browser without
// navigator.serviceWorker (which also covers a non-secure-context http
// origin, where the API doesn't exist at all).
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* best-effort — offline support degrading to none is never fatal */
    });
  });
}
