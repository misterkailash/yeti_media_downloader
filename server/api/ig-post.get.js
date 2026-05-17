// GET /api/ig-post?url=<instagram-post-or-reel-url>
//
// Accepts any IG post / reel / IGTV URL, resolves the shortcode, and returns
// the data the frontend's "video result" card needs (cover, author, caption,
// download URL, dimensions, duration, slides for carousels).
//
// Two-pass yt-dlp: try anonymously first (works for most public posts), and
// if IG demands auth, retry with the user's session cookies. Falls through
// to og:image scrape and finally the IG mobile media-info API for image-only
// posts that yt-dlp doesn't fully resolve.
//
// Proactive lock check: when the URL carries a /<username>/ segment AND we
// have a session, we look up the profile's user_id + is_private flag and
// run a friendship check before yt-dlp. Returning a clear "private, you
// don't follow" error here avoids a 5s yt-dlp failure path that surfaces
// the same info through a less-informative error string.
import { httpsGet } from '../utils/http.js';
import { UA_DESKTOP_124 } from '../utils/ua.js';
import { decodeHtmlEntities } from '../utils/util.js';
import { IG_SID, IG_COOKIE } from '../utils/session.js';
import { ytExec } from '../utils/yt-dlp.js';
import { fetchIsFollowing } from '../utils/ig-authed.js';
import {
  invalidateIgSession, writeIgCookieFile, igFormatsFromYtDlp,
  extractIgShortcode, extractIgUsernameFromUrl,
  checkIsPrivateWeb, fetchIgMediaSlides, fetchIgMediaImageUrl,
  fetchIgMediaInfo,
} from '../utils/ig.js';

