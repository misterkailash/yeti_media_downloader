// GET /api/ig-posts/:username?max_id=<cursor> — Instagram profile feed.
//
// Three-stage privacy decision:
//   1. With a session, /users/<id>/info/ is authoritative.
//   2. Without one (or if that returned null), check the inline HTML for
//      `"is_private":true`, then fall back to /web_profile_info/.
//   3. If private + no session, return locked immediately.
//
// Authenticated requests use the IG mobile feed. The feed itself decides
// whether we get items (followers do; non-followers get an empty list),
// so empty+private requires a /friendships/show/ disambiguation — empty
// from a non-follower means "locked", empty from a follower means "they
// posted nothing".
//
// Falls through to parsing the public profile HTML's sharedData blob when
// there's no session (legacy path; modern IG strips this on most UAs).
import { httpsGet } from '../../utils/http.js';
import { IG_SID } from '../../utils/session.js';
import { fetchIsPrivateAuthed, fetchUserBasics, fetchIsFollowing } from '../../utils/ig-authed.js';
import {
  invalidateIgSession, checkIsPrivateWeb,
  fetchIgPostsAuthed, parseIgPostsFromHtml,
} from '../../utils/ig.js';

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, 'username');
  const maxId = getQuery(event).max_id || null;

  try {
    const pageRes = await httpsGet(`https://www.instagram.com/${encodeURIComponent(username)}/`);
    if (pageRes.status !== 200) {
      setResponseStatus(event, pageRes.status);
      return { error: `Instagram returned ${pageRes.status}` };
    }
    const html = pageRes.body;
    const userIdMatch = html.match(/"user_id":"(\d+)"/);
    if (!userIdMatch) {
      setResponseStatus(event, 404);
      return { error: 'Could not find user ID' };
    }
    const userId = userIdMatch[1];

    // is_private detection. Skip on paginated requests since the first
    // page already decided access.
    let isPrivate = false;
    if (!maxId) {
      if (IG_SID()) {
        const auth = await fetchIsPrivateAuthed(userId);
        if (auth !== null) isPrivate = auth;
      }
      if (!isPrivate) {
        if (/"is_private"\s*:\s*true/.test(html)) {
          isPrivate = true;
        } else {
          const apiPriv = await checkIsPrivateWeb(username);
          if (apiPriv === true) isPrivate = true;
        }
      }
    }
    console.log(`[ig-posts] @${username} userId=${userId} isPrivate=${isPrivate} session=${!!IG_SID()}`);

    if (isPrivate && !IG_SID()) {
      console.log(`[ig-posts] @${username} → locked (private, no session)`);
      return { posts: [], private: true, next_max_id: null };
    }

    if (IG_SID()) {
      const result = await fetchIgPostsAuthed(userId, maxId);
      if (result) {
        if (result.expired) {
          invalidateIgSession('ig-posts auth-fail');
          setResponseStatus(event, 401);
          return { error: 'Session expired.', loggedOut: true };
        }
        if (result.challenge) {
          setResponseStatus(event, 401);
          return {
            error: 'Instagram requires verification for this login.',
            challengeRequired: true,
            challengeUrl: result.challengeUrl || null,
          };
        }
        // Empty feed + session: disambiguate "private, you don't follow"
        // (show locked panel) from "they posted nothing" (empty grid) and
        // from "we follow them, IG just didn't return items right now".
        // /users/<id>/info/ gives us is_private + media_count in one call;
        // when media_count is 0, the account literally has no posts to
        // show regardless of follow state, so we should never lock. Only
        // lock when we know there ARE posts AND the account is private
        // AND friendship returned a confirmed-false. Skipped on paginated
        // requests — first page already settled access.
        const empty = !result.posts || result.posts.length === 0;
        if (empty && !maxId) {
          const basics = await fetchUserBasics(userId);
          const confirmedPrivate = (basics && basics.isPrivate)
            || isPrivate
            || !!result.private;
          const mediaCount = basics ? basics.mediaCount : -1;

          if (mediaCount === 0) {
            console.log(`[ig-posts] @${username} → empty (media_count=0)`);
            return { posts: [], next_max_id: null };
          }
          if (confirmedPrivate) {
            const isFollowing = await fetchIsFollowing(userId);
            console.log(`[ig-posts] @${username} private+empty → following=${isFollowing} media=${mediaCount}`);
            if (!isFollowing) {
              return { posts: [], private: true, next_max_id: null };
            }
            return { posts: [], next_max_id: null };
          }
        }
        return { posts: result.posts, next_max_id: result.nextMaxId || null };
      }
    }

    // Legacy public _sharedData scrape. Modern IG strips this for most
    // UAs, so usually returns []. When empty AND we have no session,
    // treat as locked — either the account is private or IG is blocking
    // us anonymously, and the user's path forward is the same (sign in).
    // When we DO have a session but the authed feed returned null (above
    // `if (result)` was false), don't lie about privacy — just return
    // empty so the frontend shows "No posts found" rather than a
    // misleading lock screen for an account they may follow.
    const posts = parseIgPostsFromHtml(html);
    if (posts.length === 0 && !IG_SID()) {
      console.log(`[ig-posts] @${username} → locked (anonymous, empty)`);
      return { posts: [], private: true, next_max_id: null };
    }
    return { posts, next_max_id: null };
  } catch (err) {
    console.error(err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch posts' };
  }
});
