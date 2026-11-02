/**
 * Miaomiao Notes — official site worker.
 *
 * Only /api/* reaches this script (see run_worker_first in wrangler.jsonc);
 * every other request is served straight from the static asset layer, which
 * keeps the site free and fast.
 *
 * Privacy: this worker stores no IP addresses, sets no cookies and calls no
 * third parties. It writes standard Workers Logs for debugging (retained for
 * a few days by Cloudflare), and its only application state is a 60 second
 * in-memory cache of the release manifest plus the D1 launch counters.
 */

// The bucket (`common`) is shared with the other projects, so every key carries
// this project's prefix: common → miaomiao-notes/releases/latest.json.
const KEY_PREFIX = 'miaomiao-notes/';
const MANIFEST_KEY = `${KEY_PREFIX}releases/latest.json`;
const CACHE_TTL_MS = 60_000;
const ALLOWED_ARCH = new Set(['arm64', 'x64']);

let manifestCache = { value: null, at: 0 };

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function fail(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}

async function readManifest(env, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && manifestCache.value && now - manifestCache.at < CACHE_TTL_MS) {
    return manifestCache.value;
  }

  const object = await env.R2_RELEASES.get(MANIFEST_KEY);
  if (!object) return null;

  let parsed;
  try {
    parsed = await object.json();
  } catch {
    return null;
  }

  manifestCache = { value: parsed, at: now };
  return parsed;
}

/** Public shape: never expose the internal R2 key. */
function publicManifest(manifest) {
  const files = {};
  for (const arch of ['arm64', 'x64']) {
    const file = manifest?.files?.[arch];
    if (!file) continue;
    files[arch] = {
      name: file.name,
      size: file.size ?? null,
      // 版本号进 URL：发版后旧链接指向的字节永远不会被拼到新文件里
      url: `/api/download?arch=${arch}&v=${encodeURIComponent(manifest.version)}`,
    };
  }
  return {
    version: manifest.version,
    released_at: manifest.released_at ?? null,
    files,
  };
}

async function handleRelease(env, url) {
  const manifest = await readManifest(env, { fresh: url?.searchParams.get('fresh') === '1' });
  if (!manifest) {
    return fail(503, 'release_unavailable', '安装包还没上传，稍后再来喵～');
  }
  // 版本号必须强一致：缓存 60 秒会让页面拿着旧 size 去切新文件的段。
  return json(200, { ok: true, data: publicManifest(manifest) });
}

async function handleDownload(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return fail(405, 'method_not_allowed_on_path', '只支持 GET 下载');
  }

  const arch = url.searchParams.get('arch');
  if (!ALLOWED_ARCH.has(arch)) {
    return fail(400, 'bad_request', '未知的架构，请使用 arm64 或 x64');
  }

  let manifest = await readManifest(env);

  // 客户端带着版本号来下载时，必须和这一版的对象严格对应。
  // 否则会出现「用旧 size 切新文件」——前端拼出来的 dmg 少掉一截，用户只看到
  // 「文件已损坏」。宁可让他刷新页面重下，也不能给他一个坏包。
  const wantedVersion = url.searchParams.get('v');
  if (wantedVersion && manifest?.version !== wantedVersion) {
    manifest = await readManifest(env, { fresh: true });
    if (manifest?.version !== wantedVersion) {
      return fail(
        409,
        'conflict',
        `安装包已更新到 ${manifest?.version ?? '新版本'}，请刷新页面后重新下载`,
      );
    }
  }

  const file = manifest?.files?.[arch];
  if (!manifest || !file?.key) {
    return fail(404, 'not_found', '当前版本没有这个架构的安装包');
  }

  // Only hand the Range header to R2 when the client actually asked for one,
  // otherwise R2 may return a ranged object for a plain GET.
  let useRange = Boolean(request.headers.get('range'));

  // If-Range：浏览器续传时会带上它。对象已经换成新版本时必须回 200 全量，
  // 让客户端从头下，而不是把新版本的尾巴接到旧版本的前半截上。
  const ifRange = request.headers.get('if-range');
  if (useRange && ifRange) {
    const head = await env.R2_RELEASES.head(file.key);
    const etag = head?.httpEtag;
    if (!etag || ifRange.trim() !== etag) useRange = false;
  }

  const object = await env.R2_RELEASES.get(
    file.key,
    useRange ? { range: request.headers } : undefined,
  );

  if (!object) {
    return fail(404, 'not_found', '安装包文件不存在');
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${safeFilename(file.name)}"`);
  headers.set('Cache-Control', 'no-store');
  headers.set('Accept-Ranges', 'bytes');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);

  let status = 200;
  let body = object.body;

  if (body === null) {
    // A conditional request that only satisfied a precondition comes back body-less.
    status = 304;
  } else if (useRange && object.range) {
    // R2 reports a range even for plain GETs, so gate 206 on the request header.
    status = 206;
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
  } else {
    headers.set('Content-Length', String(object.size));
  }

  return new Response(body, { status, headers });
}

