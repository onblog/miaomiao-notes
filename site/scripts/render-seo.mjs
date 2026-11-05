#!/usr/bin/env node
/**
 * Render the SEO files for a static site: /sitemap.xml, /robots.txt, and any
 * `__SITE_URL__` placeholder inside the listed HTML files.
 *
 * The production domain lives in exactly one place: `site.config.json`
 * (`siteUrl`) next to this package. It is committed on purpose — a public
 * origin is an identifier, not a secret — so a clone builds the real site with
 * no extra setup. `SITE_URL` in the environment overrides it for forks.
 *
 * Every HTML file writes `__SITE_URL__` where the origin belongs; this script
 * replaces that placeholder, so no page carries a hardcoded domain.
 *
 * Usage: node scripts/render-seo.mjs                                # site.config.json
 *        SITE_URL=https://example.com node scripts/render-seo.mjs   # override
 * Config: seo.config.json (relative to `site/`)
 *   {
 *     "outDir": "public",              // where sitemap.xml and robots.txt go
 *     "html": ["public/index.html"],   // files whose __SITE_URL__ is replaced
 *     "pages": ["/", "/about.html"]    // paths listed in the sitemap
 *   }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, 'seo.config.json');
const SITE_CONFIG_PATH = join(ROOT, 'site.config.json');

/** The committed origin: the single source of truth for every URL this script emits. */
function configuredSiteUrl() {
  try {
    return String(JSON.parse(readFileSync(SITE_CONFIG_PATH, 'utf8')).siteUrl ?? '').trim();
  } catch {
    return '';
  }
}

/** Environment first so a fork can point at its own domain without editing files. */
const siteUrl = ((process.env.SITE_URL ?? '').trim() || configuredSiteUrl()).replace(/\/+$/, '');
if (!siteUrl) {
  console.error(
    'render-seo: no site origin.\n' +
      '  Set "siteUrl" in site/site.config.json, or pass SITE_URL in the environment.',
  );
  process.exit(1);
}

if (!/^https?:\/\//.test(siteUrl)) {
  console.error(`render-seo: SITE_URL must start with http:// or https:// (got "${siteUrl}")`);
  process.exit(1);
}

if (!existsSync(CONFIG_PATH)) {
  console.error('render-seo: seo.config.json not found');
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const outDir = join(ROOT, config.outDir ?? 'public');
const pages = Array.isArray(config.pages) && config.pages.length ? config.pages : ['/'];
const htmlFiles = Array.isArray(config.html) ? config.html : [];

const PLACEHOLDER = '__SITE_URL__';

// --- sitemap.xml -----------------------------------------------------------
// Framework builds (Astro, VitePress) can emit their own sitemap; set
// "sitemap": false in seo.config.json to leave that to the framework.
if (config.sitemap !== false) {
  const urls = pages
    .map((path) => `  <url>\n    <loc>${siteUrl}${path}</loc>\n  </url>`)
    .join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  writeFileSync(join(outDir, 'sitemap.xml'), sitemap);
}

// --- robots.txt ------------------------------------------------------------
writeFileSync(
  join(outDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
);

// --- __SITE_URL__ placeholders in HTML -------------------------------------
let replaced = 0;
for (const file of htmlFiles) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    console.warn(`render-seo: html file not found, skipped: ${file}`);
    continue;
  }
  const before = readFileSync(path, 'utf8');
  if (!before.includes(PLACEHOLDER)) continue;
  writeFileSync(path, before.split(PLACEHOLDER).join(siteUrl));
  replaced += 1;
}

console.log(
  `render-seo: ${siteUrl} -> sitemap.xml (${pages.length} urls), robots.txt, ${replaced} html file(s)`,
);
