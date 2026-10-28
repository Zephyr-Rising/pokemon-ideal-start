/**
 * Single source of truth for the GitHub Pages deployment path.
 *
 * A project page is served from https://<user>.github.io/<repo>/, not from the
 * domain root, so the build needs a matching `base` or every asset URL breaks.
 * Vite, the preview server and the Playwright smoke test all read it from here
 * — if you rename the repository, change this one line.
 */
export const PAGES_BASE = '/pokemon-ideal-start/'

/** Port the production preview runs on for the browser smoke test. */
export const PREVIEW_PORT = 4173
