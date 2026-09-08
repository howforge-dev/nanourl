// The two viewports this suite runs at, defined once.
//
// `playwright.config.ts`'s two projects and the four in-spec
// `setViewportSize` toggles were six copies of 375x667 and five of 1280x800.
// Specs toggle explicitly where an assertion is viewport-dependent, so a spec
// that resizes to "mobile" and back to "desktop" must land on exactly the
// project sizes — otherwise the mobile project silently finishes a test at a
// viewport it never started at.
export const MOBILE = { width: 375, height: 667 } as const;
export const DESKTOP = { width: 1280, height: 800 } as const;
