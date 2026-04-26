const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Load IG_SESSIONID from .env if present
let IG_SESSIONID = '';
let IG_DS_USER_ID = '';
// Facebook session
let FB_COOKIES = ''; // c_user + xs cookies
let FB_ACCESS_TOKEN = ''; // Graph API access token
let FB_USER_ID = '';
let fbLoggedUsername = '';
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const m = envText.match(/^\s*IG_SESSIONID\s*=\s*(.+?)\s*$/m);
  if (m) IG_SESSIONID = m[1].replace(/^['"]|['"]$/g, '');
  const fbm = envText.match(/^\s*FB_COOKIES\s*=\s*(.+?)\s*$/m);
  if (fbm) FB_COOKIES = fbm[1].replace(/^['"]|['"]$/g, '');
  const fbu = envText.match(/^\s*FB_USERNAME\s*=\s*(.+?)\s*$/m);
  if (fbu) fbLoggedUsername = fbu[1].replace(/^['"]|['"]$/g, '');
  const fbt = envText.match(/^\s*FB_ACCESS_TOKEN\s*=\s*(.+?)\s*$/m);
  if (fbt) FB_ACCESS_TOKEN = fbt[1].replace(/^['"]|['"]$/g, '');
} catch (_) { /* no .env file */ }
if (IG_SESSIONID) {
  IG_DS_USER_ID = IG_SESSIONID.split('%3A')[0];
}
if (FB_COOKIES) {
  const cUserMatch = FB_COOKIES.match(/c_user=(\d+)/);
  if (cUserMatch) FB_USER_ID = cUserMatch[1];
}
console.log(IG_SESSIONID
  ? `[auth] IG sessionid loaded (user ${IG_DS_USER_ID}) — HD profile pics enabled`
  : '[auth] no IG sessionid configured — falling back to thumbnail scraping');
console.log(FB_COOKIES
  ? `[auth] FB session loaded (user ${FB_USER_ID}, @${fbLoggedUsername})`
  : '[auth] no FB session configured');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Accept-Encoding': 'identity', ...headers },
      rejectUnauthorized: false,
    };
    https.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers, cookies: res.headers['set-cookie'] || [] }));
    }).on('error', reject);
  });
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&#064;/g, '@')
    .replace(/&#x2022;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function formatCount(n) {
  if (n == null) return null;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-US');
}

// Authenticated user-info fetch via i.instagram.com — returns HD profile pic + exact stats
// Requires the user_id (we get it from the scraped page).
async function fetchUserInfoAuthed(userId) {
  if (!IG_SESSIONID) return null;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/users/${userId}/info/`, {
      // Modern Instagram Android client UA — old 76.0 UA pattern-matches as a scraper
      'User-Agent': 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 542701491)',
      'x-ig-app-id': '567067343352427',
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID}`,
      'Accept-Language': 'en-US',
    });
    if (r.status === 401 || r.status === 403) {
      console.warn(`[auth] sessionid rejected (status ${r.status}) — refresh your cookie`);
      return null;
    }
    if (r.status === 404) return null;
    if (r.status !== 200) {
      console.warn(`[auth] users/info status ${r.status}: ${r.body.slice(0, 200)}`);
      return null;
    }
    const j = JSON.parse(r.body);
    if (j.message === 'checkpoint_required') {
      console.warn('[auth] CHECKPOINT REQUIRED — log into instagram.com in your browser, complete the security check, then re-extract a fresh sessionid cookie into .env');
      return null;
    }
    const u = j.user;
    if (!u) return null;

    // IG returns several profile-pic candidates; the *_versions array isn't
    // guaranteed sorted, and hd_profile_pic_url_info isn't always the largest.
    // Walk every option and pick the one with the highest pixel area.
    let bestUrl = null;
    let bestArea = 0;
    const consider = (url, w, h) => {
      if (!url) return;
      const area = (Number(w) || 0) * (Number(h) || 0);
      if (area > bestArea) { bestUrl = url; bestArea = area; }
    };
    if (u.hd_profile_pic_url_info) {
      consider(u.hd_profile_pic_url_info.url, u.hd_profile_pic_url_info.width, u.hd_profile_pic_url_info.height);
    }
    if (Array.isArray(u.hd_profile_pic_versions)) {
      for (const v of u.hd_profile_pic_versions) consider(v.url, v.width, v.height);
    }
    // Last resort: profile_pic_url has no dimensions, so it loses to anything sized
    if (!bestUrl) bestUrl = u.profile_pic_url || null;

    return {
      full_name: u.full_name || '',
      profile_pic_url: bestUrl,
      pic_width: bestArea ? Math.round(Math.sqrt(bestArea)) : 0,
      followers: formatCount(u.follower_count),
      following: formatCount(u.following_count),
      posts: formatCount(u.media_count),
    };
  } catch (e) {
    console.warn(`[auth] users/info error: ${e.message}`);
    return null;
  }
}

function parseOgDescription(desc) {
  // "673M Followers, 643 Following, 4,036 Posts - See Instagram photos..."
  const result = {};
  const followerMatch = desc.match(/([\d,.]+[MK]?)\s+Followers/i);
  const followingMatch = desc.match(/([\d,.]+[MK]?)\s+Following/i);
  const postsMatch = desc.match(/([\d,.]+[MK]?)\s+Posts/i);
  if (followerMatch) result.followers = followerMatch[1];
  if (followingMatch) result.following = followingMatch[1];
  if (postsMatch) result.posts = postsMatch[1];
  return result;
}

app.get('/api/image-proxy', (req, res) => {
  const target = req.query.url;
  const name = req.query.name;
  if (!target || !/^https:\/\/[^/]*(fbcdn\.net|cdninstagram\.com|tiktokcdn\.com|tiktokcdn-us\.com|ibyteimg\.com|tikwm\.com|vsco\.co)\//.test(target)) {
    return res.status(400).send('bad url');
  }

  const isVsco = /vsco\.co/.test(target);
  let headersSent = false;

  // Magic-byte check — proxies that return error pages with text/plain or
  // application/octet-stream content-types would otherwise pipe garbage
  // through. We check the actual file signature instead of trusting headers.
  function detectImageType(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    // HEIC/HEIF: ftyp box at offset 4
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'image/heic';
    return null;
  }

  async function sendImage(result) {
    headersSent = true;
    let buffer = result.buffer;
    let contentType = detectImageType(buffer)
                   || (result.headers['content-type'] || '').match(/^image\/[\w+.-]+/)?.[0]
                   || 'image/jpeg';

    // TikTok serves avatars as signed-URL WebP only — the signature is bound
    // to the path, so we can't ask the CDN for JPEG. Transcode here when the
    // client wants a download (name=) so the saved file is a true .jpg, not
    // a renamed .webp some apps refuse to open. Skips animated webp (would
    // lose frames) and skips when no name is set (inline <img> renders fine).
    if (name && contentType === 'image/webp') {
      const isAnimated = buffer.length > 30 && buffer.slice(12, 16).toString() === 'VP8X' && (buffer[20] & 0x02);
      if (!isAnimated) {
        try {
          const jpeg = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
          console.log(`[image-proxy] transcoded webp → jpeg (${buffer.length}b → ${jpeg.length}b)`);
          buffer = jpeg;
          contentType = 'image/jpeg';
        } catch (e) {
          console.warn(`[image-proxy] webp→jpeg transcode failed: ${e.message}, sending original`);
        }
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (name) {
      const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      const ext = contentType.includes('webp') ? 'webp'
                : contentType.includes('png')  ? 'png'
                : contentType.includes('gif')  ? 'gif'
                : contentType.includes('heic') ? 'heic'
                : 'jpg';
      res.setHeader('Content-Disposition', `inline; filename="${safe}.${ext}"`);
    }
    res.end(buffer);
  }

  // Single fetch with redirect-following. Buffers the response and validates
  // it's actually an image via magic bytes — rejects HTML error pages and
  // proxies that return garbage with image content-types.
  function tryFetch(url, callback, hops = 0) {
    if (hops > 3) return callback(null);
    let u;
    try { u = new URL(url); } catch (_) { return callback(null); }
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (u.host.endsWith('vsco.co')) headers['Referer'] = 'https://vsco.co/';
    // Jina Reader: ask for a screenshot so it returns the rendered image as PNG
    if (u.host === 'r.jina.ai') {
      headers['X-Return-Format'] = 'screenshot';
      headers['Accept'] = 'image/png,image/*,*/*;q=0.8';
    }

    const req2 = https.get({
      host: u.host,
      path: u.pathname + u.search,
      headers,
      rejectUnauthorized: false,
    }, (upstream) => {
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.resume();
        let next;
        try { next = new URL(upstream.headers.location, url).href; }
        catch (_) { return callback(null); }
        return tryFetch(next, callback, hops + 1);
      }
      const ct = upstream.headers['content-type'] || '';
      console.log(`[image-proxy]   ↳ ${u.host} status=${upstream.statusCode} ct=${ct}`);
      if (upstream.statusCode !== 200) {
        upstream.resume();
        return callback(null);
      }
      // Buffer the response and validate magic bytes
      const chunks = [];
      let totalLen = 0;
      upstream.on('data', (c) => {
        chunks.push(c);
        totalLen += c.length;
        if (totalLen > 25 * 1024 * 1024) { // 25MB safety cap
          upstream.destroy();
        }
      });
      upstream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const detected = detectImageType(buffer);
        console.log(`[image-proxy]   ↳ ${u.host} body=${buffer.length}b magic=${detected || 'INVALID'}`);
        if (detected) {
          callback({ buffer, headers: upstream.headers });
        } else {
          // Log first 100 chars of garbage so we can see what we got
          const preview = buffer.slice(0, 100).toString('utf8').replace(/[\x00-\x1f]/g, '?');
          console.log(`[image-proxy]   ↳ ${u.host} preview: "${preview}"`);
          callback(null);
        }
      });
      upstream.on('error', () => callback(null));
    });
    req2.on('error', (e) => { console.warn(`[image-proxy]   ↳ ${u.host} error: ${e.message}`); callback(null); });
    req2.setTimeout(15000, () => { req2.destroy(); console.warn(`[image-proxy]   ↳ ${u.host} timeout`); callback(null); });
  }

  // For VSCO: try a chain of proxies until one returns 200. Each one fetches
  // the source on its own infrastructure, so VSCO's per-IP blocking doesn't
  // affect the next attempt.
  function trySequential(builders, idx, callback) {
    if (idx >= builders.length) return callback(null);
    const url = builders[idx](target);
    let host = '';
    try { host = new URL(url).host; } catch (_) {}
    console.log(`[image-proxy] [${idx + 1}/${builders.length}] ${host}`);
    tryFetch(url, (upstream) => {
      if (upstream) {
        console.log(`[image-proxy] success via ${host} (${upstream.buffer.length}b)`);
        callback(upstream);
      } else {
        trySequential(builders, idx + 1, callback);
      }
    });
  }

  // Stream-through path: validate only the first 12 bytes, then pipe the rest
  // directly to the client. Used for trusted CDN hosts where we don't need to
  // fall back across multiple proxies.
  function streamFetch(url, hops = 0) {
    if (hops > 3) { if (!res.headersSent) res.status(502).end(); return; }
    let u;
    try { u = new URL(url); } catch (_) { if (!res.headersSent) res.status(400).end(); return; }

    const req2 = https.get({
      host: u.host, path: u.pathname + u.search, rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8',
      },
    }, (upstream) => {
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.resume();
        let next; try { next = new URL(upstream.headers.location, url).href; }
        catch (_) { if (!res.headersSent) res.status(502).end(); return; }
        return streamFetch(next, hops + 1);
      }
      if (upstream.statusCode !== 200) {
        upstream.resume();
        if (!res.headersSent) res.status(upstream.statusCode).end();
        return;
      }

      let head = Buffer.alloc(0);
      let piping = false;

      const writeHeaders = (contentType) => {
        res.setHeader('Content-Type', contentType);
        if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        if (name) {
          const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
          const ext = contentType.includes('webp') ? 'webp'
                    : contentType.includes('png')  ? 'png'
                    : contentType.includes('gif')  ? 'gif'
                    : contentType.includes('mp4')  ? 'mp4'
                    : 'jpg';
          res.setHeader('Content-Disposition', `inline; filename="${safe}.${ext}"`);
        }
      };

      const resolveType = () => {
        const magic = detectImageType(head);
        if (magic) return magic;
        const ct = upstream.headers['content-type'] || '';
        const m = ct.match(/^(image|video)\/[\w+.-]+/);
        if (m) return m[0];
        return null;
      };

      // Buffer the rest of the response, transcode webp → jpeg with Jimp,
      // then send. Used when the client wants a download (name=) of a webp
      // — most commonly TikTok avatars whose signed CDN URLs only serve webp.
      // Animated webp (VP8X with ANIM flag) skips transcode to preserve frames.
      const bufferAndTranscode = () => {
        const chunks = [head];
        let total = head.length;
        upstream.on('data', (c) => {
          chunks.push(c);
          total += c.length;
          if (total > 25 * 1024 * 1024) upstream.destroy();
        });
        upstream.on('end', async () => {
          const buffer = Buffer.concat(chunks);
          const isAnimated = buffer.length > 30 && buffer.slice(12, 16).toString() === 'VP8X' && (buffer[20] & 0x02);
          if (isAnimated) {
            writeHeaders('image/webp');
            res.end(buffer);
            return;
          }
          try {
            const jpeg = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
            console.log(`[image-proxy] transcoded webp → jpeg (${buffer.length}b → ${jpeg.length}b)`);
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Length', jpeg.length);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
            res.setHeader('Content-Disposition', `inline; filename="${safe}.jpg"`);
            res.end(jpeg);
          } catch (e) {
            console.warn(`[image-proxy] webp→jpeg transcode failed: ${e.message}, sending original`);
            writeHeaders('image/webp');
            res.end(buffer);
          }
        });
        upstream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      };

      const startStream = () => {
        const type = resolveType();
        if (!type) {
          upstream.destroy();
          if (!res.headersSent) res.status(502).end();
          console.warn(`[image-proxy] invalid magic bytes from ${u.host}`);
          return false;
        }
        if (name && type === 'image/webp') {
          bufferAndTranscode();
          return false;
        }
        writeHeaders(type);
        return true;
      };

      const onData = (c) => {
        if (piping) return;
        head = Buffer.concat([head, c]);
        if (head.length >= 12) {
          upstream.removeListener('data', onData);
          upstream.removeListener('end', onEnd);
          if (!startStream()) return;
          piping = true;
          res.write(head);
          upstream.pipe(res);
        }
      };
      const onEnd = () => {
        if (piping) return;
        if (!startStream()) return;
        res.end(head);
      };
      upstream.on('data', onData);
      upstream.on('end', onEnd);
      upstream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
    });
    req2.on('error', () => { if (!res.headersSent) res.status(502).end(); });
    req2.setTimeout(15000, () => { req2.destroy(); if (!res.headersSent) res.status(504).end(); });
  }

  if (isVsco) {
    // Try every proxy with the original URL, then try them all with .jpg
    // appended (some CDN proxies bail on extensionless URLs).
    const builders = [
      // Jina Reader screenshot mode — runs headless Chrome which can pass
      // Cloudflare's browser challenge. Returns the rendered URL as a PNG.
      (u) => `https://r.jina.ai/${u}`,
      // Then the public proxies (mostly blocked by VSCO's Cloudflare, but
      // worth trying in case any one of them gets through)
      (u) => u,                                                                       // direct + Referer
      (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}`,
      (u) => `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
      (u) => `https://proxy.cors.sh/${u}`,
    ];
    const hasExt = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(target);
    const targets = hasExt ? [target] : [target, target + '.jpg'];
    const proxies = [];
    for (const t of targets) for (const b of builders) proxies.push(() => b(t));

    trySequential(proxies, 0, (upstream) => {
      if (upstream) sendImage(upstream);
      else if (!headersSent) {
        console.warn(`[image-proxy] ALL proxies exhausted for ${target}`);
        res.status(502).end();
      }
    });
  } else {
    streamFetch(target);
  }
});

