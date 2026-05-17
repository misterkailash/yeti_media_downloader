// GET /api/ig-video-proxy?url=<ig-cdn-url>&name=<basename>
// Same idea as tt-video-proxy but locked to Instagram / Facebook CDN hosts.
import https from 'node:https';
import { UA_DESKTOP_121 } from '../utils/ua.js';

const IG_VIDEO_HOST_RE = /^https:\/\/[^/]*(fbcdn\.net|cdninstagram\.com)\//;

export default defineEventHandler((event) => {
  const q = getQuery(event);
  const target = q.url;
  const name = q.name;
  const res = event.node.res;
  const reqRange = event.node.req.headers.range;

  if (!target || !IG_VIDEO_HOST_RE.test(String(target))) {
    res.statusCode = 400;
    res.end('bad url');
    return;
  }

  const safe = name ? String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) : `ig_${Date.now()}`;
  let headersSent = false;

  return new Promise((resolve) => {
    const done = () => resolve();

    function attempt(url, hops) {
      if (hops > 5) {
        if (!headersSent) { res.statusCode = 508; res.end(); }
        return done();
      }
      if (!IG_VIDEO_HOST_RE.test(url)) {
        if (!headersSent) { res.statusCode = 400; res.end(); }
        return done();
      }
      const u = new URL(url);
      const opts = {
        host: u.host,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': UA_DESKTOP_121,
          'Accept': '*/*',
          'Range': reqRange || 'bytes=0-',
        },
        rejectUnauthorized: false,
      };
      https.get(opts, (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          upstream.resume();
          const next = upstream.headers.location.startsWith('http')
                     ? upstream.headers.location
                     : `https://${u.host}${upstream.headers.location}`;
          return attempt(next, hops + 1);
        }
        if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
          if (!headersSent) { res.statusCode = upstream.statusCode || 502; res.end(); }
          upstream.resume();
          return done();
        }
        headersSent = true;
        // Downgrade 206 -> 200 when the client didn't request a Range, so
        // direct downloads ('<a download>' clicks) get a clean 200 OK.
        const clientHasRange = !!reqRange;
        const status = (upstream.statusCode === 206 && !clientHasRange) ? 200 : upstream.statusCode;
        res.statusCode = status;
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
        if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
        if (clientHasRange && upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
        if (upstream.headers['accept-ranges'])  res.setHeader('Accept-Ranges',  upstream.headers['accept-ranges']);
        res.setHeader('Content-Disposition', `attachment; filename="${safe}.mp4"`);
        upstream.pipe(res);
        res.on('finish', done);
        res.on('close', done);
      }).on('error', () => { if (!headersSent) { res.statusCode = 502; res.end(); } done(); });
    }

    attempt(target, 0);
  });
});
