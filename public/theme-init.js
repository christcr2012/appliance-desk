/* Runs once, synchronously, before the page paints — sets the .dark
 * class immediately so there's no flash of the wrong theme while React
 * hydrates. See src/lib/theme.ts's THEME_INIT_SCRIPT (this file's exact
 * content is kept identical to that string — tests/theme.test.ts checks
 * that they never drift apart).
 *
 * Served as a real static file, not an inline <script>, since 2026-09-29
 * (added alongside the new Content-Security-Policy header): a script's
 * `src` isn't restricted by CSP's `script-src 'self'` the way an inline
 * script would be, so this is the one change that let the CSP lock down
 * script-src to 'self' with no 'unsafe-inline' exception at all — the
 * strongest, safest setting.
 */
(function() {
  try {
    var pref = localStorage.getItem("theme") || "system";
    var isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