app.get('/api/profile/:username', async (req, res) => {
  const { username } = req.params;

  try {
    // Step 1: Scrape the profile page to get user_id + fallback og data
    const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);

    if (pageRes.status !== 200) {
      return res.status(pageRes.status).json({ error: `Instagram returned ${pageRes.status}` });
    }

    const html = pageRes.body;

    // Check if it's a valid profile (not a 404 page)
    if (html.includes('<title>Page Not Found')) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Extract og:image (profile pic)
    const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
    const ogDescMatch = html.match(/og:description"[^>]*content="([^"]+)"/);
    const userIdMatch = html.match(/"user_id":"(\d+)"/);

    if (!ogImageMatch) {
      return res.status(404).json({ error: 'Could not find profile data' });
    }

    let profilePicUrl = decodeHtmlEntities(ogImageMatch[1]);

    // Parse name from og:title: "Cristiano Ronaldo (@cristiano) • Instagram photos and videos"
    let fullName = '';
    if (ogTitleMatch) {
      const title = decodeHtmlEntities(ogTitleMatch[1]);
      const nameMatch = title.match(/^(.+?)\s*\(@/);
      fullName = nameMatch ? nameMatch[1].trim() : title.split('•')[0].trim();
    }

    // Parse stats from og:description
    let stats = {};
    if (ogDescMatch) {
      stats = parseOgDescription(decodeHtmlEntities(ogDescMatch[1]));
    }

    // Step 2: If we have a sessionid + user_id, fetch HD pic + exact stats via authed API
    if (userIdMatch && IG_SESSIONID) {
      const authed = await fetchUserInfoAuthed(userIdMatch[1]);
      if (authed) {
        return res.json({ username, ...authed });
      }
      // If authed call failed, fall through to og data below
    }

    res.json({
      username,
      full_name: fullName,
      profile_pic_url: profilePicUrl,
      followers: stats.followers || null,
      following: stats.following || null,
      posts: stats.posts || null,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ---------- Album ZIP bundler ----------
// Chrome blocks N sequential programmatic downloads (only the first fires).
// Fetch every slide server-side, bundle into one store-mode zip, stream it.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function fetchBinary(url, hops = 0) {
  return new Promise((resolve) => {
    if (hops > 4) return resolve(null);
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    if (!/(fbcdn\.net|cdninstagram\.com)$/.test(u.host) && !/(fbcdn\.net|cdninstagram\.com)/.test(u.host)) {
      // Only allow Instagram/FB CDN hosts for this endpoint
      return resolve(null);
    }
    const req2 = https.get({
      host: u.host, path: u.pathname + u.search, rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'image/*,video/*,*/*;q=0.8',
      },
    }, (upstream) => {
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.resume();
        let next; try { next = new URL(upstream.headers.location, url).href; } catch { return resolve(null); }
        return resolve(fetchBinary(next, hops + 1));
      }
      if (upstream.statusCode !== 200) { upstream.resume(); return resolve(null); }
      const chunks = []; let total = 0;
      upstream.on('data', (c) => { chunks.push(c); total += c.length; if (total > 200 * 1024 * 1024) upstream.destroy(); });
      upstream.on('end', () => resolve(Buffer.concat(chunks)));
      upstream.on('error', () => resolve(null));
    });
    req2.on('error', () => resolve(null));
    req2.setTimeout(30000, () => { req2.destroy(); resolve(null); });
  });
}

function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);        // store
    local.writeUInt16LE(0, 10);       // time
    local.writeUInt16LE(0, 12);       // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, eocd]);
}

app.post('/api/album-zip', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const zipName = (req.body?.name || 'album').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'album';
    if (!items.length || items.length > 30) return res.status(400).json({ error: 'invalid items' });

    const results = await Promise.all(items.map(async (it, i) => {
      if (!it.url || typeof it.url !== 'string') return null;
      const buf = await fetchBinary(it.url);
      if (!buf) return null;
      const ext = it.ext || (buf[0] === 0xFF && buf[1] === 0xD8 ? 'jpg' : 'mp4');
      const safeName = String(it.name || `${i + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      return { name: `${safeName}.${ext}`, data: buf };
    }));
    const entries = results.filter(Boolean);
    if (!entries.length) return res.status(502).json({ error: 'no items fetched' });

    const zip = buildZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', zip.length);
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`);
    res.end(zip);
  } catch (err) {
    console.warn('[album-zip]', err.message);
    res.status(500).json({ error: 'zip failed' });
  }
});

// ---------- Instagram user-search (autocomplete) ----------
// Tries several endpoints. The public topsearch frequently 403s without
// a fresh session; fall back to the mobile-API search, then to a direct
// username lookup so the user at least gets an exact match.
const mapSearchUser = (u) => ({
  username: u.username,
  full_name: u.full_name || '',
  profile_pic_url: u.profile_pic_url || '',
  is_verified: !!(u.is_verified || u.is_verified_badge),
  is_private: !!u.is_private,
});

async function igSearchTopsearch(q) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'x-ig-app-id': '936619743392459',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.instagram.com/',
  };
  if (IG_SESSIONID) headers['Cookie'] = `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID || ''}`;
  const r = await httpsGet(
    `https://www.instagram.com/web/search/topsearch/?context=user&count=8&query=${encodeURIComponent(q)}`,
    headers
  );
  if (r.status !== 200) throw new Error('topsearch status ' + r.status);
  const j = JSON.parse(r.body);
  return (j.users || []).map(({ user }) => mapSearchUser(user));
}

async function igSearchMobile(q) {
  if (!IG_SESSIONID) throw new Error('no session');
  const r = await httpsGet(
    `https://i.instagram.com/api/v1/users/search/?q=${encodeURIComponent(q)}&count=8`,
    {
      'User-Agent': 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 542701491)',
      'x-ig-app-id': '567067343352427',
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID || ''}`,
      'Accept-Language': 'en-US',
    }
  );
  if (r.status !== 200) throw new Error('mobile search status ' + r.status);
  const j = JSON.parse(r.body);
  return (j.users || []).map(mapSearchUser);
}

async function igSearchDirect(q) {
  // Last resort: treat the query as a username and try fetching the profile.
  // If it exists, return it as a single suggestion.
  const handle = q.replace(/^@/, '');
  if (!/^[a-z0-9._]+$/i.test(handle)) return [];
  const r = await httpsGet(`https://www.instagram.com/${encodeURIComponent(handle)}/`);
  if (r.status !== 200) return [];
  if (r.body.includes('<title>Page Not Found')) return [];
  const ogImg = r.body.match(/og:image"[^>]*content="([^"]+)"/);
  const ogTitle = r.body.match(/og:title"[^>]*content="([^"]+)"/);
  if (!ogImg) return [];
  let fullName = '';
  if (ogTitle) {
    const t = decodeHtmlEntities(ogTitle[1]);
    const m = t.match(/^(.+?)\s*\(@/);
    fullName = m ? m[1].trim() : t.split('•')[0].trim();
  }
  return [{
    username: handle,
    full_name: fullName,
    profile_pic_url: decodeHtmlEntities(ogImg[1]),
    is_verified: false,
    is_private: false,
  }];
}

app.get('/api/ig-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [] });

  for (const [name, fn] of [['topsearch', igSearchTopsearch], ['mobile', igSearchMobile], ['direct', igSearchDirect]]) {
    try {
      const users = await fn(q);
      if (users && users.length) {
        return res.json({ users: users.slice(0, 8), via: name });
      }
    } catch (err) {
      console.warn(`[ig-search:${name}] ${err.message}`);
    }
  }
  res.json({ users: [] });
});

// ---------- Instagram Posts / Reels ----------
app.get('/api/ig-posts/:username', async (req, res) => {
  const { username } = req.params;
  const maxId = req.query.max_id || null;

  try {
    // Scrape profile page to get user_id
    const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    if (pageRes.status !== 200) {
      return res.status(pageRes.status).json({ error: `Instagram returned ${pageRes.status}` });
    }
    const html = pageRes.body;
    const userIdMatch = html.match(/"user_id":"(\d+)"/);

    if (!userIdMatch) {
      return res.status(404).json({ error: 'Could not find user ID' });
    }
    const userId = userIdMatch[1];

    // Detect private account from page HTML
    const isPrivate = /"is_private"\s*:\s*true/.test(html);

    // Try authenticated API first for posts
    if (IG_SESSIONID) {
      const result = await fetchIgPostsAuthed(userId, maxId);
      if (result) {
        if (result.expired) {
          invalidateIgSession('ig-posts auth-fail');
          return res.status(401).json({ error: 'Session expired.', loggedOut: true });
        }
        if (result.challenge) {
          return res.status(401).json({
            error: 'Instagram requires verification for this login.',
            challengeRequired: true,
            challengeUrl: result.challengeUrl || null,
          });
        }
        if (result.private) {
          return res.json({ posts: [], private: true, next_max_id: null });
        }
        return res.json({ posts: result.posts, next_max_id: result.nextMaxId || null });
      }
    }

    // If we detected private from HTML and have no authed data, report it
    if (isPrivate) {
      return res.json({ posts: [], private: true, next_max_id: null });
    }

    // Fallback: parse __a=1 or embedded JSON from profile page
    const posts = parseIgPostsFromHtml(html);
    res.json({ posts, next_max_id: null });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

async function fetchIgPostsAuthed(userId, maxId) {
  if (!IG_SESSIONID) return null;
  try {
    let feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=30`;
    if (maxId) feedUrl += `&max_id=${maxId}`;
    const r = await httpsGet(feedUrl, {
      'User-Agent': 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 542701491)',
      'x-ig-app-id': '567067343352427',
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID}`,
      'Accept-Language': 'en-US',
    });
    if (r.status !== 200) {
      console.warn(`[ig-posts] feed status ${r.status}`);
      if (r.status === 401 || r.status === 403) return { expired: true };
      const ch = parseIgChallenge(r.body);
      if (ch.required) return { challenge: true, challengeUrl: ch.url };
      return null;
    }
    const j = JSON.parse(r.body);

    // Private account: API returns status 'ok' but no items or num_results=0
    if (j.user && j.user.is_private && (!j.items || j.items.length === 0)) {
      return { private: true, posts: [] };
    }
    if (!j.items || !Array.isArray(j.items)) return null;

    const posts = j.items.map(item => {
      const isVideo = item.media_type === 2 || item.video_versions;
      const isCarousel = item.media_type === 8 || item.carousel_media;
      const isReel = !!(item.clips_metadata || (item.product_type === 'clips'));

      // Get thumbnail
      let thumbnail = null;
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length) {
        thumbnail = item.image_versions2.candidates[0].url;
      } else if (item.carousel_media && item.carousel_media[0] && item.carousel_media[0].image_versions2) {
        thumbnail = item.carousel_media[0].image_versions2.candidates[0].url;
      }

      // Get video URL for reels/videos
      let videoUrl = null;
      if (isVideo && item.video_versions && item.video_versions.length) {
        videoUrl = item.video_versions[0].url;
      }

      // Extract carousel media items
      let carouselItems = null;
      if (isCarousel && item.carousel_media) {
        carouselItems = item.carousel_media.map(cm => {
          const cmIsVideo = cm.media_type === 2 || cm.video_versions;
          let cmThumb = null;
          if (cm.image_versions2 && cm.image_versions2.candidates && cm.image_versions2.candidates.length) {
            cmThumb = cm.image_versions2.candidates[0].url;
          }
          let cmVideo = null;
          if (cmIsVideo && cm.video_versions && cm.video_versions.length) {
            cmVideo = cm.video_versions[0].url;
          }
          return { type: cmIsVideo ? 'video' : 'image', url: cmThumb, videoUrl: cmVideo };
        });
      }

      return {
        id: item.pk || item.id,
        code: item.code,
        type: isReel ? 'reel' : isCarousel ? 'carousel' : isVideo ? 'video' : 'image',
        thumbnail,
        videoUrl,
        carouselItems,
        likeCount: item.like_count || 0,
        commentCount: item.comment_count || 0,
        caption: item.caption ? item.caption.text : '',
        timestamp: item.taken_at,
      };
    });
    return { private: false, posts, nextMaxId: j.next_max_id || null };
  } catch (e) {
    console.warn(`[ig-posts] error: ${e.message}`);
    return null;
  }
}

function parseIgPostsFromHtml(html) {
  // Try to extract from embedded shared data
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});\s*<\/script>/);
  if (sharedDataMatch) {
    try {
      const data = JSON.parse(sharedDataMatch[1]);
      const edges = data?.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges;
      if (edges) {
        return edges.map(e => {
          const node = e.node;
          return {
            id: node.id,
            code: node.shortcode,
            type: node.is_video ? 'video' : 'image',
            thumbnail: node.thumbnail_src || node.display_url,
            videoUrl: node.video_url || null,
            likeCount: node.edge_liked_by?.count || 0,
            commentCount: node.edge_media_to_comment?.count || 0,
            caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
            timestamp: node.taken_at_timestamp,
          };
        });
      }
    } catch (_) {}
  }
  return [];
}

// ---------- Instagram Stories ----------
async function resolveUserId(username) {
  const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
  if (pageRes.status !== 200) return null;
  const m = pageRes.body.match(/"user_id":"(\d+)"/);
  return m ? m[1] : null;
}

app.get('/api/ig-stories/:username', async (req, res) => {
  if (!IG_SESSIONID) return res.status(401).json({ error: 'Login required to view stories.' });
  const { username } = req.params;

  try {
    const userId = await resolveUserId(username);
    if (!userId) return res.status(404).json({ error: 'User not found.' });

    const r = await httpsGet(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, {
      'User-Agent': IG_ANDROID_UA,
      'x-ig-app-id': IG_APP_ID,
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID}`,
    });

    if (r.status === 401 || r.status === 403) {
      invalidateIgSession(`ig-stories ${r.status}`);
      return res.status(401).json({ error: 'Session expired.', loggedOut: true });
    }
    if (r.status !== 200) {
      const ch = parseIgChallenge(r.body);
      if (ch.required) {
        return res.status(401).json({
          error: 'Instagram requires verification for this login.',
          challengeRequired: true,
          challengeUrl: ch.url,
        });
      }
      return res.status(r.status).json({ error: 'Failed to fetch stories.' });
    }

    const j = JSON.parse(r.body);
    const reel = j.reel;
    if (!reel || !reel.items || reel.items.length === 0) {
      return res.json({ stories: [] });
    }

    const stories = reel.items.map(item => {
      const isVideo = item.media_type === 2 || item.video_versions;
      let thumbnail = null;
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length) {
        thumbnail = item.image_versions2.candidates[0].url;
      }
      let videoUrl = null;
      if (isVideo && item.video_versions && item.video_versions.length) {
        videoUrl = item.video_versions[0].url;
      }
      return {
        id: item.pk || item.id,
        type: isVideo ? 'video' : 'image',
        thumbnail,
        videoUrl,
        timestamp: item.taken_at,
        expiringAt: item.expiring_at,
      };
    });

    res.json({ stories });
  } catch (err) {
    console.error('[ig-stories]', err.message);
    res.status(500).json({ error: 'Failed to fetch stories.' });
  }
});

// ---------- Instagram Highlights ----------
app.get('/api/ig-highlights/:username', async (req, res) => {
  if (!IG_SESSIONID) return res.status(401).json({ error: 'Login required to view highlights.' });
  const { username } = req.params;

  try {
    const userId = await resolveUserId(username);
    if (!userId) return res.status(404).json({ error: 'User not found.' });

    const r = await httpsGet(`https://i.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, {
      'User-Agent': IG_ANDROID_UA,
      'x-ig-app-id': IG_APP_ID,
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID}`,
    });

    if (r.status === 401 || r.status === 403) {
      invalidateIgSession(`ig-highlights ${r.status}`);
      return res.status(401).json({ error: 'Session expired.', loggedOut: true });
    }
    if (r.status !== 200) {
      const ch = parseIgChallenge(r.body);
      if (ch.required) {
        return res.status(401).json({
          error: 'Instagram requires verification for this login.',
          challengeRequired: true,
          challengeUrl: ch.url,
        });
      }
      return res.status(r.status).json({ error: 'Failed to fetch highlights.' });
    }

    const j = JSON.parse(r.body);
    if (!j.tray || j.tray.length === 0) {
      return res.json({ highlights: [] });
    }

    const highlights = j.tray.map(h => {
      let coverUrl = null;
      if (h.cover_media && h.cover_media.cropped_image_version) {
        coverUrl = h.cover_media.cropped_image_version.url;
      } else if (h.cover_media && h.cover_media.media && h.cover_media.media.image_versions2) {
        coverUrl = h.cover_media.media.image_versions2.candidates[0].url;
      }
      return {
        id: h.id,
        title: h.title || '',
        coverUrl,
        itemCount: h.media_count || 0,
      };
    });

    res.json({ highlights });
  } catch (err) {
    console.error('[ig-highlights]', err.message);
    res.status(500).json({ error: 'Failed to fetch highlights.' });
  }
});

app.get('/api/ig-highlight/:highlightId', async (req, res) => {
  if (!IG_SESSIONID) return res.status(401).json({ error: 'Login required.' });
  const { highlightId } = req.params;

  try {
    const reelId = highlightId.startsWith('highlight:') ? highlightId : `highlight:${highlightId}`;
    const r = await httpsGet(`https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`, {
      'User-Agent': IG_ANDROID_UA,
      'x-ig-app-id': IG_APP_ID,
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID}`,
    });

    if (r.status === 401 || r.status === 403) {
      invalidateIgSession(`ig-highlight ${r.status}`);
      return res.status(401).json({ error: 'Session expired.', loggedOut: true });
    }
    if (r.status !== 200) {
      const ch = parseIgChallenge(r.body);
      if (ch.required) {
        return res.status(401).json({
          error: 'Instagram requires verification for this login.',
          challengeRequired: true,
          challengeUrl: ch.url,
        });
      }
      return res.status(r.status).json({ error: 'Failed to fetch highlight items.' });
    }

    const j = JSON.parse(r.body);
    const reels = j.reels || j.reels_media;
    const reel = reels ? reels[reelId] || Object.values(reels)[0] : null;

    if (!reel || !reel.items || reel.items.length === 0) {
      return res.json({ items: [] });
    }

    const items = reel.items.map(item => {
      const isVideo = item.media_type === 2 || item.video_versions;
      let thumbnail = null;
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length) {
        thumbnail = item.image_versions2.candidates[0].url;
      }
      let videoUrl = null;
      if (isVideo && item.video_versions && item.video_versions.length) {
        videoUrl = item.video_versions[0].url;
      }
      return {
        id: item.pk || item.id,
        type: isVideo ? 'video' : 'image',
        thumbnail,
        videoUrl,
        timestamp: item.taken_at,
      };
    });

    res.json({ items, title: reel.title || '' });
  } catch (err) {
    console.error('[ig-highlight]', err.message);
    res.status(500).json({ error: 'Failed to fetch highlight items.' });
  }
});

