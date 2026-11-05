'use strict';

/**
 * Bake the site URL into the package instead of relying on a runtime env var.
 *
 * Why: `checkLatestRelease()` used `process.env.SITE_URL`, which is empty when
 * the app is launched by double-clicking the .app — so `fetch('/api/release')`
 * was an invalid URL and "check for updates" always failed. The URL now comes
 * from a generated file that electron-builder ships inside the app bundle.
 *
 * The origin comes from `site/site.config.json` (committed, single source);
 * `SITE_URL` / `CONTACT_EMAIL` in the environment or a local `.env` override it
 * for forks and private builds. The generated file stays git-ignored because it
 * ships inside the app bundle rather than living in the repo.
 *
 *   npm run dist                                    # uses site/site.config.json
 *   SITE_URL=https://example.com npm run dist       # override
 *   node scripts/write-site-config.cjs --require    # fail when no origin is known
 */
const fs = require('node:fs');
const path = require('node:path');

const repoDir = path.resolve(__dirname, '..');
const target = path.join(repoDir, 'electron', 'site.generated.json');
const requireUrl = process.argv.includes('--require');

/** Minimal `.env` reader: `KEY=value`, optional quotes, no interpolation. */
function fromDotEnv(key) {
  const file = path.join(repoDir, '.env');
  if (!fs.existsSync(file)) return '';
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(pattern);
    if (match) return match[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
}

/** Field names in site/site.config.json, keyed by the env-var name used here. */
const SITE_CONFIG_FIELDS = { SITE_URL: 'siteUrl', CONTACT_EMAIL: 'contactEmail' };

/** The committed origin in site/site.config.json: one file holds the public URL. */
function fromSiteConfig(key) {
  const field = SITE_CONFIG_FIELDS[key];
  if (!field) return '';
  try {
    const file = path.join(repoDir, 'site', 'site.config.json');
    return String(JSON.parse(fs.readFileSync(file, 'utf8'))[field] ?? '');
  } catch {
    return '';
  }
}

const read = (key) => (process.env[key] || fromDotEnv(key) || fromSiteConfig(key)).trim();

const raw = read('SITE_URL').replace(/\/+$/, '');
const contactEmail = read('CONTACT_EMAIL');

if (!raw) {
  if (requireUrl) {
    console.error(
      'error: no site origin — set "siteUrl" in site/site.config.json or SITE_URL in the environment',
    );
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

if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
  console.error(`error: CONTACT_EMAIL is not an email address, got "${contactEmail}"`);
  process.exit(1);
}

fs.writeFileSync(target, `${JSON.stringify({ siteUrl: raw, contactEmail }, null, 2)}\n`);
console.log(`site config written for ${raw}${contactEmail ? ` (contact: ${contactEmail})` : ''}`);
