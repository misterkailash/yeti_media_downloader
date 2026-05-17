// TikTok video extraction helpers — moved out of server.js so the Nitro
// endpoint at server/api/tt-video.get.js can consume them. Race-multi-source
// pipeline: ssstik.io and tikdownloader.io in parallel (both can return the
// original 1080p HD), tikwm + the mobile feed API as fallbacks, and a final
// webscrape that produces watermarked HD when everything else fails.
const https = require('https');
const { httpsGet } = require('./http');
const { UA_DESKTOP_120, UA_DESKTOP_120_LITE, UA_MOBILE_IPHONE } = require('./ua');
const { decodeHtmlEntities } = require('./util');

function findHrefByClass(html, klass) {
  const re = new RegExp(
    `<a\\b(?=[^>]*\\bclass="[^"]*\\b${klass}\\b[^"]*")[^>]*?\\bhref="([^"]+)"`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function fetchSsstik(videoUrl) {
  return new Promise((resolve) => {
    const ua = UA_DESKTOP_120;
    const pageReq = https.get({
      host: 'ssstik.io', path: '/en',
      headers: { 'User-Agent': ua, 'Accept': 'text/html' },
      rejectUnauthorized: false,
    }, (pageRes) => {
      let html = '';
      pageRes.on('data', c => html += c);
      pageRes.on('end', () => {
        const tokenMatch = html.match(/name="tt"\s+value="([^"]+)"/);
        if (!tokenMatch) { console.warn('[ssstik] no tt token on homepage'); return resolve(null); }
        const tt = tokenMatch[1];
        const postData = `id=${encodeURIComponent(videoUrl)}&locale=en&tt=${encodeURIComponent(tt)}`;
        const dlReq = https.request({
          host: 'ssstik.io', path: '/abc?url=dl', method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': ua, 'Accept': '*/*',
            'Origin': 'https://ssstik.io', 'Referer': 'https://ssstik.io/en',
            'HX-Request': 'true', 'HX-Target': 'target',
            'HX-Current-URL': 'https://ssstik.io/en',
          },
          rejectUnauthorized: false,
        }, (dlRes) => {
          let body = '';
          dlRes.on('data', c => body += c);
          dlRes.on('end', () => {
            const hdUrl = findHrefByClass(body, 'without_watermark_hd');
            const sdUrl = !hdUrl ? findHrefByClass(body, 'without_watermark') : null;
            const url = hdUrl || sdUrl;
            if (!url) { console.warn('[ssstik] no download links in response'); return resolve(null); }
            const titleMatch  = body.match(/<p[^>]*class="maintext"[^>]*>([\s\S]*?)<\/p>/);
            const coverMatch  = body.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*result_author[^"]*"/);
            const authorMatch = body.match(/<h2>([^<]+)<\/h2>/);
            resolve({
              url, isHd: !!hdUrl,
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

function decodeSnapcdnJwtUrl(redirectorUrl) {
  try {
    const m = redirectorUrl.match(/[?&]token=([^&#]+)/);
    if (!m) return null;
    const token = decodeURIComponent(m[1]);
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    payload += '='.repeat((4 - payload.length % 4) % 4);
    const j = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return (j && j.url) || null;
  } catch (_) { return null; }
}

function fetchTikdownloader(videoUrl) {
  return new Promise((resolve) => {
    // CF on tikdownloader.io blacklists the literal "(KHTML, like Gecko)"
    // substring — using UA_DESKTOP_120_LITE (sans that substring) → 200 OK.
    const ua = UA_DESKTOP_120_LITE;
    const postData = `q=${encodeURIComponent(videoUrl)}&lang=en`;
    const req = https.request({
      host: 'tikdownloader.io', path: '/api/ajaxSearch', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': ua, 'Accept': '*/*',
        'Origin': 'https://tikdownloader.io',
        'Referer': 'https://tikdownloader.io/en',
        'X-Requested-With': 'XMLHttpRequest',
      },
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) { console.warn(`[tikdownloader] http=${res.statusCode}`); return resolve(null); }
          const j = JSON.parse(body);
          if (!j || j.status !== 'ok' || !j.data) {
            if (j && j.mess) console.warn(`[tikdownloader] ${j.mess}`);
            return resolve(null);
          }
          const html = j.data;
          const allAnchors = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
          let hdUrl = null, directCdnUrl = null, anySnapcdnUrl = null;
          for (const m of allAnchors) {
            const href = m[1];
            const text = m[2].replace(/<[^>]+>/g, '').trim();
            if (!/^https?:\/\//.test(href)) continue;
            if (/mp3|music|audio/i.test(text) || /\.mp3(\?|$)/i.test(href)) continue;
            const isSnapcdn = /(?:^|\/\/)[^/]*snapcdn\.app\//i.test(href);
            const isHdText  = /\bHD\b/i.test(text);
            if (isHdText && !hdUrl) hdUrl = href;
            else if (!directCdnUrl && /tikcdn|tiktokcdn|byteoversea|tokcdn|akamaized/.test(href) && !isSnapcdn) directCdnUrl = href;
            else if (isSnapcdn && !anySnapcdnUrl) anySnapcdnUrl = href;
          }
          let url = hdUrl || directCdnUrl || anySnapcdnUrl;
          if (url && /snapcdn\.app/i.test(url)) {
            const decoded = decodeSnapcdnJwtUrl(url);
            if (decoded) url = decoded;
          }
          if (!url) { console.warn('[tikdownloader] no download links in fragment'); return resolve(null); }
          const titleMatch = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
          const coverMatch = html.match(/<img[^>]*src="([^"]+)"/);
          resolve({
            url, isHd: !!hdUrl,
            title:  titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : '',
            cover:  coverMatch ? decodeHtmlEntities(coverMatch[1]) : '',
            author: '',
          });
        } catch (e) { console.warn(`[tikdownloader] parse: ${e.message}`); resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[tikdownloader] ${e.message}`); resolve(null); });
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

function fetchTtMobileApi(videoId) {
  const params = new URLSearchParams({
    aweme_id: videoId, iid: '7318518857994389254', device_id: '7318517321748022790',
    version_name: '26.1.3', version_code: '260103', build_number: '26.1.3',
    manifest_version_code: '260103', update_version_code: '260103',
    openudid: 'a1b2c3d4e5f67890', uuid: '1234567890123456',
    _rticket: String(Date.now()), ts: String(Math.floor(Date.now() / 1000)),
    device_brand: 'Google', device_type: 'Pixel 7', device_platform: 'android',
    resolution: '1080*2400', dpi: '420', os_version: '13', os_api: '33',
    carrier_region: 'US', sys_region: 'US', region: 'US',
    app_name: 'musical_ly', app_language: 'en', language: 'en',
    timezone_name: 'America/New_York', timezone_offset: '-14400',
    channel: 'googleplay', ac: 'wifi', mcc_mnc: '310260', aid: '1233',
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
          } else resolve(null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[tt-mobile] ${host}: ${e.message}`); resolve(null); });
    req.setTimeout(4000, () => { req.destroy(); resolve(null); });
  });
  return tryHost('api22-normal-c-useast2a.tiktokv.com')
    .then(r => r || tryHost('api16-normal-c-useast1a.tiktokv.com'))
    .then(r => r || tryHost('api19-normal-c-useast1a.tiktokv.com'));
}

function fetchTikwm(videoUrl) {
  return new Promise((resolve) => {
    const postData = `url=${encodeURIComponent(videoUrl)}&hd=1`;
    const req = https.request({
      host: 'www.tikwm.com', path: '/api/', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': UA_DESKTOP_120, 'Accept': 'application/json',
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

async function resolveTtVideoUrl(url, maxHops = 6) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    if (!/^https?:\/\/(vm|vt|m)\.tiktok\.com\//i.test(current)) return current;
    const u = new URL(current);
    const next = await new Promise((resolve, reject) => {
      https.get({
        host: u.host, path: u.pathname + u.search,
        headers: { 'User-Agent': UA_MOBILE_IPHONE },
        rejectUnauthorized: false,
      }, (res) => {
        res.resume();
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          resolve(loc.startsWith('http') ? loc : `https://${u.host}${loc}`);
        } else resolve(null);
      }).on('error', reject);
    });
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

module.exports = {
  fetchSsstik, fetchTikdownloader, fetchTtMobileApi, fetchTikwm,
  resolveTtVideoUrl,
};
