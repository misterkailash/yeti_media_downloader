// Album-zip helpers — used by server/api/album-zip.post.js.
//
// Chrome blocks N sequential programmatic downloads (only the first fires),
// so the frontend POSTs the full slide list here and we bundle it into one
// store-mode zip that streams back as a single download. CDN allowlist is
// strict: only IG / FB / TikTok CDNs (callers are album-style downloads
// from those platforms; other sources would never legitimately hit this).
const https = require('https');
const { UA_DESKTOP_121 } = require('./ua');

const ALBUM_HOST_RE = /(fbcdn\.net|cdninstagram\.com|tiktokcdn\.com|tiktokcdn-us\.com|ibyteimg\.com|tikwm\.com)/;

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
    let u; try { u = new URL(url); } catch { return resolve(null); }
    if (!ALBUM_HOST_RE.test(u.host)) return resolve(null);
    const req = https.get({
      host: u.host, path: u.pathname + u.search, rejectUnauthorized: false,
      headers: {
        'User-Agent': UA_DESKTOP_121,
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
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
  });
}

// Hand-rolled store-mode zip (no compression). Files already are jpeg/mp4
// which don't compress meaningfully; skipping deflate keeps the server
// cost low and the output stream-friendly.
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
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
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

module.exports = { fetchBinary, buildZip };