// ---------- Facebook ----------
// Parses "Cristiano Ronaldo. 171,559,776 likes · 1,822,617 talking about this. ..."
function parseFbDescription(desc) {
  const result = {};
  const likesMatch = desc.match(/([\d,.]+)\s+(?:likes|followers|people\s+follow)/i);
  const talkingMatch = desc.match(/([\d,.]+)\s+talking about this/i);
  if (likesMatch) result.followers = likesMatch[1];
  if (talkingMatch) result.talking = talkingMatch[1];
  return result;
}

app.get('/api/fb-profile/:username', async (req, res) => {
  const { username } = req.params;

  try {
    // Fetch profile page with cookies for auth
    const fbHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    if (FB_COOKIES) fbHeaders['Cookie'] = FB_COOKIES;
    const r = await httpsGet(`https://www.facebook.com/${encodeURIComponent(username)}`, fbHeaders);

    if (r.status === 404) return res.status(404).json({ error: 'User not found' });
    if (r.status !== 200) return res.status(r.status).json({ error: `Facebook returned ${r.status}` });

    const html = r.body;
    const isSplash = /<title>Facebook<\/title>|logoSplashScreen/.test(html);
    const hasNoContent = /Page Not Found|content isn't available|isn&#039;t available/i.test(html);

    if (hasNoContent) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Try to extract profile data from the authenticated page (JSON-LD or embedded data)
    if (!isSplash && FB_COOKIES) {
      // Facebook embeds profile data in JSON within the page
      const nameFromPage = html.match(/"name"\s*:\s*"([^"]{2,50})".*?"profile_picture"/) ||
                           html.match(/,"name":"([^"]{2,50})","__typename":"User"/);
      const picFromPage = html.match(/"profilePicLarge"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/) ||
                          html.match(/"profile_picture"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/) ||
                          html.match(/"profilePic(?:ture)?.*?"uri"\s*:\s*"([^"]+)"/);
      if (nameFromPage && picFromPage) {
        const picUrl = picFromPage[1].replace(/\\\//g, '/');
        return res.json({
          username,
          full_name: nameFromPage[1],
          profile_pic_url: picUrl,
          followers: null, following: null, posts: null,
        });
      }
    }

    // Extract og tags from the page
    if (isSplash && !FB_COOKIES) {
      return res.status(401).json({ error: 'This profile requires login. Please log in with Facebook first.' });
    }

    // Try mobile page for og tags if desktop page didn't have them
    if (isSplash || !html.match(/og:image/)) {
      const mHeaders = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      };
      if (FB_COOKIES) mHeaders['Cookie'] = FB_COOKIES;
      const mr = await httpsGet(`https://m.facebook.com/${encodeURIComponent(username)}`, mHeaders);
      if (mr.status === 200 && !/<title>Facebook<\/title>/.test(mr.body)) {
        const ogImg = mr.body.match(/og:image"[^>]*content="([^"]+)"/);
        const ogTitle = mr.body.match(/og:title"[^>]*content="([^"]+)"/);
        const ogDesc = mr.body.match(/og:description"[^>]*content="([^"]+)"/);
        if (ogImg && ogTitle) {
          const mStats = ogDesc ? parseFbDescription(decodeHtmlEntities(ogDesc[1])) : {};
          return res.json({
            username,
            full_name: decodeHtmlEntities(ogTitle[1]).trim(),
            profile_pic_url: decodeHtmlEntities(ogImg[1]),
            followers: mStats.followers || null,
            following: mStats.talking || null,
            posts: null,
          });
        }
      }
      if (isSplash) {
        return res.status(401).json({ error: 'This profile requires login. Please log in with Facebook first.' });
      }
    }

    const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
    const ogDescMatch  = html.match(/og:description"[^>]*content="([^"]+)"/);

    if (!ogImageMatch || !ogTitleMatch) return res.status(404).json({ error: 'User not found' });

    const profilePicUrl = decodeHtmlEntities(ogImageMatch[1]);
    const fullName = ogTitleMatch ? decodeHtmlEntities(ogTitleMatch[1]).trim() : '';
    const stats = ogDescMatch ? parseFbDescription(decodeHtmlEntities(ogDescMatch[1])) : {};

    res.json({
      username,
      full_name: fullName,
      profile_pic_url: profilePicUrl,
      followers: stats.followers || null,
      following: stats.talking || null, // FB: "talking about this" goes in the second slot
      posts: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ---------- Threads ----------
// Threads serves a JS-only SPA shell to regular browsers — only the
// facebookexternalhit crawler UA gets the full HTML with og tags. We use the
// default UA from httpsGet (which is already facebookexternalhit) and ALWAYS
// also fall through Instagram to get a reliable HD pic, since:
//   1. Threads accounts share their numeric pk_id with the linked IG account
//   2. The username is identical on both for ~all users
//   3. The IG authed endpoint reliably returns HD profile pics
// So IG is the canonical HD source; Threads is just used for Threads-specific
// stats (Threads count, Threads follower count).
app.get('/api/threads-profile/:username', async (req, res) => {
  const username = req.params.username.replace(/^@/, '');

  try {
    let fullName = '';
    let profilePicUrl = '';
    let followers = null;
    let following = null;
    let threadsCount = null;
    let userId = '';

    // ---- Step 1: Threads (for stats + verification) ----
    const tRes = await httpsGet(`https://www.threads.com/@${encodeURIComponent(username)}`);
    if (tRes.status === 200) {
      const html = tRes.body;
      const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
      const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
      const ogDescMatch  = html.match(/og:description"[^>]*content="([^"]+)"/);

      if (ogImageMatch) {
        profilePicUrl = decodeHtmlEntities(ogImageMatch[1]);
        if (ogTitleMatch) {
          const title = decodeHtmlEntities(ogTitleMatch[1]);
          const nameMatch = title.match(/^(.+?)\s*\(@/);
          if (nameMatch) fullName = nameMatch[1].trim();
        }
        if (ogDescMatch) {
          const desc = decodeHtmlEntities(ogDescMatch[1]);
          const followersMatch = desc.match(/([\d,.]+[KMB]?)\s+Followers/i);
          const followingMatch = desc.match(/([\d,.]+[KMB]?)\s+Following/i);
          const threadsMatch   = desc.match(/([\d,.]+[KMB]?)\s+Threads/i);
          if (followersMatch) followers = followersMatch[1];
          if (followingMatch) following = followingMatch[1];
          if (threadsMatch)   threadsCount = threadsMatch[1];
        }
        const idPatterns = [
          /"user_id":"(\d+)"/, /"pk_id":"(\d+)"/, /"pk":"(\d+)"/, /"id":"(\d+)","is_private"/,
        ];
        for (const re of idPatterns) {
          const m = html.match(re);
          if (m) { userId = m[1]; break; }
        }
      }
    }

    // ---- Step 2: Instagram (for HD pic + reliable user_id) ----
    // Always run this — it's the canonical HD source for Threads users
    const igRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    if (igRes.status === 200 && !igRes.body.includes('<title>Page Not Found')) {
      const html = igRes.body;
      const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
      const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
      const userIdMatch  = html.match(/"user_id":"(\d+)"/);

      if (ogImageMatch) {
        if (!profilePicUrl) profilePicUrl = decodeHtmlEntities(ogImageMatch[1]);
        if (!fullName && ogTitleMatch) {
          const title = decodeHtmlEntities(ogTitleMatch[1]);
          const nameMatch = title.match(/^(.+?)\s*\(@/);
          if (nameMatch) fullName = nameMatch[1].trim();
        }
        if (!userId && userIdMatch) userId = userIdMatch[1];
      }
    }

    if (!profilePicUrl) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ---- Step 3: HD upgrade via IG authed API ----
    if (userId && IG_SESSIONID) {
      const authed = await fetchUserInfoAuthed(userId);
      if (authed) {
        return res.json({
          username,
          full_name: authed.full_name || fullName,
          profile_pic_url: authed.profile_pic_url,
          followers: followers || authed.followers,
          following: following || authed.following,
          posts: threadsCount || null,
        });
      }
    }

    res.json({
      username,
      full_name: fullName,
      profile_pic_url: profilePicUrl,
      followers,
      following,
      posts: threadsCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ---------- VSCO Post ----------
// VSCO is behind Cloudflare and blocks raw Node fetches. We route through
// Jina Reader (free headless-Chrome proxy) which solves the challenge.
// Default Jina output is markdown — for an image-only page, the image is
// emitted as ![alt](url) which we extract directly.
function fetchVscoPostViaJina(postUrl, format) {
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/markdown, text/html, */*',
    };
    if (format) headers['X-Return-Format'] = format;
    const req = https.get({
      host: 'r.jina.ai',
      path: '/' + postUrl,
      headers,
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        console.log(`[vsco-post-jina] format=${format || 'markdown'} → ${res.statusCode} (${body.length}b)`);
        if (res.statusCode === 200 && body.length > 100) resolve(body);
        else resolve(null);
      });
    });
    req.on('error', (e) => { console.warn(`[vsco-post-jina] ${e.message}`); resolve(null); });
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
  });
}

function extractVscoImage(body) {
  // Markdown image: ![alt](https://im.vsco.co/...)
  let m = body.match(/!\[[^\]]*\]\((https?:\/\/im\.vsco\.co\/[^)\s]+)\)/);
  if (m) return m[1];
  // og:image meta tag
  m = body.match(/og:image"[^>]*content="([^"]+)"/);
  if (m) return decodeHtmlEntities(m[1]);
  // <img src="..."> with vsco URL
  m = body.match(/<img[^>]*src="(https?:\/\/im\.vsco\.co\/[^"]+)"/);
  if (m) return m[1];
  // Bare im.vsco.co URL with image extension
  m = body.match(/https?:\/\/im\.vsco\.co\/[^"'\s)<>]+\.(?:jpg|jpeg|png|webp)/i);
  if (m) return m[0];
  // Any im.vsco.co URL at all (last resort)
  m = body.match(/https?:\/\/im\.vsco\.co\/[^"'\s)<>]+/);
  if (m) return m[0];
  return '';
}

app.get('/api/vsco-post', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || !/^https?:\/\/(www\.)?vsco\.co\//i.test(rawUrl)) {
    return res.status(400).json({ error: 'Please paste a valid VSCO post URL' });
  }

  try {
    const urlMatch = rawUrl.match(/vsco\.co\/([^/]+)\/(?:media\/)?([a-f0-9]{20,}|\d{6,})/i);
    const author = urlMatch ? urlMatch[1] : '';
    const postId = urlMatch ? urlMatch[2] : '';

    // Try markdown first (smallest, has the image as ![alt](url))
    let body = await fetchVscoPostViaJina(rawUrl);
    let imageUrl = body ? extractVscoImage(body) : '';

    // Fallback: try HTML format
    if (!imageUrl) {
      body = await fetchVscoPostViaJina(rawUrl, 'html');
      if (body) imageUrl = extractVscoImage(body);
    }

    if (!imageUrl) {
      // Dump for inspection so we can see what Jina actually returned
      if (body) {
        try {
          fs.writeFileSync(path.join(__dirname, `vsco_post_${postId || 'unknown'}_jina.txt`), body);
          console.log(`[vsco-post] dumped to vsco_post_${postId}_jina.txt`);
        } catch (_) {}
        console.log(`[vsco-post] preview:\n${body.slice(0, 800)}`);
      }
      return res.status(404).json({ error: 'Could not find image in VSCO post' });
    }

    // Title / description from whichever body we ended up with
    let title = '';
    let description = '';
    const ogTitleMatch = body.match(/og:title"[^>]*content="([^"]+)"/);
    if (ogTitleMatch) {
      title = decodeHtmlEntities(ogTitleMatch[1]).replace(/\s*[\|·•].*$/, '').trim();
    } else {
      // Markdown often starts with "# Title"
      const h1 = body.match(/^#\s+(.+)$/m);
      if (h1) title = h1[1].trim();
    }
    const ogDescMatch = body.match(/og:description"[^>]*content="([^"]+)"/);
    if (ogDescMatch) description = decodeHtmlEntities(ogDescMatch[1]).trim();

    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
    imageUrl = imageUrl.replace(/\?.*$/, '');

    console.log(`[vsco-post] ${author}/${postId} → ${imageUrl}`);
    res.json({
      id: postId,
      author,
      title: title || author || '',
      description,
      imageUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// ---------- TikTok ----------
// TikTok server-renders full user data into a JSON blob in a script tag.
// avatarLarger is the highest-resolution version (~1080px).
app.get('/api/tt-profile/:username', async (req, res) => {
  const username = req.params.username.replace(/^@/, '');

  // tikwm fallback used both when TikTok serves a WAF challenge and when the
  // page parse comes up empty. Returns { profile } when found, { notFound: true }
  // when tikwm confirms the user doesn't exist, or null on transient failure.
  const tryTikwm = async () => {
    const tw = await fetchTikwmUserInfo(username);
    if (!tw) return null;
    if (tw.notFound) return { notFound: true };
    if (!tw.data || !tw.data.user) return null;
    const u = tw.data.user;
    const stats = tw.data.stats || {};
    return { profile: {
      username: u.uniqueId || username,
      full_name: u.nickname || '',
      profile_pic_url: u.avatarLarger || u.avatarMedium || u.avatarThumb || '',
      followers: formatCount(Number(stats.followerCount) || 0),
      following: formatCount(Number(stats.followingCount) || 0),
      posts: formatCount(Number(stats.videoCount) || 0),
    } };
  };

  try {
    const r = await httpsGet(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (r.status === 404) {
      // Real 404 from TikTok still warrants a tikwm sanity check — sometimes
      // TikTok 404s a profile from one region but tikwm finds it.
      const tw = await tryTikwm();
      if (tw && tw.profile) return res.json(tw.profile);
      return res.status(404).json({ error: 'User not found' });
    }
    if (r.status !== 200) {
      const tw = await tryTikwm();
      if (tw && tw.profile) return res.json(tw.profile);
      if (tw && tw.notFound) return res.status(404).json({ error: 'User not found' });
      return res.status(r.status).json({ error: `TikTok returned ${r.status}` });
    }

    const html = r.body;

    // TikTok's anti-bot WAF returns HTTP 200 with a "Please wait..." stub
    // page that has no rehydration JSON or og tags. Detect and skip straight
    // to tikwm rather than falling through to a misleading "User not found".
    const isWafChallenge = /_wafchallengeid|waforiginalreid|SlardarWAF/.test(html);
    if (isWafChallenge) {
      console.warn(`[tiktok] WAF challenge for @${username}, falling back to tikwm`);
      const tw = await tryTikwm();
      if (tw && tw.profile) return res.json(tw.profile);
      if (tw && tw.notFound) return res.status(404).json({ error: 'User not found' });
      return res.status(503).json({ error: 'TikTok is rate-limiting profile lookups right now. Try again in a minute.' });
    }

    // Primary path: parse the rehydration JSON blob (has HD avatar + exact stats)
    const dataMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const userDetail = data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.user-detail'];
        if (userDetail && userDetail.statusCode !== 0 && userDetail.statusCode != null) {
          const tw = await tryTikwm();
          if (tw && tw.profile) return res.json(tw.profile);
          return res.status(404).json({ error: 'User not found' });
        }
        if (userDetail && userDetail.userInfo) {
          const u = userDetail.userInfo.user || {};
          const stats = userDetail.userInfo.stats || userDetail.userInfo.statsV2 || {};
          const hdUrl = u.avatarLarger || u.avatarMedium || u.avatarThumb;
          if (hdUrl) {
            return res.json({
              username: u.uniqueId || username,
              full_name: u.nickname || '',
              profile_pic_url: hdUrl,
              followers: formatCount(Number(stats.followerCount) || 0),
              following: formatCount(Number(stats.followingCount) || 0),
              posts: formatCount(Number(stats.videoCount) || 0),
            });
          }
        }
      } catch (e) {
        console.warn(`[tiktok] JSON parse error: ${e.message}`);
      }
    }

    // Fallback: og tags (lower-res avatar, no stats)
    const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
    if (!ogImageMatch) {
      const tw = await tryTikwm();
      if (tw && tw.profile) return res.json(tw.profile);
      return res.status(404).json({ error: 'User not found' });
    }

    let fullName = '';
    if (ogTitleMatch) {
      const title = decodeHtmlEntities(ogTitleMatch[1]);
      const nameMatch = title.match(/^(.+?)\s*\(@/);
      fullName = nameMatch ? nameMatch[1].trim() : title.split('|')[0].trim();
    }

    res.json({
      username,
      full_name: fullName,
      profile_pic_url: decodeHtmlEntities(ogImageMatch[1]),
      followers: null,
      following: null,
      posts: null,
    });
  } catch (err) {
    console.error(err);
    const tw = await tryTikwm().catch(() => null);
    if (tw && tw.profile) return res.json(tw.profile);
    if (tw && tw.notFound) return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ---------- TikTok Videos ----------
// HEAD a URL with redirect-following — returns the final URL and size.
function httpHead(url, headers, hops = 0) {
  if (hops > 5) return Promise.resolve({ url, size: 0 });
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      host: u.host,
      path: u.pathname + u.search,
      method: 'HEAD',
      headers,
      rejectUnauthorized: false,
    }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
                   ? res.headers.location
                   : `https://${u.host}${res.headers.location}`;
        httpHead(next, headers, hops + 1).then(resolve);
        return;
      }
      resolve({ url, size: Number(res.headers['content-length']) || 0 });
    });
    req.on('error', () => resolve({ url, size: 0 }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ url, size: 0 }); });
    req.end();
  });
}

// ssstik.io uses a 2-step CSRF token flow to call TikTok's web API with
// proper signing on its end, then exposes the original CDN URL via a
// tikcdn.io redirector. This is what most "tikdownloader" sites use under
// the hood and returns the ORIGINAL 1080p no-watermark file.
function fetchSsstik(videoUrl) {
  return new Promise((resolve) => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Step 1: GET /en to extract the hidden "tt" token
    const pageReq = https.get({
      host: 'ssstik.io',
      path: '/en',
      headers: { 'User-Agent': ua, 'Accept': 'text/html' },
      rejectUnauthorized: false,
    }, (pageRes) => {
      let html = '';
      pageRes.on('data', c => html += c);
      pageRes.on('end', () => {
        const tokenMatch = html.match(/name="tt"\s+value="([^"]+)"/);
        if (!tokenMatch) {
          console.warn('[ssstik] no tt token on homepage');
          return resolve(null);
        }
        const tt = tokenMatch[1];

        // Step 2: POST /abc?url=dl with the URL + token (htmx call)
        const postData = `id=${encodeURIComponent(videoUrl)}&locale=en&tt=${encodeURIComponent(tt)}`;
        const dlReq = https.request({
          host: 'ssstik.io',
          path: '/abc?url=dl',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': ua,
            'Accept': '*/*',
            'Origin': 'https://ssstik.io',
            'Referer': 'https://ssstik.io/en',
            'HX-Request': 'true',
            'HX-Target': 'target',
            'HX-Current-URL': 'https://ssstik.io/en',
          },
          rejectUnauthorized: false,
        }, (dlRes) => {
          let body = '';
          dlRes.on('data', c => body += c);
          dlRes.on('end', () => {
            // ssstik returns HTML fragments — match the HD link first, fall back to SD
            const hdMatch = body.match(/href="([^"]+)"[^>]*class="[^"]*without_watermark_hd[^"]*"/);
            const sdMatch = body.match(/href="([^"]+)"[^>]*class="[^"]*without_watermark(?!_hd)[^"]*"/);
            const url = (hdMatch && hdMatch[1]) || (sdMatch && sdMatch[1]);
            if (!url) {
              console.warn('[ssstik] no download links in response');
              return resolve(null);
            }
            // Best-effort metadata
            const titleMatch  = body.match(/<p[^>]*class="maintext"[^>]*>([\s\S]*?)<\/p>/);
            const coverMatch  = body.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*result_author[^"]*"/);
            const authorMatch = body.match(/<h2>([^<]+)<\/h2>/);
            resolve({
              url,
              isHd: !!hdMatch,
              title:  titleMatch  ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : '',
              cover:  coverMatch  ? coverMatch[1] : '',
              author: authorMatch ? authorMatch[1].trim() : '',
            });
          });
        });
        dlReq.on('error', (e) => { console.warn(`[ssstik] dl: ${e.message}`); resolve(null); });
        dlReq.setTimeout(15000, () => { dlReq.destroy(); resolve(null); });
        dlReq.write(postData);
        dlReq.end();
      });
    });
    pageReq.on('error', (e) => { console.warn(`[ssstik] page: ${e.message}`); resolve(null); });
    pageReq.setTimeout(10000, () => { pageReq.destroy(); resolve(null); });
  });
}

// Mimics the official TikTok Android app (musical_ly aid=1233) to hit the
// mobile feed API directly. Worked historically but TikTok now signs most
// regions — kept as a fallback for when it does work.
function fetchTtMobileApi(videoId) {
  const params = new URLSearchParams({
    aweme_id: videoId,
    iid: '7318518857994389254',
    device_id: '7318517321748022790',
    version_name: '26.1.3',
    version_code: '260103',
    build_number: '26.1.3',
    manifest_version_code: '260103',
    update_version_code: '260103',
    openudid: 'a1b2c3d4e5f67890',
    uuid: '1234567890123456',
    _rticket: String(Date.now()),
    ts: String(Math.floor(Date.now() / 1000)),
    device_brand: 'Google',
    device_type: 'Pixel 7',
    device_platform: 'android',
    resolution: '1080*2400',
    dpi: '420',
    os_version: '13',
    os_api: '33',
    carrier_region: 'US',
    sys_region: 'US',
    region: 'US',
    app_name: 'musical_ly',
    app_language: 'en',
    language: 'en',
    timezone_name: 'America/New_York',
    timezone_offset: '-14400',
    channel: 'googleplay',
    ac: 'wifi',
    mcc_mnc: '310260',
    aid: '1233',
  });
  const path = '/aweme/v1/feed/?' + params.toString();
  const ua = 'com.zhiliaoapp.musically/2022600040 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ2A.230505.002; Cv: 1.0;)';

  const tryHost = (host) => new Promise((resolve) => {
    const req = https.get({
      host, path,
      headers: { 'User-Agent': ua, 'Accept': 'application/json' },
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && Array.isArray(j.aweme_list)) {
            const aweme = j.aweme_list.find(a => String(a.aweme_id) === String(videoId));
            resolve(aweme || null);
          } else {
            resolve(null);
          }
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[tt-mobile] ${host}: ${e.message}`); resolve(null); });
    req.setTimeout(4000, () => { req.destroy(); resolve(null); });
  });

  // Try regional endpoints in sequence — first hit wins
  return tryHost('api22-normal-c-useast2a.tiktokv.com')
    .then(r => r || tryHost('api16-normal-c-useast1a.tiktokv.com'))
    .then(r => r || tryHost('api19-normal-c-useast1a.tiktokv.com'));
}

// Same tikwm host, but for profile lookups. Used when TikTok's web page
// returns a WAF/anti-bot challenge instead of the rehydration JSON.
// Resolves to { data } on success, { notFound: true } when tikwm explicitly
// rejects the username (so caller can return 404), or null on transient
// failure (so caller can decide between 5xx and "try again").
function fetchTikwmUserInfo(username) {
  return new Promise((resolve) => {
    const req = https.request({
      host: 'www.tikwm.com',
      path: `/api/user/info?unique_id=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.code === 0 && j.data) return resolve({ data: j.data });
          const msg = (j && j.msg) || '';
          if (msg) console.warn(`[tikwm-user] ${msg}`);
          if (/invalid|not found|no such/i.test(msg)) return resolve({ notFound: true });
          resolve(null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[tikwm-user] ${e.message}`); resolve(null); });
    req.end();
  });
}

// tikwm.com is a free public TikTok extractor that returns no-watermark URLs
// served from its own CDN. No Referer / signing required, but rate-limited to
// ~1 req/sec — used as a fallback if the mobile API is region-blocked.
function fetchTikwm(videoUrl) {
  return new Promise((resolve) => {
    const postData = `url=${encodeURIComponent(videoUrl)}&hd=1`;
    const req = https.request({
      host: 'www.tikwm.com',
      path: '/api/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.code === 0 && j.data) resolve(j.data);
          else {
            if (j && j.msg) console.warn(`[tikwm] ${j.msg}`);
            resolve(null);
          }
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[tikwm] ${e.message}`); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// Follows vm/vt short URLs through redirects until we land on a canonical
// /@user/video/<id> URL (or run out of hops).
async function resolveTtVideoUrl(url, maxHops = 6) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    if (!/^https?:\/\/(vm|vt|m)\.tiktok\.com\//i.test(current)) return current;
    const u = new URL(current);
    const next = await new Promise((resolve, reject) => {
      https.get({
        host: u.host,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
        rejectUnauthorized: false,
      }, (res) => {
        res.resume();
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          resolve(loc.startsWith('http') ? loc : `https://${u.host}${loc}`);
        } else {
          resolve(null);
        }
      }).on('error', reject);
    });
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

app.get('/api/tt-video', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || !/^https?:\/\/[^/]*tiktok\.com\//i.test(rawUrl)) {
    return res.status(400).json({ error: 'Please paste a valid TikTok video URL' });
  }

  try {
    const resolvedUrl = await resolveTtVideoUrl(rawUrl);
    const idMatch = resolvedUrl.match(/\/video\/(\d+)/);
    if (!idMatch) {
      return res.status(400).json({ error: 'Could not extract video ID from URL' });
    }
    const videoId = idMatch[1];

    // Primary path: ssstik.io → ORIGINAL 1080p no-watermark via TikTok's own CDN
    const ssstik = await fetchSsstik(resolvedUrl);
    if (ssstik && ssstik.url) {
      // HEAD-follow to resolve tikcdn.io → final TikTok CDN URL + exact size
      const final = await httpHead(ssstik.url, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://ssstik.io/',
      });
      console.log(`[tt-video] ${videoId} → ssstik (HD: ${ssstik.isHd}, ${final.size} bytes)`);
      return res.json({
        id: videoId,
        author: ssstik.author || '',
        nickname: ssstik.author || '',
        description: ssstik.title || '',
        cover: ssstik.cover || '',
        duration: 0,
        width: 0,
        height: 0,
        bitrate: 0,
        codec: '',
        sizeBytes: final.size,
        downloadUrl: final.url || ssstik.url,
        watermark: false,
        quality: ssstik.isHd ? 'Original HD' : 'No Watermark',
        source: 'ssstik',
      });
    }

    // Fallback 1: TikTok mobile API (often blocked nowadays — kept just in case)
    const aweme = await fetchTtMobileApi(videoId);
    if (aweme && aweme.video) {
      const v = aweme.video;
      const author = aweme.author || {};

      // Walk bit_rate[] for the highest-bitrate variant — typically 1080p H.264
      let bestUrl = null;
      let bestWidth = v.width || 0;
      let bestHeight = v.height || 0;
      let bestBitrate = 0;
      let bestSize = 0;
      let bestCodec = '';

      if (Array.isArray(v.bit_rate)) {
        for (const b of v.bit_rate) {
          const br = Number(b.bit_rate) || 0;
          const url = b.play_addr && Array.isArray(b.play_addr.url_list) && b.play_addr.url_list[0];
          if (url && br > bestBitrate) {
            bestBitrate = br;
            bestUrl = url;
            bestWidth  = b.play_addr.width  || bestWidth;
            bestHeight = b.play_addr.height || bestHeight;
            bestSize   = Number(b.play_addr.data_size) || 0;
            bestCodec  = b.is_h265 ? 'H.265' : 'H.264';
          }
        }
      }
      // Fallback to top-level play_addr if bit_rate is empty
      if (!bestUrl && v.play_addr && Array.isArray(v.play_addr.url_list)) {
        bestUrl  = v.play_addr.url_list[0];
        bestSize = Number(v.play_addr.data_size) || 0;
      }

      if (bestUrl) {
        const cover = (v.origin_cover && v.origin_cover.url_list && v.origin_cover.url_list[0])
                   || (v.cover        && v.cover.url_list        && v.cover.url_list[0])
                   || '';
        // mobile API duration is sometimes ms, sometimes seconds — normalize
        let duration = v.duration || 0;
        if (duration > 1000) duration = duration / 1000;
        console.log(`[tt-video] ${videoId} → mobile_api (${bestHeight}p, ${bestSize} bytes)`);
        return res.json({
          id: videoId,
          author: author.unique_id || '',
          nickname: author.nickname || '',
          description: aweme.desc || '',
          cover,
          duration,
          width: bestWidth,
          height: bestHeight,
          bitrate: bestBitrate,
          codec: bestCodec,
          sizeBytes: bestSize,
          downloadUrl: bestUrl,
          watermark: false,
          quality: bestHeight ? `${bestHeight}p` : 'HD',
          source: 'mobile_api',
        });
      }
    }

    // Fallback 2: tikwm.com → no-watermark but typically 720p (re-encoded)
    const tikwm = await fetchTikwm(resolvedUrl);
    if (tikwm && (tikwm.hdplay || tikwm.play)) {
      console.log(`[tt-video] ${videoId} → tikwm`);
      const absUrl = (u) => u && (u.startsWith('http') ? u : `https://www.tikwm.com${u}`);
      const isHd = !!tikwm.hdplay;
      return res.json({
        id: videoId,
        author: (tikwm.author && tikwm.author.unique_id) || '',
        nickname: (tikwm.author && tikwm.author.nickname) || '',
        description: tikwm.title || '',
        cover: absUrl(tikwm.origin_cover || tikwm.cover) || '',
        duration: tikwm.duration || 0,
        width: 0,
        height: 0,
        bitrate: 0,
        codec: '',
        sizeBytes: (isHd ? tikwm.hd_size : tikwm.size) || 0,
        downloadUrl: absUrl(isHd ? tikwm.hdplay : tikwm.play),
        watermark: false,
        quality: isHd ? 'HD' : 'SD',
        source: 'tikwm',
      });
    }

    // Fallback 3: scrape the canonical TikTok page (returns watermarked HD)
    console.log(`[tt-video] ${videoId} → webscrape (watermarked)`);
    const r = await httpsGet(`https://www.tiktok.com/@_/video/${videoId}`, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (r.status !== 200) {
      return res.status(r.status).json({ error: `TikTok returned ${r.status}` });
    }

    const dataMatch = r.body.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!dataMatch) return res.status(404).json({ error: 'Could not find video data' });

    let item;
    try {
      const data = JSON.parse(dataMatch[1]);
      const detail = data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.video-detail'];
      if (!detail || !detail.itemInfo || !detail.itemInfo.itemStruct) {
        return res.status(404).json({ error: 'Video not found or unavailable' });
      }
      item = detail.itemInfo.itemStruct;
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse TikTok data' });
    }

    const video = item.video || {};
    const author = item.author || {};

    // bitrateInfo is sorted by quality but ordering isn't always guaranteed —
    // pick the entry with the highest Bitrate field.
    let bestUrl = video.playAddr;
    let bestBitrate = 0;
    let codec = '';
    let dataSize = 0;
    if (Array.isArray(video.bitrateInfo)) {
      for (const b of video.bitrateInfo) {
        const br = Number(b.Bitrate) || 0;
        const url = b.PlayAddr && Array.isArray(b.PlayAddr.UrlList) && b.PlayAddr.UrlList[0];
        if (url && br > bestBitrate) {
          bestBitrate = br;
          bestUrl = url;
          codec = b.CodecType || '';
          dataSize = Number(b.PlayAddr.DataSize) || 0;
        }
      }
    }

    if (!bestUrl) return res.status(404).json({ error: 'No playable video URL found' });

    res.json({
      id: videoId,
      author: author.uniqueId || '',
      nickname: author.nickname || '',
      description: item.desc || '',
      cover: video.originCover || video.cover || '',
      duration: video.duration || 0,
      width: video.width || 0,
      height: video.height || 0,
      bitrate: bestBitrate,
      codec,
      sizeBytes: dataSize,
      downloadUrl: bestUrl,
      watermark: true,
      quality: video.height ? `${video.height}p` : 'HD',
      source: 'webscrape',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// Streams a TikTok CDN video URL with the required Referer header,
// forwarding Range requests and following redirects (tikcdn.io → real CDN).
const TT_VIDEO_HOST_RE = /^https:\/\/[^/]*(tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|byteoversea\.com|muscdn\.com|tikwm\.com|tikcdn\.io|akamaized\.net)\//;

app.get('/api/tt-video-proxy', (req, res) => {
  const target = req.query.url;
  const name = req.query.name;
  if (!target || !TT_VIDEO_HOST_RE.test(target)) {
    return res.status(400).send('bad url');
  }

  const safe = name ? String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) : `tiktok_${Date.now()}`;
  let headersSent = false;

  function attempt(url, hops) {
    if (hops > 5) {
      if (!headersSent) res.status(508).end();
      return;
    }
    if (!TT_VIDEO_HOST_RE.test(url)) {
      if (!headersSent) res.status(400).end();
      return;
    }
    const u = new URL(url);
    const opts = {
      host: u.host,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Range': req.headers.range || 'bytes=0-',
      },
      rejectUnauthorized: false,
    };
    https.get(opts, (upstream) => {
      // Follow redirects (tikcdn.io → akamaized.net → tiktokcdn.com etc)
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.resume();
        const next = upstream.headers.location.startsWith('http')
                   ? upstream.headers.location
                   : `https://${u.host}${upstream.headers.location}`;
        return attempt(next, hops + 1);
      }
      if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
        if (!headersSent) res.status(upstream.statusCode || 502).end();
        upstream.resume();
        return;
      }
      headersSent = true;
      res.status(upstream.statusCode);
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      if (upstream.headers['content-range'])  res.setHeader('Content-Range',  upstream.headers['content-range']);
      if (upstream.headers['accept-ranges'])  res.setHeader('Accept-Ranges',  upstream.headers['accept-ranges']);
      res.setHeader('Content-Disposition', `attachment; filename="${safe}.mp4"`);
      upstream.pipe(res);
    }).on('error', () => { if (!headersSent) res.status(502).end(); });
  }

  attempt(target, 0);
});

// ---------- Instagram Session Management ----------
const IG_ANDROID_UA = 'Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 542701491)';
const IG_APP_ID = '567067343352427';
let igLoggedUsername = '';

// Helper: POST with raw headers/cookies returned
function httpsPost(url, body, headers = {}, _collectedCookies = []) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = typeof body === 'string' ? body : JSON.stringify(body);
    const isJson = typeof body !== 'string';
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'User-Agent': IG_ANDROID_UA,
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept-Encoding': 'identity',
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      const newCookies = [..._collectedCookies, ...(res.headers['set-cookie'] || [])];
      // Follow redirects (collect cookies along the way)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = `https://${parsed.hostname}${loc}`;
        res.resume(); // drain response
        // Follow redirect as GET
        const cookieStr = newCookies.map(c => c.split(';')[0]).join('; ');
        return httpsGet(loc, { ...headers, 'Cookie': cookieStr })
          .then(r => resolve({ ...r, cookies: [...newCookies, ...r.cookies] }))
          .catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        body: data,
        headers: res.headers,
        cookies: newCookies,
      }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function saveSessionToEnv(sid) {
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch (_) {}
  if (/^\s*IG_SESSIONID\s*=/m.test(envContent)) {
    envContent = envContent.replace(/^\s*IG_SESSIONID\s*=.+$/m, `IG_SESSIONID=${sid}`);
  } else {
    envContent += `${envContent && !envContent.endsWith('\n') ? '\n' : ''}IG_SESSIONID=${sid}\n`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
}

function parseIgChallenge(body) {
  if (!body) return { required: false, url: null };
  try {
    const j = JSON.parse(body);
    if (j && j.message === 'challenge_required') {
      return { required: true, url: (j.challenge && j.challenge.url) || null };
    }
  } catch (_) {}
  return { required: false, url: null };
}

function invalidateIgSession(reason) {
  if (!IG_SESSIONID) return false;
  IG_SESSIONID = '';
  IG_DS_USER_ID = '';
  igLoggedUsername = '';
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/^\s*IG_SESSIONID\s*=.*\r?\n?/m, '');
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (_) {}
  console.log(`[auth] IG session invalidated (${reason || 'unspecified'})`);
  return true;
}

function extractCookie(cookies, name) {
  for (const c of cookies) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

// Fetch the logged-in username from session
async function fetchLoggedInUsername() {
  if (!IG_SESSIONID || !IG_DS_USER_ID) { igLoggedUsername = ''; return; }
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/users/${IG_DS_USER_ID}/info/`, {
      'User-Agent': IG_ANDROID_UA,
      'x-ig-app-id': IG_APP_ID,
      'Cookie': `sessionid=${IG_SESSIONID}; ds_user_id=${IG_DS_USER_ID}`,
    });
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      if (j.user) igLoggedUsername = j.user.username || '';
    }
  } catch (_) {}
}
// Resolve username on startup
fetchLoggedInUsername();

app.get('/api/ig-session', (req, res) => {
  res.json({
    loggedIn: !!IG_SESSIONID,
    username: igLoggedUsername || null,
    userId: IG_DS_USER_ID || null,
  });
});

app.post('/api/ig-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const deviceId = 'android-' + require('crypto').randomBytes(8).toString('hex');
  const guid = require('crypto').randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

  try {
    // Step 1: Get CSRF token from cookies
    const csrfRes = await httpsGet('https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=signup&guid=' + guid, {
      'User-Agent': IG_ANDROID_UA,
      'x-ig-app-id': IG_APP_ID,
    });
    let csrfToken = extractCookie(csrfRes.cookies, 'csrftoken') || 'missing';

    // Step 2: Login via web API (more reliable than mobile signed_body)
    const loginPayload = new URLSearchParams({
      username: username.trim(),
      enc_password: '#PWD_INSTAGRAM_BROWSER:0:' + Math.floor(Date.now() / 1000) + ':' + password,
      queryParams: '{}',
      optIntoOneTap: 'false',
    }).toString();

    const loginRes = await httpsPost('https://www.instagram.com/api/v1/web/accounts/login/ajax/', loginPayload, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-csrftoken': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'x-ig-app-id': '936619743392459',
      'Referer': 'https://www.instagram.com/accounts/login/',
      'Origin': 'https://www.instagram.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `csrftoken=${csrfToken}; mid=${require('crypto').randomBytes(14).toString('base64')}`,
    });

    console.log(`[auth] login response status=${loginRes.status} body=${loginRes.body.slice(0, 300)}`);

    let loginData;
    try { loginData = JSON.parse(loginRes.body); } catch (_) {
      return res.status(500).json({ error: 'Instagram returned an unexpected response. Try again later.' });
    }

    // Handle two-factor auth
    if (loginData.two_factor_required) {
      // Store cookies from this response for the 2FA step
      const tfCsrf = extractCookie(loginRes.cookies, 'csrftoken') || csrfToken;
      const tfId = loginData.two_factor_info?.two_factor_identifier;
      return res.json({
        twoFactorRequired: true,
        twoFactorId: tfId,
        csrfToken: tfCsrf,
        twoFactorMethods: loginData.two_factor_info?.totp_two_factor_on ? ['totp'] : ['sms'],
        message: 'Two-factor authentication required.',
      });
    }

    // Handle checkpoint/challenge
    if (loginData.message === 'checkpoint_required' || loginData.checkpoint_url) {
      return res.status(401).json({
        error: 'Instagram requires a security verification. Please log in via instagram.com in your browser first to verify your identity, then try again.',
      });
    }

    // Web API: authenticated=true means success, authenticated=false means wrong creds
    if (loginData.authenticated === false) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (loginData.status === 'fail' && !loginData.authenticated) {
      return res.status(401).json({
        error: loginData.message || 'Invalid username or password.',
      });
    }

    // Success — extract sessionid from cookies
    const sid = extractCookie(loginRes.cookies, 'sessionid');
    const dsUser = extractCookie(loginRes.cookies, 'ds_user_id') || (loginData.userId ? String(loginData.userId) : '');

    if (!sid) {
      return res.status(500).json({ error: 'Login succeeded but no session cookie was returned.' });
    }

    IG_SESSIONID = sid;
    IG_DS_USER_ID = dsUser;

    // Fetch the actual username from the user info API
    igLoggedUsername = username.trim();
    try {
      const infoRes = await httpsGet(`https://i.instagram.com/api/v1/users/${dsUser}/info/`, {
        'User-Agent': IG_ANDROID_UA,
        'x-ig-app-id': IG_APP_ID,
        'Cookie': `sessionid=${sid}; ds_user_id=${dsUser}`,
      });
      if (infoRes.status === 200) {
        const infoData = JSON.parse(infoRes.body);
        if (infoData.user) igLoggedUsername = infoData.user.username;
      }
    } catch (_) {}

    saveSessionToEnv(sid);

    console.log(`[auth] logged in as @${igLoggedUsername} (user ${dsUser})`);
    res.json({
      success: true,
      username: igLoggedUsername,
    });

  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Two-factor verification
app.post('/api/ig-login/2fa', async (req, res) => {
  const { code, twoFactorId, username, csrfToken } = req.body;
  if (!code || !twoFactorId) {
    return res.status(400).json({ error: 'Verification code is required.' });
  }

  try {
    const tfPayload = new URLSearchParams({
      verificationCode: code.trim(),
      identifier: twoFactorId,
      username: username || '',
    }).toString();

    const tfRes = await httpsPost('https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/', tfPayload, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-csrftoken': csrfToken || 'missing',
      'x-requested-with': 'XMLHttpRequest',
      'x-ig-app-id': '936619743392459',
      'Referer': 'https://www.instagram.com/accounts/login/two_factor/',
      'Origin': 'https://www.instagram.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `csrftoken=${csrfToken || 'missing'}`,
    });

    console.log(`[auth] 2FA response status=${tfRes.status} body=${tfRes.body.slice(0, 300)}`);

    let tfData;
    try { tfData = JSON.parse(tfRes.body); } catch (_) {
      return res.status(500).json({ error: 'Instagram returned an unexpected response.' });
    }

    if (tfData.authenticated === false || tfData.status === 'fail') {
      return res.status(401).json({ error: tfData.message || 'Invalid verification code.' });
    }

    const sid = extractCookie(tfRes.cookies, 'sessionid');
    const dsUser = extractCookie(tfRes.cookies, 'ds_user_id') || (tfData.userId ? String(tfData.userId) : '');

    if (!sid) {
      return res.status(500).json({ error: 'Verification succeeded but no session cookie was returned.' });
    }

    IG_SESSIONID = sid;
    IG_DS_USER_ID = dsUser;
    igLoggedUsername = username || '';

    // Fetch actual username
    try {
      const infoRes = await httpsGet(`https://i.instagram.com/api/v1/users/${dsUser}/info/`, {
        'User-Agent': IG_ANDROID_UA,
        'x-ig-app-id': IG_APP_ID,
        'Cookie': `sessionid=${sid}; ds_user_id=${dsUser}`,
      });
      if (infoRes.status === 200) {
        const infoData = JSON.parse(infoRes.body);
        if (infoData.user) igLoggedUsername = infoData.user.username;
      }
    } catch (_) {}

    saveSessionToEnv(sid);

    console.log(`[auth] 2FA verified, logged in as @${igLoggedUsername} (user ${dsUser})`);
    res.json({
      success: true,
      username: igLoggedUsername,
      fullName: tfData.logged_in_user.full_name || '',
    });

  } catch (err) {
    console.error('[auth] 2FA error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

app.delete('/api/ig-session', (req, res) => {
  invalidateIgSession('manual-logout');
  res.json({ success: true });
});

// ---------- Facebook Session Management ----------
function saveEnvVar(key, value) {
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch (_) {}
  const regex = new RegExp(`^\\s*${key}\\s*=.+$`, 'm');
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${key}=${value}`);
  } else {
    envContent += `${envContent && !envContent.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
}

function removeEnvVar(key) {
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(new RegExp(`^\\s*${key}\\s*=.+\\n?`, 'm'), '');
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (_) {}
}

app.get('/api/fb-session', (req, res) => {
  res.json({
    loggedIn: !!FB_COOKIES,
    username: fbLoggedUsername || null,
    userId: FB_USER_ID || null,
  });
});

// Facebook login page — paste cookies approach with nice UI
app.get('/fb-auth', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login with Facebook</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f5f3f8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:16px;padding:36px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.08)}
h2{font-size:1.2rem;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.desc{font-size:.82rem;color:#666;margin-bottom:20px;line-height:1.6}
.steps{background:#f0f2f5;border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:.78rem;color:#555;line-height:1.8}
.steps ol{padding-left:20px}
.steps code{background:#fff;border:1px solid #ddd;padding:1px 6px;border-radius:4px;font-size:.75rem;font-family:monospace}
.steps .warn{color:#e67e22;font-weight:600;margin-top:6px;font-size:.72rem}
textarea{width:100%;height:70px;padding:12px;border:2px solid #e0e0e0;border-radius:10px;font-size:.82rem;font-family:monospace;resize:vertical;outline:none;transition:border-color .2s}
textarea:focus{border-color:#1877F2}
textarea::placeholder{font-family:'Inter',sans-serif;color:#aaa}
.actions{margin-top:14px;display:flex;gap:8px;align-items:center}
.fb-btn{display:inline-flex;align-items:center;gap:8px;background:#1877F2;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-size:.88rem;font-weight:600;cursor:pointer;transition:background .2s}
.fb-btn:hover{background:#1565c0}
.fb-btn:disabled{opacity:.5;cursor:not-allowed}
.cancel{border:none;background:none;color:#666;font-size:.82rem;cursor:pointer;padding:8px}
.cancel:hover{color:#333}
.status{margin-top:14px;font-size:.8rem;display:none}
.status.show{display:block}
.status.error{color:#e53935}
.status.success{color:#2e7d32}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #ccc;border-top-color:#1877F2;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.open-fb{display:inline-flex;align-items:center;gap:6px;background:#1877F2;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:none;margin-bottom:14px;transition:background .2s}
.open-fb:hover{background:#1565c0}
</style></head><body>
<div class="card">
<h2>
<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M16.5 12.5h-2.5v7h-3v-7H9v-2.5h2v-1.5c0-2.2 1-3.5 3.3-3.5h2.2v2.5h-1.4c-1 0-1.1.4-1.1 1v1.5h2.5l-.5 2.5z" fill="#fff"/></svg>
Login with Facebook
</h2>
<p class="desc">Connect your Facebook account to view profiles and download profile pictures.</p>

<a class="open-fb" href="https://www.facebook.com" target="_blank">
<svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
Open Facebook (log in first)
</a>

<div class="steps">
<ol>
<li>Click the button above and <strong>log in</strong> to Facebook</li>
<li>Once logged in, press <code>F12</code> to open DevTools</li>
<li>Go to <strong>Application</strong> tab &rarr; <strong>Cookies</strong> &rarr; <code>facebook.com</code></li>
<li>Find <code>c_user</code> and <code>xs</code> cookies and copy their values</li>
<li>Paste both below as: <code>c_user=VALUE; xs=VALUE</code></li>
</ol>
<p class="warn">Your credentials never leave your browser. Only session cookies are stored locally.</p>
</div>

<textarea id="cookies" placeholder="c_user=123456789; xs=abc123..."></textarea>
<div class="actions">
<button class="fb-btn" id="connectBtn" onclick="doConnect()">Connect</button>
<button class="cancel" onclick="window.close()">Cancel</button>
</div>
<div class="status" id="status"></div>
</div>
<script>
async function doConnect(){
  const raw=document.getElementById('cookies').value.trim();
  const status=document.getElementById('status');
  const btn=document.getElementById('connectBtn');
  if(!raw){status.className='status show error';status.textContent='Please paste your cookies.';return}
  // Validate format
  if(!raw.includes('c_user') || !raw.includes('xs')){
    status.className='status show error';
    status.textContent='Must include both c_user and xs cookies.';
    return;
  }
  btn.disabled=true;
  status.className='status show';
  status.innerHTML='<span class="spinner"></span>Connecting...';
  try{
    const res=await fetch('/api/fb-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookies:raw})});
    const data=await res.json();
    if(!res.ok){status.className='status show error';status.textContent=data.error||'Connection failed.';btn.disabled=false;return}
    status.className='status show success';
    status.textContent='Connected as '+data.username+'! Closing...';
    if(window.opener){window.opener.postMessage({type:'fb-login-success',username:data.username},'*')}
    setTimeout(()=>window.close(),1500);
  }catch(e){status.className='status show error';status.textContent='Connection failed.';btn.disabled=false}
}
</script></body></html>`);
});

app.post('/api/fb-login', async (req, res) => {
  const { cookies } = req.body;
  if (!cookies || !cookies.includes('c_user') || !cookies.includes('xs')) {
    return res.status(400).json({ error: 'Please provide c_user and xs cookies.' });
  }

  const FB_WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  try {
    const cookieStr = cookies.trim();

    // Extract c_user to get user ID
    const cUserMatch = cookieStr.match(/c_user=(\d+)/);
    if (!cUserMatch) {
      return res.status(400).json({ error: 'Could not find c_user value in the cookies.' });
    }
    const cUser = cUserMatch[1];

    // Validate by fetching profile
    const profRes = await httpsGet(`https://www.facebook.com/profile.php?id=${cUser}`, {
      'User-Agent': FB_WEB_UA,
      'Cookie': cookieStr,
    });

    if (profRes.status !== 200 || /<title>Facebook<\/title>/.test(profRes.body)) {
      return res.status(401).json({ error: 'Session is invalid or expired. Please get fresh cookies from your browser.' });
    }

    FB_COOKIES = cookieStr;
    FB_USER_ID = cUser;

    // Extract display name
    const nameMatch = profRes.body.match(/"name"\s*:\s*"([^"]{2,50})"/) ||
                      profRes.body.match(/og:title"[^>]*content="([^"]+)"/) ||
                      profRes.body.match(/<title>([^<]+)<\/title>/);
    fbLoggedUsername = nameMatch ? decodeHtmlEntities(nameMatch[1]).trim() : 'User ' + cUser;
    // Clean up title-based names
    if (fbLoggedUsername.includes('|') || fbLoggedUsername.includes('Facebook')) {
      fbLoggedUsername = 'User ' + cUser;
    }

    saveEnvVar('FB_COOKIES', FB_COOKIES);
    saveEnvVar('FB_USERNAME', fbLoggedUsername);

    console.log(`[fb-auth] connected as ${fbLoggedUsername} (user ${cUser})`);
    res.json({ success: true, username: fbLoggedUsername, userId: cUser });

  } catch (err) {
    console.error('[fb-auth] login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.delete('/api/fb-session', (req, res) => {
  FB_COOKIES = '';
  FB_ACCESS_TOKEN = '';
  FB_USER_ID = '';
  fbLoggedUsername = '';
  removeEnvVar('FB_COOKIES');
  removeEnvVar('FB_ACCESS_TOKEN');
  removeEnvVar('FB_USERNAME');
  console.log('[fb-auth] logged out');
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