export default defineEventHandler(async (event) => {
  const rawUrl = getQuery(event).url;
  if (!rawUrl || typeof rawUrl !== 'string' || !/^https?:\/\/(www\.)?instagr(am\.com|\.am)\//i.test(rawUrl)) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid Instagram post or reel URL.' };
  }
  const code = extractIgShortcode(rawUrl);
  if (!code) {
    setResponseStatus(event, 400);
    return { error: 'Could not find a post or reel ID in that URL.' };
  }

  const urlOwner = extractIgUsernameFromUrl(rawUrl);
  if (IG_SID() && urlOwner) {
    try {
      const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(urlOwner)}/`);
      if (pageRes.status === 200) {
        const html = pageRes.body;
        const userIdMatch = html.match(/"user_id":"(\d+)"/);
        const looksPrivate = /"is_private"\s*:\s*true/.test(html);
        if (userIdMatch) {
          let isPrivate = looksPrivate;
          if (!isPrivate) {
            const apiPriv = await checkIsPrivateWeb(urlOwner);
            if (apiPriv === true) isPrivate = true;
          }
          if (isPrivate) {
            const isFollowing = await fetchIsFollowing(userIdMatch[1]);
            if (!isFollowing) {
              setResponseStatus(event, 403);
              return {
                error: 'This post is from a private account you don\'t follow. Follow them on Instagram, then try again.',
                private: true,
              };
            }
          }
        }
      }
    } catch (_) { /* fall through to yt-dlp */ }
  }

  // yt-dlp normalizes /reel/ → /p/ internally, so /p/<code>/ works for both.
  const url = `https://www.instagram.com/p/${code}/`;
  const baseArgs = () => [
    '--dump-single-json',
    '--no-warnings',
    '--no-check-certificate',
    '--no-playlist',
    '--user-agent', UA_DESKTOP_124,
  ];

  // Try anonymously first; retry with cookies only when IG explicitly
  // demands auth. Public-content path works for logged-out users this way.
  async function fetchInfo() {
    try {
      const args = [...baseArgs(), url];
      const { stdout } = await ytExec(args);
      return { info: JSON.parse(stdout), authed: false };
    } catch (err) {
      const msg = (err.stderr || err.message || '').toString();
      const needsAuth = /login.required|requires login|login_required|rate.limit/i.test(msg);
      if (!needsAuth) throw err;
      if (IG_SID()) {
        const cookieFile = writeIgCookieFile();
        if (cookieFile) {
          const args = [...baseArgs(), '--cookies', cookieFile, url];
          const { stdout } = await ytExec(args);
          return { info: JSON.parse(stdout), authed: true };
        }
      }
      // No session, or cookie write failed. Throw a sentinel — the caller
      // will try the mobile media-info API before giving up.
      const e = new Error('login_required');
      e.code = 'LOGIN_REQUIRED';
      throw e;
    }
  }

  // Build a response from the IG mobile media-info API (no yt-dlp). This
  // endpoint is more permissive than yt-dlp's web scrape — public posts
  // that hit a login wall via yt-dlp often still return here. Used as the
  // anonymous fallback when yt-dlp says "login required" but there's no
  // session to retry with.
  function buildResponseFromMobileApi(item, urlAuthor) {
    if (!item) return null;
    const isVideo = item.media_type === 2 || (Array.isArray(item.video_versions) && item.video_versions.length);
    const author = urlAuthor || item.user?.username || '';
    const description = (item.caption?.text || '').trim();
    const cover = item.image_versions2?.candidates?.[0]?.url
               || item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url
               || '';
    if (isVideo) {
      const versions = (item.video_versions || []).slice().sort((a, b) => (b.height || 0) - (a.height || 0));
      const best = versions[0];
      if (!best?.url) return null;
      return {
        mediaType: 'video',
        author, description, cover,
        downloadUrl: best.url,
        width: best.width || item.original_width || 0,
        height: best.height || item.original_height || 0,
        duration: Number(item.video_duration) || 0,
        sizeBytes: 0,
      };
    }
    const candidates = item.image_versions2?.candidates;
    if (Array.isArray(candidates) && candidates.length) {
      const best = [...candidates].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
      return {
        mediaType: 'image',
        author, description, cover: best.url,
        downloadUrl: best.url,
        width: best.width || 0,
        height: best.height || 0,
      };
    }
    return null;
  }

  try {
    const t0 = Date.now();
    const { info, authed } = await fetchInfo();
    console.log(`[ig-post] ${code} ok in ${Date.now() - t0}ms (authed=${authed})`);

    // Carousels: yt-dlp emits entries[] for video-bearing carousels but
    // does NOT for image-only ones. Run the IG mobile media-info API for
    // every post — it's authoritative for carousel_media[] regardless of
    // media type and gives us the full slide list.
    let item = info;
    if (Array.isArray(info.entries) && info.entries.length) {
      item = info.entries[0];
    }
    const slides = await fetchIgMediaSlides(code);
    const isCarousel = !!(slides && slides.length > 1)
      || (Array.isArray(info.entries) && info.entries.length > 1);
    console.log(`[ig-post] ${code} carousel=${isCarousel} slides=${slides ? slides.length : 'null'} entries=${info.entries ? info.entries.length : 'none'}`);

    const versions = igFormatsFromYtDlp(item);
    const isVideo = versions.length > 0 || (item.vcodec && item.vcodec !== 'none');
    const top = versions[0] || null;

    // Prefer the username straight from the URL — yt-dlp on anonymous
    // fetches can return a numeric IG ID for uploader_id, which makes
    // for ugly filenames. yt-dlp's value is only used as a fallback.
    const urlAuthor = extractIgUsernameFromUrl(rawUrl);
    const ytAuthor = item.uploader_id
      || item.uploader
      || info.uploader_id
      || info.uploader
      || '';
    const author = urlAuthor || ytAuthor || '';
    const description = (item.description || info.description || item.title || '').trim();
    const cover = item.thumbnail || item.display_url || (item.thumbnails && item.thumbnails.slice(-1)[0]?.url) || '';

    if (isVideo && top) {
      return {
        id: code,
        mediaType: 'video',
        author,
        description,
        cover,
        downloadUrl: top.url,
        width: top.width || 0,
        height: top.height || 0,
        duration: Number(item.duration) || 0,
        sizeBytes: Number(item.filesize || item.filesize_approx) || 0,
        carousel: isCarousel,
        slides,
      };
    }

    // Image post — yt-dlp may return display_url / thumbnail as the
    // highest-res rendition; use whichever is largest if multiple
    // thumbnails exist.
    let imageUrl = item.display_url || item.url || cover;
    if (!imageUrl && Array.isArray(item.thumbnails) && item.thumbnails.length) {
      imageUrl = item.thumbnails[item.thumbnails.length - 1].url;
    }
    // Fallback 1: scrape og:image (or og:image:secure_url) from the post
    // HTML. Match either attribute order — IG sometimes ships content=""
    // before property="" depending on the rendering path.
    if (!imageUrl) {
      try {
        const headers = {
          'User-Agent': UA_DESKTOP_124,
          'Accept-Language': 'en-US,en;q=0.9',
        };
        if (IG_SID()) {
          headers['Cookie'] = IG_COOKIE();
        }
        const r = await httpsGet(rawUrl, headers);
        if (r.status === 200) {
          const og = r.body.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
                  || r.body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
          if (og) imageUrl = decodeHtmlEntities(og[1]);
        }
      } catch (_) { /* ignore */ }
    }
    // Fallback 2: IG's mobile media-info API. Authoritative for
    // image_versions2, works for any public post and private posts the
    // session can see.
    if (!imageUrl) {
      const apiUrl = await fetchIgMediaImageUrl(code);
      if (apiUrl) imageUrl = apiUrl;
    }
    if (!imageUrl) {
      console.warn(`[ig-post] no image URL for ${code} after yt-dlp + og:image + media/info fallbacks`);
      setResponseStatus(event, 502);
      return { error: 'Could not extract media URL from post.' };
    }
    return {
      id: code,
      mediaType: 'image',
      author,
      description,
      cover: imageUrl,
      downloadUrl: imageUrl,
      width: item.width || 0,
      height: item.height || 0,
      carousel: isCarousel,
      slides,
    };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[ig-post]', err.code === 'LOGIN_REQUIRED' ? 'login required' : msg.slice(0, 400));
    if (err.code === 'LOGIN_REQUIRED') {
      // Before giving up, try the mobile media-info API. It's more
      // permissive than yt-dlp's web path and routinely serves public
      // posts/reels that yt-dlp can't see anonymously.
      try {
        const item = await fetchIgMediaInfo(code);
        if (item) {
          const urlAuthor = extractIgUsernameFromUrl(rawUrl) || '';
          const partial = buildResponseFromMobileApi(item, urlAuthor);
          if (partial) {
            const slides = await fetchIgMediaSlides(code);
            const isCarousel = !!(slides && slides.length > 1);
            console.log(`[ig-post] ${code} ok via mobile-api fallback (${partial.mediaType})`);
            return { id: code, ...partial, carousel: isCarousel, slides };
          }
        }
      } catch (fallbackErr) {
        console.warn(`[ig-post] mobile-api fallback failed for ${code}: ${fallbackErr.message}`);
      }
      setResponseStatus(event, 401);
      return {
        error: 'Instagram requires login to access this post. Sign in via Logged-in Sessions and try again.',
        loggedOut: true,
      };
    }
    if (/private|restricted|not\s*available|empty\s*media/i.test(msg)) {
      setResponseStatus(event, 403);
      return {
        error: 'This post is from a private account you don\'t follow. Follow them on Instagram, then try again.',
        private: true,
      };
    }
    if (/login.required|requires login|login_required|session/i.test(msg)) {
      invalidateIgSession('ig-post login required');
      setResponseStatus(event, 401);
      return { error: 'Session expired.', loggedOut: true };
    }
    if (/not.found|removed|deleted|404|410/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'Post unavailable (removed or deleted).' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch post.' };
  }
});
