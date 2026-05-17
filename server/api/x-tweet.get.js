// GET /api/x-tweet?url=<tweet-url>
//
// Two-tier extraction:
//   1. cdn.syndication.twimg.com — the public embed-widget API (no auth).
//      Fast and reliable for normal tweets but returns TweetTombstone for
//      anything age-gated, sensitive, NSFW, or login-walled.
//   2. api.fxtwitter.com — a community-maintained Twitter mirror used by
//      Discord/Telegram embeds. Picks up most tombstoned tweets because
//      it routes through different bot endpoints.
import https from 'node:https';
import { httpsGet, httpHead } from '../utils/http.js';
import { UA_DESKTOP_120_LITE } from '../utils/ua.js';

// Twitter's own embed JS: `((id / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')`.
// Number() loses precision on 19-digit IDs, but the token is only used as a
// CDN cache key — Twitter doesn't validate the math, just that it hashes
// consistently per ID. The lossy result is stable.
function tweetToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// fxtwitter.com mirror — returns clean JSON for public tweets, including
// many that the syndication API tombstones. Resolves to a normalized
// `{ user, text, mediaDetails: [...] }` shape that matches the syndication
// response so the same extraction logic works.
function fetchFxtwitter(id) {
  return new Promise((resolve) => {
    https.get({
      host: 'api.fxtwitter.com',
      path: `/i/status/${id}`,
      headers: {
        'User-Agent': UA_DESKTOP_120_LITE,
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (!j || j.code !== 200 || !j.tweet) {
            console.warn(`[x-tweet] fxtwitter ${id} status=${res.statusCode} code=${j && j.code} msg=${j && j.message}`);
            return resolve(null);
          }
          const t = j.tweet;
          const allMedia = (t.media && t.media.all) || [];
          const mediaDetails = allMedia.map(m => {
            if (m.type === 'video' || m.type === 'gif') {
              return {
                type: m.type === 'gif' ? 'animated_gif' : 'video',
                media_url_https: m.thumbnail_url || '',
                original_info: { width: m.width || 0, height: m.height || 0 },
                video_info: {
                  duration_millis: m.duration ? Math.round(m.duration * 1000) : 0,
                  variants: [{ content_type: 'video/mp4', bitrate: m.bitrate || 0, url: m.url }],
                },
              };
            }
            return {
              type: 'photo',
              media_url_https: m.url || '',
              original_info: { width: m.width || 0, height: m.height || 0 },
            };
          });
          resolve({
            __typename: 'Tweet',
            user: { screen_name: t.author && t.author.screen_name, name: t.author && t.author.name },
            text: t.text || '',
            mediaDetails,
          });
        } catch (e) {
          console.warn(`[x-tweet] fxtwitter ${id} parse: ${e.message}`);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.warn(`[x-tweet] fxtwitter ${id} err: ${e.message}`);
      resolve(null);
    });
  });
}

// Follow t.co / shortener redirects until we land on a /status/<id> URL.
async function resolveTweetUrl(url, hops = 0) {
  if (hops > 5) return url;
  if (/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i.test(url)) return url;
  if (!/^https?:\/\/(t\.co|tinyurl\.com|bit\.ly)\//i.test(url)) return url;
  const u = new URL(url);
  return new Promise((resolve) => {
    https.get({
      host: u.host, path: u.pathname + u.search,
      headers: { 'User-Agent': UA_DESKTOP_120_LITE },
      rejectUnauthorized: false,
    }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
                   ? res.headers.location
                   : `https://${u.host}${res.headers.location}`;
        return resolve(resolveTweetUrl(next, hops + 1));
      }
      resolve(url);
    }).on('error', () => resolve(url));
  });
}

