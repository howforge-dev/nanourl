// URL predicates the UI needs. Small, but it was parked in `alphabet.ts`,
// which is about the codec's *output* charsets — three consumers reached into
// an alphabet module to ask a question about an input URL.

/** Is this something a browser will navigate to as a web page? Guards every
 *  place the app turns a decoded string into a real `<a href>` or a redirect,
 *  so a decoded `javascript:` or `data:` string is rendered as text. */
export const isHttp = (u: string): boolean => /^https?:\/\//i.test(u);
