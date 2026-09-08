<script lang="ts">
  // The durability claim, under the compressor and outside the advanced
  // disclosure: a visitor deciding whether to hand someone one of these links
  // has to be able to read it without opening anything.
  import { MODEL_RELEASE_URL, RELEASES_URL, SITE_URL } from '../../lib/links';
  import { TESTID } from '../../lib/testids';
</script>

<section data-testid={TESTID.outlive}>
  <h2>Your links outlive this site</h2>
  <p>
    The code after the <code>#</code> is the whole message: the URL is compressed into it, not stored
    under it.
  </p>
  <p>
    The <a href={MODEL_RELEASE_URL}>model weights</a> and the
    <a href={RELEASES_URL}><code>nanourl</code> command-line tool</a> are both published, and the tool
    decodes any link on your own machine with no network:
    <code class="cmd">nanourl decode {SITE_URL}#…</code>
  </p>
  <p>
    Nothing is kept server-side, so there is no database to lose and no redirect to expire. The one
    exception is a <em>short link</em> made with the button: <code>{SITE_URL}ABC123</code> is a row in
    a database and lasts as long as this service does.
  </p>
</section>

<style>
  /* A rule above it rather than a card: this is a footnote to the compressor,
     not a third panel competing with the two tab panes. */
  section {
    margin-top: var(--s-5);
    padding-top: var(--s-4);
    border-top: var(--border);
    color: var(--dim);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }
  h2 { color: var(--txt); font-size: var(--fs-md); margin: 0 0 var(--s-2); }
  p { margin: 0 0 var(--s-2); }
  code { font-family: var(--font-mono); font-size: var(--fs-xs); }
  /* Links in a footnote read as the footnote: same dim ink, an underline as
     the only cue, and the accent kept for hover. */
  a { color: inherit; text-decoration: underline; text-underline-offset: 0.15em; }
  a:hover { color: var(--acc); }
  /* The one command a reader might retype, so it wraps at the '#' rather than
     forcing the column wider on a phone. */
  .cmd { color: var(--txt); overflow-wrap: anywhere; }
</style>
