// Instagram shared infrastructure — constants, challenge/session helpers,
// user-id resolution, video-version dedup. Used by:
//   - server/api/ig-stories/[username].get.js
//   - server/api/ig-highlights/[username].get.js
//   - server/api/ig-highlight/[highlightId].get.js
//   - server.js's remaining IG endpoints (login, post-versions, post, etc.)
//
// Separate from lib/ig-authed.js (which is only the three i.instagram.com
// user-info lookups) because the helpers here are more broadly used and
// not just about the authed-fetch pattern.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { httpsGet } = require('./http');
const { UA_DESKTOP_121, UA_INSTAGRAM_ANDROID } = require('./ua');
const { getIg, setIg, IG_SID, IG_DS_ID, IG_COOKIE } = require('./session');

const IG_APP_ID = '567067343352427';
// The /web/ web app id differs from the mobile app id. Used by
// web_profile_info and other public-web endpoints.
const IG_WEB_APP_ID = '936619743392459';

// Pulls challenge URL out of an IG mobile-API error response. The response
// shape is `{ "message": "challenge_required", "challenge": { "url": "..." } }`
// when IG decides the saved session needs a security check. Returning
// { required, url } lets callers surface a clear "log into instagram.com
// in your browser to complete verification" message.
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

// Clears the calling browser's IG credentials. Called when upstream IG
// endpoints return 401/403/checkpoint — the saved session is dead, so we
// drop it from this browser's session record. Other browsers' sessions
// are unaffected. Returns true if creds were present before the call.
function invalidateIgSession(reason) {
  if (!getIg()) return false;
  setIg(null);
  console.log(`[auth] IG session invalidated (${reason || 'unspecified'})`);
  return true;
}

// Scrapes the public profile page for the numeric user_id. Works without
// a session for public accounts. Returns null on 404 or if the user_id
// regex doesn't match (e.g. IG rotated the embedded-JSON schema again).
async function resolveUserId(username) {
  const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
  if (pageRes.status !== 200) return null;
  const m = pageRes.body.match(/"user_id":"(\d+)"/);
  return m ? m[1] : null;
}

// IG's `video_versions` array is the authoritative quality list — each
// entry has {url, width, height, type}. We sort by height desc, drop
// duplicate heights (keeping the first occurrence, which is typically the
// highest-bitrate variant per height), and return the same shape the
// frontend uses for FB/YouTube quality pickers.
function igVideoVersions(versions) {
  if (!Array.isArray(versions) || !versions.length) return [];
  const seen = new Set();
  const out = versions
    .filter(v => v && v.url)
    .slice()
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .filter(v => {
      const h = v.height || 0;
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    })
    .map(v => ({ url: v.url, width: v.width || 0, height: v.height || 0 }));
  if (out.length) {
    const heights = out.map(v => v.height || '?').join(',');
    console.log(`[ig-video-versions] ${out.length} variant(s): ${heights}`);
  }
  return out;
}

// Standard authed headers for the i.instagram.com mobile API. Pulls
// sessionid + ds_user_id from the current session via the lib/session
// AsyncLocalStorage context.
function igAuthedHeaders() {
  return {
    'User-Agent': UA_INSTAGRAM_ANDROID,
    'x-ig-app-id': IG_APP_ID,
    'Cookie': IG_COOKIE(),
  };
}

// IG dropped the inline `"is_private":true` regex from public profile HTML
// in mid-2024 (graphql JSON was inlined, then removed). web_profile_info
// still returns the flag without a session for public accounts; for
// accounts IG locks behind a session, passing the cookie keeps the 200.
// Returns null on error/non-200 — callers should treat null as "couldn't
// tell" rather than "definitely public".
async function checkIsPrivateWeb(username) {
  const u = await fetchIgWebProfileInfo(username);
  if (!u) return null;
  return !!u.is_private;
}

