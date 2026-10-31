'use strict';

/**
 * Bake the site URL into the package instead of relying on a runtime env var.
 *
 * Why: `checkLatestRelease()` used `process.env.SITE_URL`, which is empty when
 * the app is launched by double-clicking the .app — so `fetch('/api/release')`
 * was an invalid URL and "check for updates" always failed. The URL now comes
 * from a generated file that electron-builder ships inside the app bundle.
 *
 * The domain must never live in the repo, so this file is written at build time
 * from the environment (or a local .env) and is git-ignored.
 *
 *   SITE_URL=https://example.com npm run dist   # normal release build
 *   node scripts/write-site-config.cjs --require  # fail when the URL is missing
 */
const fs = require('node:fs');
const path = require('node:path');

const repoDir = path.resolve(__dirname, '..');
const target = path.join(repoDir, 'electron', 'site.generated.json');
const requireUrl = process.argv.includes('--require');

function fromDotEnv() {
  const file = path.join(repoDir, '.env');
  if (!fs.existsSync(file)) return '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*SITE_URL\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}

const raw = (process.env.SITE_URL || fromDotEnv()).trim().replace(/\/+$/, '');

if (!raw) {
  if (requireUrl) {
    console.error('error: SITE_URL is required for a release build (env or .env)');
    process.exit(1);
  }
  fs.rmSync(target, { force: true });
  console.warn('warn: SITE_URL not set — update check and stats will stay disabled in this build');
  process.exit(0);
}

if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw)) {
  console.error(`error: SITE_URL must be an absolute http(s) origin, got "${raw}"`);
  process.exit(1);
}

fs.writeFileSync(target, `${JSON.stringify({ siteUrl: raw }, null, 2)}\n`);
console.log(`site config written for ${raw}`);