export default defineEventHandler(async (event) => {
  const { url: rawUrl } = getQuery(event);
  if (!rawUrl || typeof rawUrl !== 'string' || !/^https?:\/\//.test(rawUrl)) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid X/Twitter URL' };
  }
  try {
    const resolved = await resolveTweetUrl(rawUrl);
    const idMatch = resolved.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
    if (!idMatch) {
      setResponseStatus(event, 400);
      return { error: 'Could not extract tweet ID from URL' };
    }
    const id = idMatch[1];
    const token = tweetToken(id);

    const r = await httpsGet(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${encodeURIComponent(token)}&lang=en`,
      {
        'User-Agent': UA_DESKTOP_120_LITE,
        'Accept': 'application/json',
        'Referer': 'https://platform.twitter.com/',
      }
    );
    if (r.status === 404) {
      setResponseStatus(event, 404);
      return { error: 'Tweet not found, deleted, or private' };
    }
    if (r.status !== 200) {
      setResponseStatus(event, r.status);
      return { error: `Twitter returned ${r.status}` };
    }

    let j;
    try { j = JSON.parse(r.body); } catch (_) {
      console.warn(`[x-tweet] ${id} non-JSON response`);
      j = null;
    }
    // Syndication tombstones age-gated/sensitive tweets — fall through to
    // fxtwitter which routes via different (bot-friendly) endpoints.
    if (!j || j.tombstone || j.__typename !== 'Tweet') {
      console.log(`[x-tweet] ${id} syndication=${j && j.__typename || 'none'} → trying fxtwitter`);
      const fx = await fetchFxtwitter(id);
      if (fx) {
        console.log(`[x-tweet] ${id} fxtwitter ok (mediaCount=${fx.mediaDetails.length})`);
        j = fx;
      } else {
        setResponseStatus(event, 404);
        return { error: 'Tweet unavailable (deleted, age-restricted, or private)' };
      }
    } else {
      console.log(`[x-tweet] ${id} syndication ok (mediaCount=${(j.mediaDetails || []).length})`);
    }

    const user = j.user || {};
    const author = user.screen_name || '';
    const nickname = user.name || '';
    const description = j.text || '';
    const media = (j.mediaDetails && j.mediaDetails[0]) || null;

    if (!media) {
      setResponseStatus(event, 404);
      return { error: 'Tweet has no downloadable media' };
    }

    const origInfo = media.original_info || {};
    let downloadUrl = '';
    let mediaType = 'photo';
    let cover = media.media_url_https || '';
    let bitrate = 0;
    let duration = 0;
    let sizeBytes = 0;

    if (media.type === 'video' || media.type === 'animated_gif') {
      mediaType = 'video';
      const variants = (media.video_info && media.video_info.variants) || [];
      let best = null;
      for (const v of variants) {
        if (v.content_type !== 'video/mp4') continue;
        // Always seed `best` on the first mp4, then prefer higher bitrates.
        // Bare `>` skipped fxtwitter's single-variant case where bitrate is 0/undefined.
        if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
      }
      if (!best) {
        setResponseStatus(event, 404);
        return { error: 'No mp4 variant available' };
      }
      downloadUrl = best.url;
      bitrate = best.bitrate || 0;
      duration = (media.video_info && media.video_info.duration_millis)
        ? Math.round(media.video_info.duration_millis / 1000) : 0;
      const head = await httpHead(downloadUrl, {
        'User-Agent': UA_DESKTOP_120_LITE,
        'Referer': 'https://twitter.com/',
      });
      sizeBytes = head.size || 0;
    } else {
      // Photo — `?name=orig` returns the un-resized original. Twitter strips
      // EXIF but otherwise leaves it alone (no re-encode, no watermark).
      mediaType = 'photo';
      const base = media.media_url_https || '';
      downloadUrl = base.includes('?') ? base : base + '?name=orig';
    }

    return {
      id,
      author,
      nickname,
      description,
      cover,
      mediaType,
      downloadUrl,
      width: origInfo.width || 0,
      height: origInfo.height || 0,
      bitrate,
      duration,
      sizeBytes,
      mediaCount: (j.mediaDetails || []).length,
    };
  } catch (err) {
    console.error('[x-tweet]', err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch tweet' };
  }
});
