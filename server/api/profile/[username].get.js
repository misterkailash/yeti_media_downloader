// GET /api/profile/:username — Instagram profile.
//
// Three-stage:
//   1. Scrape www.instagram.com/<username>/ for og:image/title/description
//      and the embedded user_id (works without a session).
//   2. If the HTML is a sparse shell with no og:image (intermittent IG
//      behaviour — sometimes the first response strips them), fall back
//      to /web_profile_info/ which is the authoritative web user object.
//   3. If a sessionid is loaded into the per-browser session, upgrade to
//      the authed i.instagram.com/api/v1/users/<id>/info/ for HD pic + exact
//      stats. Falls back to og/web_profile_info data when the authed call fails.
import { httpsGet } from '../../utils/http.js';
import { decodeHtmlEntities, parseOgDescription, formatCount } from '../../utils/util.js';
import { fetchUserInfoAuthed, fetchUserPicViaFeed, fetchUserFullDetail } from '../../utils/ig-authed.js';
import { fetchIgWebProfileInfo, fetchIgPolarisProfile } from '../../utils/ig.js';
import { IG_SID } from '../../utils/session.js';

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, 'username');

  try {
    // Retry the HTML fetch once on a sparse shell — IG sometimes serves
    // a stripped 200 on the first hit (anti-bot heuristic) and a normal
    // page on the retry. Avoids "User not found" flickers on real users.
    let pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    let html = pageRes.body || '';
    if (pageRes.status === 200 && !html.includes('<title>Page Not Found') && !/og:image"/.test(html)) {
      await new Promise(r => setTimeout(r, 500));
      const retry = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
      if (retry.status === 200 && /og:image"/.test(retry.body || '')) {
        pageRes = retry;
        html = retry.body;
      }
    }

    if (pageRes.status !== 200) {
      setResponseStatus(event, pageRes.status);
      return { error: `Instagram returned ${pageRes.status}` };
    }

    if (html.includes('<title>Page Not Found')) {
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }

    const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
    const ogDescMatch = html.match(/og:description"[^>]*content="([^"]+)"/);
    const userIdMatch = html.match(/"user_id":"(\d+)"/);

    if (!ogImageMatch) {
      // HTML lacked og:image even after retry — fall back to web_profile_info
      // for the user object. With a session this is very reliable; anonymous
      // it usually works too. If it fails as well, we genuinely have no data.
      const web = await fetchIgWebProfileInfo(username);
      if (web) {
        const userId = web.id || (userIdMatch && userIdMatch[1]);
        if (userId && IG_SID()) {
          const authed = await fetchUserInfoAuthed(userId);
          if (authed) return { username, ...authed };
        }
        return {
          username,
          full_name: web.full_name || '',
          profile_pic_url: web.profile_pic_url_hd || web.profile_pic_url || '',
          followers: formatCount(web.edge_followed_by?.count),
          following: formatCount(web.edge_follow?.count),
          posts: formatCount(web.edge_owner_to_timeline_media?.count),
        };
      }
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }

    const profilePicUrl = decodeHtmlEntities(ogImageMatch[1]);

    // Parse name from og:title: "Cristiano Ronaldo (@cristiano) • Instagram photos and videos"
    let fullName = '';
    if (ogTitleMatch) {
      const title = decodeHtmlEntities(ogTitleMatch[1]);
      const nameMatch = title.match(/^(.+?)\s*\(@/);
      fullName = nameMatch ? nameMatch[1].trim() : title.split('•')[0].trim();
    }

    let stats = {};
    if (ogDescMatch) {
      stats = parseOgDescription(decodeHtmlEntities(ogDescMatch[1]));
    }

    // HD-pic fallback chain. IG has multiple endpoints that surface the
    // hd_profile_pic_url_info blob, but each can return empty / 429 / 401
    // independently — and the failure modes don't correlate, so we walk
    // through every source in order of "richness" before giving up on HD.
    //
    // Order is: most-comprehensive (users/info) → mobile-app endpoint
    // (full_detail_info) → web endpoint (web_profile_info) → mini-user
    // from the feed (small pic, accept only if marked HD). Falls through
    // to the 100×100 og:image thumbnail only when all four fail.
    const hdSources = [];
    if (IG_SID()) {
      // Polaris GraphQL — IG's web-app backend. Returns the full-resolution
      // profile pic (no `stp=dst-jpg_sNxN` transform). This is what
      // save-free.com etc. use; works even when the mobile users/info
      // endpoint shadow-bans the lookup.
      hdSources.push({
        name: 'polaris',
        run: async () => {
          const u = await fetchIgPolarisProfile(username);
          if (!u) return null;
          const pic = u.hd_profile_pic_url_info?.url
                   || u.profile_pic_url_hd
                   || u.profile_pic_url;
          if (!pic) return null;
          const w = u.hd_profile_pic_url_info?.width || 0;
          return {
            full_name: u.full_name || '',
            profile_pic_url: pic,
            pic_width: w || (u.hd_profile_pic_url_info ? 320 : 0),
            followers: formatCount(u.edge_followed_by?.count ?? u.follower_count),
            following: formatCount(u.edge_follow?.count ?? u.following_count),
            posts: formatCount(u.edge_owner_to_timeline_media?.count ?? u.media_count),
          };
        },
        requireHd: false,
      });
    }
    if (userIdMatch && IG_SID()) {
      hdSources.push({
        name: 'users/info',
        run: () => fetchUserInfoAuthed(userIdMatch[1]),
        requireHd: false,
      });
      hdSources.push({
        name: 'full_detail_info',
        run: () => fetchUserFullDetail(userIdMatch[1]),
        requireHd: false,
      });
    }
    if (IG_SID()) {
      hdSources.push({
        name: 'web_profile_info',
        run: async () => {
          const web = await fetchIgWebProfileInfo(username);
          if (!web) return null;
          const pic = web.profile_pic_url_hd || web.profile_pic_url;
          if (!pic) return null;
          return {
            full_name: web.full_name || '',
            profile_pic_url: pic,
            pic_width: web.profile_pic_url_hd ? 320 : 0,
            followers: formatCount(web.edge_followed_by?.count),
            following: formatCount(web.edge_follow?.count),
            posts: formatCount(web.edge_owner_to_timeline_media?.count),
          };
        },
        requireHd: false,
      });
    }
    if (userIdMatch && IG_SID()) {
      hdSources.push({
        name: 'feed/user',
        run: () => fetchUserPicViaFeed(userIdMatch[1]),
        // feed/user usually only carries the s150 mini pic — that's no
        // upgrade over the og:image, so only accept it when it actually
        // came back with an HD candidate.
        requireHd: true,
      });
    }

    for (const src of hdSources) {
      const result = await src.run();
      console.log(`[profile:${username}] ${src.name} → ${result ? `pic ${result.pic_width || '?'}px` : 'null'}`);
      if (!result) continue;
      if (src.requireHd && !(result.pic_width >= 320)) continue;
      return {
        username,
        full_name: result.full_name || fullName,
        profile_pic_url: result.profile_pic_url,
        pic_width: result.pic_width,
        followers: result.followers || stats.followers || null,
        following: result.following || stats.following || null,
        posts: result.posts || stats.posts || null,
      };
    }

    console.log(`[profile:${username}] falling back to og:image (likely 100x100 thumbnail)`);
    return {
      username,
      full_name: fullName,
      profile_pic_url: profilePicUrl,
      followers: stats.followers || null,
      following: stats.following || null,
      posts: stats.posts || null,
    };
  } catch (err) {
    console.error(err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch profile' };
  }
});
