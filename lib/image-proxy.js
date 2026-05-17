// Shared image-proxy logic — used by:
//   server/api/image-proxy.get.js
//   server/api/image-proxy/[filename].get.js
//
// Two paths:
//   - VSCO: fans out across a chain of public proxy services because VSCO's
//     Cloudflare blocks server-to-server fetches with our IP. Each builder
//     produces a candidate URL; first one to return valid image bytes wins.
//   - All other allowed hosts: streamFetch buffers the first 12 bytes for
//     magic-byte validation, then pipes the rest directly to the client.
//
// Magic bytes are checked because some upstream services (Jina Reader,
// public proxies) return error pages with image content-types when they
// can't reach the source.
const https = require('https');
const sharp = require('sharp');
const { UA_DESKTOP_121 } = require('./ua');

const ALLOWED_HOST_RE = /^https:\/\/[^/]*(fbcdn\.net|fbsbx\.com|cdninstagram\.com|tiktokcdn\.com|tiktokcdn-us\.com|ibyteimg\.com|tikwm\.com|vsco\.co|pbs\.twimg\.com|video\.twimg\.com|abs\.twimg\.com|ytimg\.com|googleusercontent\.com|sndcdn\.com|i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.redditmedia\.com|styles\.redditmedia\.com)\//;

// Hosts allowed for the VSCO fan-out (image-specific proxies only — generic
// HTTP fetchers like allorigins/corsproxy were removed because they let
// arbitrary URLs ride through and don't enforce that the response is image
// bytes). Jina is allowed in `screenshot` mode, which only returns a PNG
// render, not raw upstream content.
const VSCO_PROXY_HOST_RE = /^https:\/\/([^/]*\.)?(r\.jina\.ai|wsrv\.nl|images\.weserv\.nl|vsco\.co)\//;

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|avif)$/i.test(brand)) {
      return brand.toLowerCase() === 'avif' ? 'image/avif' : 'image/heic';
    }
    return 'video/mp4';
  }
  return null;
}

