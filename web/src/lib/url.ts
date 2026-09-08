// URL predicates the UI needs. Kept apart from `alphabet.ts`, which is about
// the codec's *output* charsets: these are questions about an input URL.

/** Is this something a browser will navigate to as a web page? Guards every
 *  place the app turns a decoded string into a real `<a href>` or a redirect,
 *  so a decoded `javascript:` or `data:` string is rendered as text. */
export const isHttp = (u: string): boolean => /^https?:\/\//i.test(u);
