// GET /api/tt-profile/:username — TikTok profile picture lookup.
//
// Two-tier extraction:
//   1. Scrape www.tiktok.com/@<username> and parse the rehydration JSON
//      (__UNIVERSAL_DATA_FOR_REHYDRATION__) for HD avatar + exact stats.
//      Falls back to og tags if the JSON shape changes.
//   2. tikwm.com user-info API — TikTok serves a WAF challenge for ~10% of
//      profile lookups; tikwm is region-diverse enough to often succeed
//      where TikTok blocks us.
import https from 'node:https';
import { httpsGet } from '../../utils/http.js';
import { UA_DESKTOP_120 } from '../../utils/ua.js';
import { decodeHtmlEntities, formatCount } from '../../utils/util.js';

// tikwm.com user-info — used as a fallback when TikTok serves a WAF
// challenge or when the page parse comes up empty. Resolves to:
//   { data: { user, stats } } on success
//   { notFound: true } if tikwm confirms the user doesn't exist
//   null on transient/unknown failure
function fetchTikwmUserInfo(username) {
  return new Promise((resolve) => {
    const req = https.request({
      host: 'www.tikwm.com',
      path: `/api/user/info?unique_id=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        'User-Agent': UA_DESKTOP_120,
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.code === 0 && j.data) return resolve({ data: j.data });
          const msg = (j && j.msg) || '';
          if (msg) console.warn(`[tikwm-user] ${msg}`);
          if (/invalid|not found|no such/i.test(msg)) return resolve({ notFound: true });
          resolve(null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[tikwm-user] ${e.message}`); resolve(null); });
    req.end();
  });
}

export default defineEventHandler(async (event) => {
  const raw = (getRouterParam(event, 'username') || '').trim();
  const VIDEO_HINT = 'This looks like a TikTok video or slideshow link. Switch to the TikTok Videos tab to download it.';

  // Video/photo URL pasted into the DP input — redirect them to TikTok Videos.
  if (/tiktok\.com\/(?:@[A-Za-z0-9._]+\/)?(?:video|photo|v)\//i.test(raw)) {
    setResponseStatus(event, 400);
    return { error: VIDEO_HINT };
  }
  // Short share URLs (vt/vm/m.tiktok.com/XXXX) are almost always videos or
  // photo posts, not profile links — same friendly redirect.
  if (/^https?:\/\/(?:vt|vm|m)\.tiktok\.com\//i.test(raw)) {
    setResponseStatus(event, 400);
    return { error: VIDEO_HINT };
  }

  const urlMatch = raw.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
  const username = urlMatch ? urlMatch[1] : raw.replace(/^@/, '');
  if (!username || !/^[A-Za-z0-9._]+$/.test(username)) {
    setResponseStatus(event, 400);
    return { error: 'Invalid TikTok username' };
  }

  const tryTikwm = async () => {
    const tw = await fetchTikwmUserInfo(username);
    if (!tw) return null;
    if (tw.notFound) return { notFound: true };
    if (!tw.data || !tw.data.user) return null;
    const u = tw.data.user;
    const stats = tw.data.stats || {};
    return { profile: {
      username: u.uniqueId || username,
      full_name: u.nickname || '',
      profile_pic_url: u.avatarLarger || u.avatarMedium || u.avatarThumb || '',
      followers: formatCount(Number(stats.followerCount) || 0),
      following: formatCount(Number(stats.followingCount) || 0),
      posts: formatCount(Number(stats.videoCount) || 0),
    } };
  };

  try {
    const r = await httpsGet(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      'User-Agent': UA_DESKTOP_120,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (r.status === 404) {
      const tw = await tryTikwm();
      if (tw && tw.profile) return tw.profile;
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }
    if (r.status !== 200) {
      const tw = await tryTikwm();
      if (tw && tw.profile) return tw.profile;
      if (tw && tw.notFound) {
        setResponseStatus(event, 404);
        return { error: 'User not found' };
      }
      setResponseStatus(event, r.status);
      return { error: `TikTok returned ${r.status}` };
    }

    const html = r.body;

    // TikTok's anti-bot WAF returns HTTP 200 with a "Please wait..." stub
    // page that has no rehydration JSON or og tags. Detect and skip straight
    // to tikwm rather than falling through to a misleading "User not found".
    const isWafChallenge = /_wafchallengeid|waforiginalreid|SlardarWAF/.test(html);
    if (isWafChallenge) {
      console.warn(`[tiktok] WAF challenge for @${username}, falling back to tikwm`);
      const tw = await tryTikwm();
      if (tw && tw.profile) return tw.profile;
      if (tw && tw.notFound) {
        setResponseStatus(event, 404);
        return { error: 'User not found' };
      }
      setResponseStatus(event, 503);
      return { error: 'TikTok is rate-limiting profile lookups right now. Try again in a minute.' };
    }

    // Primary path: parse the rehydration JSON blob (has HD avatar + exact stats)
    const dataMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const userDetail = data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.user-detail'];
        if (userDetail && userDetail.statusCode !== 0 && userDetail.statusCode != null) {
          const tw = await tryTikwm();
          if (tw && tw.profile) return tw.profile;
          setResponseStatus(event, 404);
          return { error: 'User not found' };
        }
        if (userDetail && userDetail.userInfo) {
          const u = userDetail.userInfo.user || {};
          const stats = userDetail.userInfo.stats || userDetail.userInfo.statsV2 || {};
          const hdUrl = u.avatarLarger || u.avatarMedium || u.avatarThumb;
          if (hdUrl) {
            return {
              username: u.uniqueId || username,
              full_name: u.nickname || '',
              profile_pic_url: hdUrl,
              followers: formatCount(Number(stats.followerCount) || 0),
              following: formatCount(Number(stats.followingCount) || 0),
              posts: formatCount(Number(stats.videoCount) || 0),
            };
          }
        }
      } catch (e) {
        console.warn(`[tiktok] JSON parse error: ${e.message}`);
      }
    }

    // Fallback: og tags (lower-res avatar, no stats)
    const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
    if (!ogImageMatch) {
      const tw = await tryTikwm();
      if (tw && tw.profile) return tw.profile;
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }

    let fullName = '';
    if (ogTitleMatch) {
      const title = decodeHtmlEntities(ogTitleMatch[1]);
      const nameMatch = title.match(/^(.+?)\s*\(@/);
      fullName = nameMatch ? nameMatch[1].trim() : title.split('|')[0].trim();
    }

    return {
      username,
      full_name: fullName,
      profile_pic_url: decodeHtmlEntities(ogImageMatch[1]),
      followers: null,
      following: null,
      posts: null,
    };
  } catch (err) {
    console.error(err);
    const tw = await tryTikwm().catch(() => null);
    if (tw && tw.profile) return tw.profile;
    if (tw && tw.notFound) {
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch profile' };
  }
});
