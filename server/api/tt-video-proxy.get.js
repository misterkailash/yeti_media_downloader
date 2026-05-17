// GET /api/tt-video-proxy?url=<tiktok-cdn-url>&name=<basename>
// Range-aware streaming proxy for TikTok + Twitter video CDNs. Pulls the
// upstream stream and re-emits with a Content-Disposition: attachment
// header so download managers like IDM accept it as a real file download.
import https from 'node:https';
import { UA_DESKTOP_120 } from '../utils/ua.js';

// Allowlist of CDN host suffixes. Includes every TikTok-owned video host
// we've seen plus the public proxies (tikwm, tikcdn.io) ssstik /
// tikdownloader sometimes return. The base `tiktok.com` is allowed so
// the newer *.tiktok.com webapp-prime endpoints work too.
const TT_VIDEO_HOST_RE = /^https:\/\/[^/]*(tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|byteoversea\.com|muscdn\.com|tikwm\.com|tikcdn\.io|tokcdn\.com|akamaized\.net|akamaihd\.net|bytefcdn-oceanapi\.com|bytecdn\.cn|tiktok\.com|video\.twimg\.com|pbs\.twimg\.com)\//;

export default defineEventHandler((event) => {
  const q = getQuery(event);
  const target = q.url;
  const name = q.name;
  const res = event.node.res;
  const reqRange = event.node.req.headers.range;

  if (!target || !TT_VIDEO_HOST_RE.test(String(target))) {
    console.warn(`[tt-video-proxy] REJECTED (regex) url=${String(target).slice(0, 200)}`);
    res.statusCode = 400;
    res.end('bad url');
    return;
  }
  console.log(`[tt-video-proxy] start url=${String(target).slice(0, 120)}`);

  const safe = name ? String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) : `tiktok_${Date.now()}`;
  let headersSent = false;

  return new Promise((resolve) => {
    const done = () => resolve();

    function attempt(url, hops) {
      if (hops > 5) {
        console.warn(`[tt-video-proxy] too many redirects (>5)`);
        if (!headersSent) { res.statusCode = 508; res.end(); }
        return done();
      }
      if (!TT_VIDEO_HOST_RE.test(url)) {
        console.warn(`[tt-video-proxy] redirected to disallowed host: ${url.slice(0, 200)}`);
        if (!headersSent) { res.statusCode = 400; res.end(); }
        return done();
      }
      const u = new URL(url);
      const isTwitter = /twimg\.com$/i.test(u.host);
      const opts = {
        host: u.host,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': UA_DESKTOP_120,
          'Referer': isTwitter ? 'https://twitter.com/' : 'https://www.tiktok.com/',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Range': reqRange || 'bytes=0-',
        },
        rejectUnauthorized: false,
      };
      https.get(opts, (upstream) => {
        console.log(`[tt-video-proxy]   ${u.host} status=${upstream.statusCode} ct=${upstream.headers['content-type'] || '-'}`);
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          upstream.resume();
          const next = upstream.headers.location.startsWith('http')
                     ? upstream.headers.location
                     : `https://${u.host}${upstream.headers.location}`;
          return attempt(next, hops + 1);
        }
        if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
          console.warn(`[tt-video-proxy] upstream FAILED status=${upstream.statusCode} host=${u.host}`);
          if (!headersSent) { res.statusCode = upstream.statusCode || 502; res.end(); }
          upstream.resume();
          return done();
        }
        headersSent = true;
        // We ask upstream for `bytes=0-` even when the client didn't send a
        // Range — some CDNs (TT among them) return 416 to bare GETs. But if
        // the client didn't ask for partial content, downgrade the 206 to a
        // plain 200 so Chrome's download manager doesn't bail with
        // "file wasn't available on site".
        const clientHasRange = !!reqRange;
        const status = (upstream.statusCode === 206 && !clientHasRange) ? 200 : upstream.statusCode;
        res.statusCode = status;
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
        // Content-Length from the upstream is the byte count of the slice;
        // for our 0-to-end Range that equals the full file size, so it's
        // safe to forward even when we relabel the status as 200.
        if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
        if (clientHasRange && upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
        if (upstream.headers['accept-ranges'])  res.setHeader('Accept-Ranges',  upstream.headers['accept-ranges']);
        res.setHeader('Content-Disposition', `attachment; filename="${safe}.mp4"`);
        upstream.pipe(res);
        res.on('finish', () => { console.log(`[tt-video-proxy] done piping`); done(); });
        res.on('close', done);
      }).on('error', (e) => {
        console.warn(`[tt-video-proxy] socket error: ${e.message}`);
        if (!headersSent) { res.statusCode = 502; res.end(); }
        done();
      });
    }

    attempt(target, 0);
  });
});
