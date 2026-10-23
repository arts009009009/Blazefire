/**
 * postinstall shim.
 *
 * Runs the compiled activation engine when it exists (published package or a
 * built checkout) and stays silent when it does not (fresh git clone before
 * `npm run build`). A postinstall must NEVER break someone's install — that
 * rule lives in dist/postinstall/run.js too; this shim only covers the
 * "dist not built yet" case.
 */
try {
  const module = await import(new URL('../dist/postinstall/run.js', import.meta.url).href)
  await module.main()
} catch {
  // dist missing or broken — skip activation silently.
}
