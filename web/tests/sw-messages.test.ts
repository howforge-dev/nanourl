import { describe, it, expect } from 'vitest';
import { isSkipWaitingMessage, SKIP_WAITING_MESSAGE } from '../src/lib/sw-messages';

// Unit coverage for src/sw.ts's `message` handler predicate, the only
// thing allowed to call self.skipWaiting(): install must never call it
// unconditionally, or a waiting worker would activate before the user
// approves the reload.
describe('isSkipWaitingMessage', () => {
  it('true for the exact message BuildInfo.svelte posts', () => {
    expect(isSkipWaitingMessage(SKIP_WAITING_MESSAGE)).toBe(true);
    expect(isSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(true);
  });
  it('false for anything else, so an unrelated message never triggers skipWaiting', () => {
    expect(isSkipWaitingMessage(undefined)).toBe(false);
    expect(isSkipWaitingMessage(null)).toBe(false);
    expect(isSkipWaitingMessage('SKIP_WAITING')).toBe(false);
    expect(isSkipWaitingMessage(42)).toBe(false);
    expect(isSkipWaitingMessage({})).toBe(false);
    expect(isSkipWaitingMessage({ type: 'OTHER' })).toBe(false);
    expect(isSkipWaitingMessage({ TYPE: 'SKIP_WAITING' })).toBe(false);
  });
});
