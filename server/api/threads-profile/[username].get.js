// GET /api/threads-profile/:username — Threads profile.
//
// Threads serves a JS-only SPA shell to regular browsers — only the
// facebookexternalhit crawler UA gets the full HTML with og tags. We use
// the default UA from httpsGet (which is already facebookexternalhit) and
// ALWAYS also fall through to Instagram to get a reliable HD pic, since:
//   1. Threads accounts share their numeric pk_id with the linked IG account
//   2. The username is identical on both for ~all users
//   3. The IG authed endpoint reliably returns HD profile pics
// So IG is the canonical HD source; Threads is just used for Threads-specific
// stats (Threads count, Threads follower count).
import { httpsGet } from '../../utils/http.js';
import { decodeHtmlEntities } from '../../utils/util.js';
import { fetchUserInfoAuthed } from '../../utils/ig-authed.js';
import { IG_SID } from '../../utils/session.js';

export default defineEventHandler(async (event) => {
  const username = (getRouterParam(event, 'username') || '').replace(/^@/, '');

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
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }

    // ---- Step 3: HD upgrade via IG authed API ----
    if (userId && IG_SID()) {
      const authed = await fetchUserInfoAuthed(userId);
      if (authed) {
        return {
          username,
          full_name: authed.full_name || fullName,
          profile_pic_url: authed.profile_pic_url,
          followers: followers || authed.followers,
          following: following || authed.following,
          posts: threadsCount || null,
        };
      }
    }

    return {
      username,
      full_name: fullName,
      profile_pic_url: profilePicUrl,
      followers,
      following,
      posts: threadsCount,
    };
  } catch (err) {
    console.error(err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch profile' };
  }
});