/** Strip any character that could break the header or the filesystem. */
function safeFilename(name) {
  const base = String(name || 'miaomiao-notes.dmg').split('/').pop();
  return base.replace(/[^\w.\-]+/g, '-');
}


/* ---------------------------------------------------------------- stats */

const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UTC date as YYYY-MM-DD, so a launch always lands on exactly one day. */
function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record one app launch.
 *
 * Privacy: only a random device id (generated locally by the app) plus the
 * request's coarse geo headers are stored. No IP, no user agent, no hardware
 * details. `request.cf` only exists on Cloudflare; locally every field is null.
 */
async function handlePing(request, env) {
  if (request.method !== 'POST') {
    return fail(405, 'method_not_allowed_on_path', '只支持 POST');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_request', '请求体不是合法 JSON');
  }

  const device = String(body?.device || '');
  if (!DEVICE_ID_RE.test(device)) {
    return fail(400, 'bad_request', 'device 必须是 UUID');
  }

  const cf = request.cf || {};
  const country = cf.country || null;
  const region = cf.region || null;
  const city = cf.city || null;

  try {
    await env.DB.prepare(
      `INSERT INTO notes_launches (device_id, date, country, region, city, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(device, utcDate(), country, region, city, Date.now())
      .run();
  } catch (error) {
    console.error('[ping] insert failed', error);
    return fail(500, 'internal_error', '记录失败');
  }

  return json(200, { ok: true });
}

/** Aggregate counts only — the public endpoint never exposes device ids. */
async function handleStats(env) {
  const today = utcDate();
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const [total, todayRow, weekRow, cities, countries, daily] = await Promise.all([
    env.DB.prepare('SELECT COUNT(DISTINCT device_id) AS n FROM notes_launches').first(),
    env.DB.prepare('SELECT COUNT(DISTINCT device_id) AS n FROM notes_launches WHERE date = ?')
      .bind(today)
      .first(),
    env.DB.prepare('SELECT COUNT(DISTINCT device_id) AS n FROM notes_launches WHERE date >= ?')
      .bind(weekAgo)
      .first(),
    env.DB.prepare(
      `SELECT city, country, COUNT(DISTINCT device_id) AS devices
       FROM notes_launches
       WHERE city IS NOT NULL AND city != ''
       GROUP BY city, country
       ORDER BY devices DESC, city ASC
       LIMIT 40`,
    ).all(),
    env.DB.prepare(
      `SELECT country, COUNT(DISTINCT device_id) AS devices
       FROM notes_launches
       WHERE country IS NOT NULL AND country != ''
       GROUP BY country
       ORDER BY devices DESC`,
    ).all(),
    env.DB.prepare(
      `SELECT date, COUNT(DISTINCT device_id) AS uv
       FROM notes_launches
       GROUP BY date
       ORDER BY date DESC
       LIMIT 30`,
    ).all(),
  ]);

  return json(
    200,
    {
      ok: true,
      data: {
        totalDevices: total?.n ?? 0,
        todayDevices: todayRow?.n ?? 0,
        weekDevices: weekRow?.n ?? 0,
        cities: (cities?.results || []).map((row) => ({
          city: row.city,
          country: row.country,
          devices: row.devices,
        })),
        countries: (countries?.results || []).map((row) => ({
          code: row.country,
          devices: row.devices,
        })),
        daily: (daily?.results || []).map((row) => ({ date: row.date, uv: row.uv })),
      },
    },
    { 'Cache-Control': 'public, max-age=120' },
  );
}

async function handleApi(request, env, url) {
  if (url.pathname === '/api/release') return handleRelease(env, url);
  if (url.pathname === '/api/download') return handleDownload(request, env, url);
  if (url.pathname === '/api/ping') return handlePing(request, env);
  if (url.pathname === '/api/stats') return handleStats(env);
  return fail(404, 'not_found', '没有这个接口');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        console.error('[api]', error);
        return fail(500, 'internal_error', '服务器开小差了，稍后再试');
      }
    }

    // Reached only if asset routing ever lets a non-API path through.
    return env.ASSETS.fetch(request);
  },
};