// Hit IG's GraphQL "polaris" endpoint — the same backend the web app calls
// when you open a profile page. Returns the FULL-resolution profile pic
// (no `stp=dst-jpg_sNxN` size transform), unlike og:image which is hard-
// capped at 100×100. This is the path save-free.com and similar services
// use for HD profile pictures.
//
// The doc_id is IG's internal hash for PolarisProfilePageContentQuery and
// rotates every few months; if the call starts returning errors, find the
// new id by inspecting the network tab on a real instagram.com profile
// load (look for POST to /api/graphql with `fb_api_req_friendly_name=
// PolarisProfilePageContentQuery`).
const POLARIS_DOC_ID = '7898261790222653';

async function fetchIgPolarisProfile(username) {
  if (!IG_SID()) return null;
  const { httpsPost } = require('./http');
  try {
    // Step 1: fetch the profile page WITH cookies to extract the LSD token.
    // GraphQL POSTs without a fresh page-bound LSD get redirected to login,
    // returning HTML instead of JSON. The LSD lives in an inline script as
    // `"LSD",[],{"token":"<24-char>"}`.
    const cookies = IG_COOKIE();
    const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      'User-Agent': UA_DESKTOP_121,
      'Cookie': cookies,
    });
    if (pageRes.status !== 200) {
      console.warn(`[polaris] page fetch ${username} status=${pageRes.status}`);
      return null;
    }
    const lsdMatch = pageRes.body.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const lsd = lsdMatch ? lsdMatch[1] : (csrfMatch ? csrfMatch[1] : 'missing');
    const csrf = csrfMatch ? csrfMatch[1] : 'missing';

    // Step 2: POST the GraphQL query with the page-bound LSD.
    const variables = JSON.stringify({ render_surface: 'PROFILE', username });
    const body = new URLSearchParams({
      variables,
      doc_id: POLARIS_DOC_ID,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisProfilePageContentQuery',
      server_timestamps: 'true',
      lsd,
    }).toString();
    const r = await httpsPost('https://www.instagram.com/api/graphql', body, {
      'User-Agent': UA_DESKTOP_121,
      'X-IG-App-ID': IG_WEB_APP_ID,
      'X-CSRFToken': csrf,
      'X-FB-LSD': lsd,
      'X-FB-Friendly-Name': 'PolarisProfilePageContentQuery',
      'Origin': 'https://www.instagram.com',
      'Referer': `https://www.instagram.com/${username}/`,
      'Cookie': cookies,
      'Accept': '*/*',
      'Sec-Fetch-Site': 'same-origin',
    });
    if (r.status !== 200) {
      console.warn(`[polaris] ${username} status=${r.status}`);
      return null;
    }
    const j = JSON.parse(r.body);
    if (j?.errors) {
      console.warn(`[polaris] ${username} graphql errors: ${JSON.stringify(j.errors).slice(0, 200)}`);
      return null;
    }
    const u = j?.data?.user;
    if (!u) {
      console.warn(`[polaris] ${username} returned no user object (lsd=${lsd === 'missing' ? 'missing' : 'set'}, body=${r.body.slice(0, 200)})`);
      return null;
    }
    return u;
  } catch (e) {
    console.warn(`[polaris] ${username} error: ${e.message}`);
    return null;
  }
}

