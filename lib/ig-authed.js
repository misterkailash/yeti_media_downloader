// Instagram authenticated lookups. These hit i.instagram.com mobile API
// (v1) and require an IG session cookie (sessionid + ds_user_id) loaded
// into the per-browser session via /api/ig-login. Used by:
//   - /api/profile/:username         (HD pic + exact stats)
//   - /api/threads-profile/:username (canonical IG-backed HD pic)
//   - /api/ig-posts, /api/ig-stories, /api/ig-highlights (privacy gate)
//
// All three helpers return null on any failure (including missing session,
// 4xx response, JSON parse errors) so callers can fall through to the
// public/og-tag path without branching on error shape.
const { httpsGet } = require('./http');
const { UA_INSTAGRAM_ANDROID } = require('./ua');
const { formatCount } = require('./util');
const { IG_SID, IG_COOKIE } = require('./session');

const APP_ID = '567067343352427';

function igAuthedHeaders() {
  return {
    'User-Agent': UA_INSTAGRAM_ANDROID,
    'x-ig-app-id': APP_ID,
    'Cookie': IG_COOKIE(),
    'Accept-Language': 'en-US',
  };
}

// Authoritative is_private lookup via /users/<id>/info/. We don't trust
// friendship_status from this endpoint — IG returns it inconsistently — so
// "do I follow this account?" uses fetchIsFollowing instead.
async function fetchIsPrivateAuthed(userId) {
  if (!IG_SID() || !userId) return null;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/users/${userId}/info/`, igAuthedHeaders());
    if (r.status !== 200) {
      console.warn(`[ig-priv] users/info status=${r.status} for ${userId}`);
      return null;
    }
    const j = JSON.parse(r.body);
    if (!j.user || !j.user.pk) return null;
    return !!j.user.is_private;
  } catch (e) {
    console.warn(`[ig-priv] users/info error for ${userId}: ${e.message}`);
    return null;
  }
}

// Authoritative is_private + media_count. Used by the posts endpoint to
// disambiguate "locked because you don't follow" from "they have no posts
// to show". Hitting the same /users/<id>/info/ endpoint as
// fetchIsPrivateAuthed but returning the richer object; kept separate so
// existing call sites that only need the boolean don't have to change.
async function fetchUserBasics(userId) {
  if (!IG_SID() || !userId) return null;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/users/${userId}/info/`, igAuthedHeaders());
    if (r.status !== 200) return null;
    const j = JSON.parse(r.body);
    const u = j.user;
    if (!u || !u.pk) return null;
    return {
      isPrivate: !!u.is_private,
      mediaCount: Number(u.media_count) || 0,
    };
  } catch (_) {
    return null;
  }
}

async function fetchIsFollowing(userId) {
  if (!IG_SID() || !userId) return false;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/friendships/show/${userId}/`, igAuthedHeaders());
    if (r.status !== 200) return false;
    const j = JSON.parse(r.body);
    return !!j.following;
  } catch (_) {
    return false;
  }
}

// HD profile pic + exact stats via i.instagram.com. Returns null on no
// session, 401/403/404, or checkpoint-required. Callers should fall back
// to og-tag scraping when this returns null.
async function fetchUserInfoAuthed(userId) {
  if (!IG_SID()) return null;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/users/${userId}/info/`, igAuthedHeaders());
    if (r.status === 401 || r.status === 403) {
      console.warn(`[auth] sessionid rejected (status ${r.status}) — refresh your cookie`);
      return null;
    }
    if (r.status === 404) return null;
    if (r.status !== 200) {
      console.warn(`[auth] users/info status ${r.status}`);
      return null;
    }
    const j = JSON.parse(r.body);
    if (j.message === 'checkpoint_required') {
      console.warn('[auth] CHECKPOINT REQUIRED — log into instagram.com in your browser, complete the security check, then re-extract a fresh sessionid cookie into .env');
      return null;
    }
    const u = j.user;
    // IG sometimes returns 200 + {"user":{},"status":"ok"} for rate-limited
    // or restricted lookups. `pk` is always present on a real user object,
    // so use its absence to bail out and let the og:image fallback take over.
    if (!u || !u.pk) {
      console.warn(`[auth] users/info ${userId} returned empty user (likely rate-limited or restricted)`);
      return null;
    }

    // IG returns several profile-pic candidates; the *_versions array isn't
    // guaranteed sorted, and hd_profile_pic_url_info isn't always the largest.
    // Walk every option and pick the one with the highest pixel area.
    let bestUrl = null;
    let bestArea = 0;
    const consider = (url, w, h) => {
      if (!url) return;
      const area = (Number(w) || 0) * (Number(h) || 0);
      if (area > bestArea) { bestUrl = url; bestArea = area; }
    };
    if (u.hd_profile_pic_url_info) {
      consider(u.hd_profile_pic_url_info.url, u.hd_profile_pic_url_info.width, u.hd_profile_pic_url_info.height);
    }
    if (Array.isArray(u.hd_profile_pic_versions)) {
      for (const v of u.hd_profile_pic_versions) consider(v.url, v.width, v.height);
    }
    if (!bestUrl) bestUrl = u.profile_pic_url || null;

    return {
      full_name: u.full_name || '',
      profile_pic_url: bestUrl,
      pic_width: bestArea ? Math.round(Math.sqrt(bestArea)) : 0,
      followers: formatCount(u.follower_count),
      following: formatCount(u.following_count),
      posts: formatCount(u.media_count),
    };
  } catch (e) {
    console.warn(`[auth] users/info error: ${e.message}`);
    return null;
  }
}

