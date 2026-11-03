'use strict';

/**
 * Link policy for the renderer.
 *
 * The app must never navigate itself to a web page: doing that replaces the note
 * UI with a web page and leaves the user with no way back (there is no address
 * bar). Everything the user may open is handed to the OS instead, and only these
 * schemes qualify - file:, javascript:, data: and custom app handlers stay shut.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** True when the URL uses a scheme we are willing to hand to the OS. */
function isOpenableLink(value) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(String(value)).protocol);
  } catch {
    // Not an absolute URL (relative paths, empty href, junk) - nothing to open.
    return false;
  }
}

/**
 * Hand the URL to the OS browser. Returns true only when it was actually passed on,
 * so callers can log or ignore unsupported links without try/catch noise.
 */
function openExternalLink(shell, value) {
  if (!isOpenableLink(value)) return false;
  shell.openExternal(String(value));
  return true;
}

module.exports = { isOpenableLink, openExternalLink };