// Resolve once res is closed so the h3 handler's promise settles cleanly.
function handleImageProxy({ target, name, inline, res }) {
  return new Promise((resolve) => {
    if (!target || !ALLOWED_HOST_RE.test(target)) {
      res.statusCode = 400;
      res.end('bad url');
      return resolve();
    }
    const isVsco = /vsco\.co/.test(target);
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    async function sendImage(result) {
      let buffer = result.buffer;
      let contentType = detectImageType(buffer)
                     || (result.headers['content-type'] || '').match(/^image\/[\w+.-]+/)?.[0]
                     || 'image/jpeg';
      if (name && contentType === 'image/webp') {
        const isAnimated = buffer.length > 30 && buffer.slice(12, 16).toString() === 'VP8X' && (buffer[20] & 0x02);
        if (!isAnimated) {
          try {
            const jpeg = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
            console.log(`[image-proxy] transcoded webp -> jpeg (${buffer.length}b -> ${jpeg.length}b)`);
            buffer = jpeg;
            contentType = 'image/jpeg';
          } catch (e) {
            console.warn(`[image-proxy] webp->jpeg transcode failed: ${e.message}, sending original`);
          }
        }
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (name && !inline) {
        const safe = String(name)
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/\.(mp4|m4v|mov|webm|jpg|jpeg|png|gif|webp|heic|heif|avif)$/i, '')
          .slice(0, 100);
        const ext = contentType.startsWith('video/') ? 'mp4'
                  : contentType.includes('webp') ? 'webp'
                  : contentType.includes('png')  ? 'png'
                  : contentType.includes('gif')  ? 'gif'
                  : contentType.includes('avif') ? 'avif'
                  : contentType.includes('heic') ? 'heic'
                  : 'jpg';
        res.setHeader('Content-Disposition', `attachment; filename="${safe}.${ext}"`);
      }
      res.end(buffer);
      finish();
    }

    function tryFetch(url, callback, hops = 0) {
      if (hops > 3) return callback(null);
      // Re-validate every URL we follow against the VSCO fan-out allowlist.
      // The initial allowlist check happens once on the user input; without
      // re-validating each redirect, an allowed host that 302s elsewhere
      // would let us SSRF.
      if (!VSCO_PROXY_HOST_RE.test(url)) return callback(null);
      let u; try { u = new URL(url); } catch (_) { return callback(null); }
      const headers = {
        'User-Agent': UA_DESKTOP_121,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };
      if (u.host.endsWith('vsco.co')) headers['Referer'] = 'https://vsco.co/';
      if (u.host === 'r.jina.ai') {
        headers['X-Return-Format'] = 'screenshot';
        headers['Accept'] = 'image/png,image/*,*/*;q=0.8';
      }
      const req = https.get({
        host: u.host, path: u.pathname + u.search, headers, rejectUnauthorized: false,
      }, (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          upstream.resume();
          let next; try { next = new URL(upstream.headers.location, url).href; }
          catch (_) { return callback(null); }
          return tryFetch(next, callback, hops + 1);
        }
        const ct = upstream.headers['content-type'] || '';
        console.log(`[image-proxy]   ${u.host} status=${upstream.statusCode} ct=${ct}`);
        if (upstream.statusCode !== 200) { upstream.resume(); return callback(null); }
        const chunks = []; let totalLen = 0;
        upstream.on('data', (c) => { chunks.push(c); totalLen += c.length; if (totalLen > 25 * 1024 * 1024) upstream.destroy(); });
        upstream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const detected = detectImageType(buffer);
          if (detected) callback({ buffer, headers: upstream.headers });
          else { console.log(`[image-proxy]   ${u.host} invalid bytes (${buffer.length}b)`); callback(null); }
        });
        upstream.on('error', () => callback(null));
      });
      req.on('error', (e) => { console.warn(`[image-proxy]   ${u.host} error: ${e.message}`); callback(null); });
      req.setTimeout(15000, () => { req.destroy(); console.warn(`[image-proxy]   ${u.host} timeout`); callback(null); });
    }

    function trySequential(builders, idx, callback) {
      if (idx >= builders.length) return callback(null);
      const url = builders[idx](target);
      let host = ''; try { host = new URL(url).host; } catch (_) {}
      console.log(`[image-proxy] [${idx + 1}/${builders.length}] ${host}`);
      tryFetch(url, (upstream) => {
        if (upstream) { console.log(`[image-proxy] success via ${host} (${upstream.buffer.length}b)`); callback(upstream); }
        else trySequential(builders, idx + 1, callback);
      });
    }

    function streamFetch(url, hops = 0) {
      if (hops > 3) { if (!res.headersSent) { res.statusCode = 502; res.end(); } return finish(); }
      // Re-validate the allowlist on every redirect — an allowed CDN that
      // 302s to localhost/internal-IPs would otherwise turn this into SSRF.
      if (!ALLOWED_HOST_RE.test(url)) { if (!res.headersSent) { res.statusCode = 502; res.end(); } return finish(); }
      let u; try { u = new URL(url); } catch (_) { if (!res.headersSent) { res.statusCode = 400; res.end(); } return finish(); }
      const ua = /(^|\.)fbsbx\.com$/.test(u.host)
        ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
        : UA_DESKTOP_121;
      const req = https.get({
        host: u.host, path: u.pathname + u.search, rejectUnauthorized: false,
        headers: { 'User-Agent': ua, 'Accept': 'image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8' },
      }, (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          upstream.resume();
          let next; try { next = new URL(upstream.headers.location, url).href; }
          catch (_) { if (!res.headersSent) { res.statusCode = 502; res.end(); } return finish(); }
          return streamFetch(next, hops + 1);
        }
        if (upstream.statusCode !== 200) {
          upstream.resume();
          if (!res.headersSent) { res.statusCode = upstream.statusCode; res.end(); }
          return finish();
        }
        let head = Buffer.alloc(0); let piping = false;
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
            res.setHeader('Content-Disposition', `attachment; filename="${safe}.${ext}"`);
          }
        };
        const resolveType = () => {
          const magic = detectImageType(head);
          if (magic) return magic;
          const ct = upstream.headers['content-type'] || '';
          const m = ct.match(/^(image|video)\/[\w+.-]+/);
          return m ? m[0] : null;
        };
        const bufferAndTranscode = () => {
          const chunks = [head]; let total = head.length;
          upstream.on('data', (c) => { chunks.push(c); total += c.length; if (total > 25 * 1024 * 1024) upstream.destroy(); });
          upstream.on('end', async () => {
            const buffer = Buffer.concat(chunks);
            const isAnimated = buffer.length > 30 && buffer.slice(12, 16).toString() === 'VP8X' && (buffer[20] & 0x02);
            if (isAnimated) { writeHeaders('image/webp'); res.end(buffer); return finish(); }
            try {
              const jpeg = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
              console.log(`[image-proxy] transcoded webp -> jpeg (${buffer.length}b -> ${jpeg.length}b)`);
              res.setHeader('Content-Type', 'image/jpeg');
              res.setHeader('Content-Length', jpeg.length);
              res.setHeader('Cache-Control', 'public, max-age=3600');
              const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
              res.setHeader('Content-Disposition', `attachment; filename="${safe}.jpg"`);
              res.end(jpeg);
            } catch (e) {
              console.warn(`[image-proxy] webp->jpeg transcode failed: ${e.message}, sending original`);
              writeHeaders('image/webp'); res.end(buffer);
            }
            finish();
          });
          upstream.on('error', () => { if (!res.headersSent) { res.statusCode = 502; res.end(); } finish(); });
        };
        const startStream = () => {
          const type = resolveType();
          if (!type) { upstream.destroy(); if (!res.headersSent) { res.statusCode = 502; res.end(); } console.warn(`[image-proxy] invalid magic bytes from ${u.host}`); finish(); return false; }
          if (name && type === 'image/webp') { bufferAndTranscode(); return false; }
          writeHeaders(type); return true;
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
            res.on('finish', finish);
            res.on('close', finish);
          }
        };
        const onEnd = () => {
          if (piping) return;
          if (!startStream()) return;
          res.end(head); finish();
        };
        upstream.on('data', onData);
        upstream.on('end', onEnd);
        upstream.on('error', () => { if (!res.headersSent) { res.statusCode = 502; res.end(); } finish(); });
      });
      req.on('error', () => { if (!res.headersSent) { res.statusCode = 502; res.end(); } finish(); });
      req.setTimeout(15000, () => { req.destroy(); if (!res.headersSent) { res.statusCode = 504; res.end(); } finish(); });
    }

    if (isVsco) {
      // Image-specific proxies only. Generic HTTP fetchers (allorigins,
      // corsproxy, codetabs, cors.sh) were removed — they pass our IP and
      // the target URL to a third party and return raw bytes, which is both
      // a privacy leak and (combined with weak validation) an SSRF surface.
      // The remaining four are scoped: Jina returns a rendered screenshot,
      // wsrv/weserv only deliver images, and direct hits vsco.co itself.
      const builders = [
        (u) => `https://r.jina.ai/${u}`,
        (u) => u,
        (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}`,
        (u) => `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}`,
      ];
      const hasExt = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(target);
      const targets = hasExt ? [target] : [target, target + '.jpg'];
      const proxies = [];
      for (const t of targets) for (const b of builders) proxies.push(() => b(t));
      trySequential(proxies, 0, (upstream) => {
        if (upstream) sendImage(upstream);
        else { if (!res.headersSent) { res.statusCode = 502; res.end(); } console.warn(`[image-proxy] ALL proxies exhausted for ${target}`); finish(); }
      });
    } else {
      streamFetch(target);
    }
  });
}

module.exports = { handleImageProxy, detectImageType };