// Picks the largest profile-pic URL from an IG user object. IG returns
// several pic candidates (hd_profile_pic_url_info, hd_profile_pic_versions,
// profile_pic_url). The *_versions array isn't guaranteed sorted and
// hd_profile_pic_url_info isn't always the largest, so walk every option
// and pick by pixel area.
function bestProfilePic(u) {
  let bestUrl = null;
  let bestArea = 0;
  const consider = (url, w, h) => {
    if (!url) return;
    const area = (Number(w) || 0) * (Number(h) || 0);
    if (area > bestArea) { bestUrl = url; bestArea = area; }
  };
  if (u.hd_profile_pic_url_info) {
    consider(u.hd_profile_pic_url_info.url, u.hd_profile_pic_url_info.width, u.hd_profile_pic_url_info.height);
  }
  if (Array.isArray(u.hd_profile_pic_versions)) {
    for (const v of u.hd_profile_pic_versions) consider(v.url, v.width, v.height);
  }
  if (!bestUrl) bestUrl = u.profile_pic_url || null;
  return { url: bestUrl, width: bestArea ? Math.round(Math.sqrt(bestArea)) : 0 };
}

// Pulls the embedded user object out of /feed/user/<id>/. IG's mobile feed
// endpoint inlines a "mini" user blob — usually only profile_pic_url (the
// small version), no hd_*. Useful as a stat fallback but rarely upgrades
// quality. Returns null if no usable pic.
async function fetchUserPicViaFeed(userId) {
  if (!IG_SID() || !userId) return null;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/feed/user/${userId}/?count=1`, igAuthedHeaders());
    if (r.status !== 200) {
      console.warn(`[auth] feed/user ${userId} status=${r.status}`);
      return null;
    }
    const j = JSON.parse(r.body);
    const u = j.user;
    if (!u || !u.pk) {
      console.warn(`[auth] feed/user ${userId} returned no user object`);
      return null;
    }
    const pic = bestProfilePic(u);
    if (!pic.url) return null;
    return {
      full_name: u.full_name || '',
      profile_pic_url: pic.url,
      pic_width: pic.width,
      followers: u.follower_count != null ? formatCount(u.follower_count) : null,
      following: u.following_count != null ? formatCount(u.following_count) : null,
      posts: u.media_count != null ? formatCount(u.media_count) : null,
    };
  } catch (e) {
    console.warn(`[auth] feed/user ${userId} error: ${e.message}`);
    return null;
  }
}

// Last resort for HD profile pic: /users/<id>/full_detail_info/ — the
// endpoint IG's own mobile app calls when opening a profile. Returns a
// nested user_detail.user with the full hd_profile_pic_url_info even when
// /users/<id>/info/ returns the empty-user sentinel for the same account.
// Different code path entirely — separate rate limits, separate gating.
async function fetchUserFullDetail(userId) {
  if (!IG_SID() || !userId) return null;
  try {
    const url = `https://i.instagram.com/api/v1/users/${userId}/full_detail_info/`
      + `?include_chaining=false&include_reel=false&include_suggested_users=false`
      + `&include_logged_out_extras=false&include_highlight_reels=false&include_live_status=false`;
    const r = await httpsGet(url, igAuthedHeaders());
    if (r.status !== 200) {
      console.warn(`[auth] full_detail_info ${userId} status=${r.status}`);
      return null;
    }
    const j = JSON.parse(r.body);
    const u = j?.user_detail?.user;
    if (!u || !u.pk) {
      console.warn(`[auth] full_detail_info ${userId} returned no user object`);
      return null;
    }
    const pic = bestProfilePic(u);
    if (!pic.url) return null;
    return {
      full_name: u.full_name || '',
      profile_pic_url: pic.url,
      pic_width: pic.width,
      followers: u.follower_count != null ? formatCount(u.follower_count) : null,
      following: u.following_count != null ? formatCount(u.following_count) : null,
      posts: u.media_count != null ? formatCount(u.media_count) : null,
    };
  } catch (e) {
    console.warn(`[auth] full_detail_info ${userId} error: ${e.message}`);
    return null;
  }
}

module.exports = {
  fetchIsPrivateAuthed,
  fetchUserBasics,
  fetchIsFollowing,
  fetchUserInfoAuthed,
  fetchUserPicViaFeed,
  fetchUserFullDetail,
};