// Full user object from /web_profile_info/ — used as a fallback when the
// HTML scrape returns a sparse shell with no og:image. Returns the
// j.data.user object verbatim (full_name, profile_pic_url_hd, is_private,
// edge_followed_by, edge_follow, edge_owner_to_timeline_media) or null on
// error. With a session this endpoint is very reliable; anonymously it
// works for most accounts but can be rate-limited.
async function fetchIgWebProfileInfo(username) {
  // Try www.instagram.com first (separate rate-limit bucket from mobile
  // i.instagram.com), then fall back to the i.instagram.com mirror.
  const hosts = ['www.instagram.com', 'i.instagram.com'];
  for (const host of hosts) {
    try {
      const headers = {
        'User-Agent': UA_DESKTOP_121,
        'x-ig-app-id': IG_WEB_APP_ID,
        'Accept': '*/*',
        'Referer': `https://www.instagram.com/${username}/`,
      };
      if (IG_SID()) {
        headers['Cookie'] = IG_COOKIE();
      }
      const r = await httpsGet(`https://${host}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, headers);
      if (r.status !== 200) {
        console.warn(`[web_profile_info] ${host}/${username} status=${r.status}`);
        continue;
      }
      const j = JSON.parse(r.body);
      const u = j?.data?.user;
      if (!u) {
        console.warn(`[web_profile_info] ${host}/${username} returned no user object`);
        continue;
      }
      return u;
    } catch (e) {
      console.warn(`[web_profile_info] ${host}/${username} error: ${e.message}`);
    }
  }
  return null;
}

// Authed pull of /feed/user/<id>/ — the mobile profile-feed endpoint that
// powers the IG mobile-app "Posts" tab. Returns:
//   { expired: true }                             — 401/403 from upstream
//   { challenge: true, challengeUrl }             — `challenge_required` body
//   { private: true, posts: [] }                  — locked private, no access
//   { private: false, posts, nextMaxId }          — normal success
//   null                                          — transient failure
async function fetchIgPostsAuthed(userId, maxId, _retried = false) {
  if (!IG_SID()) return null;
  try {
    let feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=30`;
    if (maxId) feedUrl += `&max_id=${maxId}`;
    const r = await httpsGet(feedUrl, {
      'User-Agent': UA_INSTAGRAM_ANDROID,
      'x-ig-app-id': IG_APP_ID,
      'Cookie': IG_COOKIE(),
      'Accept-Language': 'en-US',
    });
    if (r.status !== 200) {
      console.warn(`[ig-posts] feed status ${r.status}`);
      if (r.status === 401 || r.status === 403) return { expired: true };
      const ch = parseIgChallenge(r.body);
      if (ch.required) return { challenge: true, challengeUrl: ch.url };
      // Retry once on 5xx / transient failures before giving up.
      if (!_retried && r.status >= 500) {
        await new Promise(res => setTimeout(res, 700));
        return fetchIgPostsAuthed(userId, maxId, true);
      }
      return null;
    }
    const j = JSON.parse(r.body);

    // Private account: API returns status 'ok' but no items or num_results=0
    if (j.user && j.user.is_private && (!j.items || j.items.length === 0)) {
      return { private: true, posts: [] };
    }
    // Empty items but the account isn't flagged private — could be a real
    // empty profile, or IG returned a hiccuped response. Retry once before
    // believing the empty. Only on the first page; pagination cursors are
    // expected to legitimately empty out.
    const hasItems = j.items && Array.isArray(j.items) && j.items.length > 0;
    if (!hasItems && !maxId && !_retried) {
      console.warn(`[ig-posts] empty feed for ${userId}, retrying once`);
      await new Promise(res => setTimeout(res, 800));
      return fetchIgPostsAuthed(userId, maxId, true);
    }
    if (!j.items || !Array.isArray(j.items)) return null;

    const posts = j.items.map(item => {
      const isVideo = item.media_type === 2 || item.video_versions;
      const isCarousel = item.media_type === 8 || item.carousel_media;
      const isReel = !!(item.clips_metadata || (item.product_type === 'clips'));

      let thumbnail = null;
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length) {
        thumbnail = item.image_versions2.candidates[0].url;
      } else if (item.carousel_media && item.carousel_media[0] && item.carousel_media[0].image_versions2) {
        thumbnail = item.carousel_media[0].image_versions2.candidates[0].url;
      }

      let videoUrl = null;
      let videoVersions = [];
      if (isVideo && item.video_versions && item.video_versions.length) {
        videoVersions = igVideoVersions(item.video_versions);
        videoUrl = videoVersions[0]?.url || item.video_versions[0].url;
      }

      let carouselItems = null;
      if (isCarousel && item.carousel_media) {
        carouselItems = item.carousel_media.map(cm => {
          const cmIsVideo = cm.media_type === 2 || cm.video_versions;
          let cmThumb = null;
          if (cm.image_versions2 && cm.image_versions2.candidates && cm.image_versions2.candidates.length) {
            cmThumb = cm.image_versions2.candidates[0].url;
          }
          let cmVideo = null;
          let cmVideoVersions = [];
          if (cmIsVideo && cm.video_versions && cm.video_versions.length) {
            cmVideoVersions = igVideoVersions(cm.video_versions);
            cmVideo = cmVideoVersions[0]?.url || cm.video_versions[0].url;
          }
          return {
            type: cmIsVideo ? 'video' : 'image',
            url: cmThumb,
            videoUrl: cmVideo,
            videoVersions: cmVideoVersions,
          };
        });
      }

      return {
        id: item.pk || item.id,
        code: item.code,
        type: isReel ? 'reel' : isCarousel ? 'carousel' : isVideo ? 'video' : 'image',
        thumbnail,
        videoUrl,
        videoVersions,
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

// Legacy unauthenticated fallback — pulls posts from the `window._sharedData`
// blob that older IG profile pages still serve under some UAs. Returns an
// empty array if the blob isn't present (the modern shell strips it).
function parseIgPostsFromHtml(html) {
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
            videoVersions: node.video_url ? [{ url: node.video_url, width: 0, height: 0 }] : [],
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

// Writes a Netscape-format cookie file yt-dlp can consume. The filename
// includes a session-derived hash so concurrent IG sessions in the same
// process don't clobber each other's cookies (previously every session
// shared yeti_ig_cookies_${pid}.txt, so two simultaneous users would
// race to write — the loser's yt-dlp would run with the wrong cookies).
// The path is stashed on the session record so the session sweep in
// lib/session.js can unlink it on eviction.
function writeIgCookieFile() {
  if (!IG_SID()) return null;
  const ig = getIg();
  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 365;
  const lines = [
    '# Netscape HTTP Cookie File',
    `.instagram.com\tTRUE\t/\tTRUE\t${expiresAt}\tsessionid\t${IG_SID()}`,
  ];
  if (IG_DS_ID()) {
    lines.push(`.instagram.com\tTRUE\t/\tTRUE\t${expiresAt}\tds_user_id\t${IG_DS_ID()}`);
  }
  const hash = crypto.createHash('sha256').update(IG_SID()).digest('hex').slice(0, 16);
  const file = path.join(os.tmpdir(), `yeti_ig_cookies_${process.pid}_${hash}.txt`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  if (ig) ig.cookieFile = file;
  return file;
}

// Map yt-dlp's formats[] for an IG video into our {url,width,height} list,
// dedup'd by height with the highest tbr per height kept. We prefer formats
// that carry both video AND audio in a single stream — IG sometimes serves
// DASH-style streams where the highest-quality video has no audio, and
// picking those produces a silent download.
function igFormatsFromYtDlp(info) {
  if (!info) return [];
  const haveVideo = (info.formats || []).filter(f => f.url && f.vcodec && f.vcodec !== 'none' && f.height);
  if (!haveVideo.length) {
    return info.url && info.height
      ? [{ url: info.url, width: info.width || 0, height: info.height || 0 }]
      : [];
  }
  const withAudio = haveVideo.filter(f => f.acodec && f.acodec !== 'none');
  const fmts = withAudio.length ? withAudio : haveVideo;
  const byHeight = new Map();
  for (const f of fmts) {
    const tbr = Number(f.tbr) || 0;
    const prev = byHeight.get(f.height);
    if (!prev || tbr > (Number(prev.tbr) || 0)) byHeight.set(f.height, f);
  }
  return [...byHeight.values()]
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .map(f => ({ url: f.url, width: f.width || 0, height: f.height || 0 }));
}

// Matches /p/<code>/, /reel/<code>/, /reels/<code>/, /tv/<code>/ — optionally
// preceded by /<username>. Codes are 3–50 chars of letters/digits/_/-.
function extractIgShortcode(url) {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{3,50})/i);
  return m ? m[1] : null;
}

// /<username>/(p|reel|tv)/<code>/ — used as a fallback when yt-dlp's
// anonymous fetch doesn't surface uploader_id, so the saved file still
// carries the user.
function extractIgUsernameFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|reels|tv)\//i);
  return m ? m[1] : null;
}

// IG shortcodes are base64-url encoded media IDs. The reverse mapping is
// the only way to look up a post via the mobile API (`/media/<id>/info/`),
// which is the authoritative source for image_versions2[] when yt-dlp +
// og:image scrape both come up empty.
function igShortcodeToMediaId(shortcode) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  if (!shortcode || /[^A-Za-z0-9_-]/.test(shortcode)) return null;
  let id = 0n;
  for (const c of shortcode) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

// Picks the highest-area image URL out of image_versions2.candidates for a
// single carousel/post item.
function bestImageFromIgItem(media) {
  const candidates = media?.image_versions2?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const best = [...candidates].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  return { url: best.url, width: best.width || 0, height: best.height || 0 };
}

// Walk a single IG media item (post or carousel slide) → {mediaType,url,...}.
function buildIgSlide(media) {
  const isVideo = media.media_type === 2 || (Array.isArray(media.video_versions) && media.video_versions.length);
  if (isVideo) {
    const versions = (media.video_versions || []).slice().sort((a, b) => (b.height || 0) - (a.height || 0));
    const best = versions[0];
    return {
      mediaType: 'video',
      url: best?.url || '',
      width: best?.width || media.original_width || 0,
      height: best?.height || media.original_height || 0,
    };
  }
  const img = bestImageFromIgItem(media);
  if (img) return { mediaType: 'image', url: img.url, width: img.width, height: img.height };
  return null;
}

// IG mobile media-info endpoint. Returns ALL slides for a post/reel:
//   - Single post  → 1-element array
//   - Carousel     → N-element array (one per slide, in order)
//   - null if the API doesn't respond or the post isn't viewable.
async function fetchIgMediaSlides(shortcode) {
  const mediaId = igShortcodeToMediaId(shortcode);
  if (!mediaId) return null;
  const headers = {
    'User-Agent': UA_INSTAGRAM_ANDROID,
    'x-ig-app-id': IG_APP_ID,
    'Accept-Language': 'en-US',
  };
  if (IG_SID()) {
    headers['Cookie'] = IG_COOKIE();
  }
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, headers);
    if (r.status !== 200) return null;
    const j = JSON.parse(r.body);
    const item = j?.items?.[0];
    if (!item) return null;
    if (Array.isArray(item.carousel_media) && item.carousel_media.length) {
      return item.carousel_media.map(buildIgSlide).filter(Boolean);
    }
    const single = buildIgSlide(item);
    return single ? [single] : null;
  } catch (_) {
    return null;
  }
}

// Backwards-compat helper used by the og:image / image-fallback path.
async function fetchIgMediaImageUrl(shortcode) {
  const slides = await fetchIgMediaSlides(shortcode);
  if (!slides || !slides.length) return null;
  const firstImage = slides.find(s => s.mediaType === 'image') || slides[0];
  return firstImage.url || null;
}

// Full item from /api/v1/media/<id>/info/. Same endpoint fetchIgMediaSlides
// uses, but returns the raw IG item so callers that need author, caption,
// duration, cover, etc. can build a complete response without yt-dlp.
// Used as the anonymous fallback in /api/ig-post when yt-dlp's web scrape
// hits a login wall but the mobile API still serves the public post.
async function fetchIgMediaInfo(shortcode) {
  const mediaId = igShortcodeToMediaId(shortcode);
  if (!mediaId) return null;
  const headers = {
    'User-Agent': UA_INSTAGRAM_ANDROID,
    'x-ig-app-id': IG_APP_ID,
    'Accept-Language': 'en-US',
  };
  if (IG_SID()) {
    headers['Cookie'] = IG_COOKIE();
  }
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, headers);
    if (r.status !== 200) return null;
    const j = JSON.parse(r.body);
    return j?.items?.[0] || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  IG_APP_ID,
  IG_WEB_APP_ID,
  parseIgChallenge,
  invalidateIgSession,
  resolveUserId,
  igVideoVersions,
  igAuthedHeaders,
  checkIsPrivateWeb,
  fetchIgPolarisProfile,
  fetchIgWebProfileInfo,
  fetchIgPostsAuthed,
  parseIgPostsFromHtml,
  writeIgCookieFile,
  igFormatsFromYtDlp,
  extractIgShortcode,
  extractIgUsernameFromUrl,
  igShortcodeToMediaId,
  bestImageFromIgItem,
  buildIgSlide,
  fetchIgMediaSlides,
  fetchIgMediaImageUrl,
  fetchIgMediaInfo,
};
