/**
 * RAWG serves the original upload, whose size varies wildly — most covers are
 * ~1920x1080, but some are far larger (Marvel's Spider-Man is 9990x7940, about
 * 13MB). Downloading those for a card a few hundred pixels wide wastes
 * bandwidth and, in the WebGL hero, risks blowing past GPU texture limits.
 *
 * Their CDN takes a resize segment in the path and preserves aspect ratio.
 * Only certain widths are served: 200, 420, 600, 640, 1280 and 1920 work;
 * anything else (1200, 1024, 2560...) answers with a 307 to api.rawg.io and
 * the image never loads.
 * Covers (/media/games/) and screenshots (/media/screenshots/, 2560x1440
 * originals) are resized; anything else (other hosts, already-resized URLs)
 * is returned untouched.
 *
 * This matters for more than bandwidth: every image on screen is decoded to
 * its full size on the GPU whatever size it's shown at. A 2560x1440
 * screenshot is ~14MB of GPU memory even as a 136px thumbnail, and the game
 * page used to show a dozen of those (thumbnails, the viewer, the cycling
 * hero). A long session ran Chrome's GPU memory down until it stopped
 * redrawing parts of the page (stale, doubled text).
 *
 * CORS caveat: RAWG sends Access-Control-Allow-Origin only when the request
 * carries an Origin header, and caches for a year. A plain <img> and a CORS
 * fetch (e.g. a WebGL texture) of the SAME URL will therefore collide in the
 * browser cache and the CORS one fails. Consumers that need CORS must request
 * a width no plain-<img> consumer uses.
 */
export function gameArt(url, width = 640) {
  if (!url) return "";
  return url.replace(/\/media\/(games|screenshots)\//, `/media/resize/${width}/-/$1/`);
}
