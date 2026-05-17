// GET /api/fb-profile/:username — Facebook profile picture lookup.
//
// FB serves four different "shapes" depending on UA + cookies + profile
// privacy, so this endpoint tries them in order, validating each candidate
// image URL:
//   1. Public Pages crawler path  — facebookexternalhit UA hits og:image
//      directly. Works for Pages without any session.
//   2. Logged-in desktop path     — full Chrome UA + sec-ch-ua-* + cookies.
//      Extracts the largest scontent.fbcdn.net URL from the embedded JSON.
//   3. Logged-in mobile path      — m.facebook.com + iOS Safari UA fallback.
//   4. Anonymous mobile probe     — last-resort, uses the public mobile
//      preview that FB serves to anyone (even when authed paths 4xx us).
//
// Every candidate image URL is HEAD-probed via isUsableImageUrl to catch
// lookaside.fbsbx.com URLs that FB serves as HTML "view in app" stubs
// instead of actual JPEGs.
import { httpsGet } from '../../utils/http.js';
import { UA_DESKTOP_124, UA_MOBILE_IPHONE } from '../../utils/ua.js';
import { decodeHtmlEntities } from '../../utils/util.js';
import {
  isUsableImageUrl, upgradeFbScontentUrl, pickLargestFbPicUrl,
  fbBrowserHeaders, parseFbDescription,
} from '../../utils/fb.js';
import { FB_CKS } from '../../utils/session.js';

export default defineEventHandler(async (event) => {
  const username = getRouterParam(event, 'username');

  try {
    // ---------- Public Pages path (no FB session required) ----------
    let isPersonalProfile = false;
    let targetUserId = null;
    try {
      const crawlerR = await httpsGet(`https://www.facebook.com/${encodeURIComponent(username)}`, {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      });
      if (crawlerR.status === 200) {
        const html = crawlerR.body;
        const ogImg = html.match(/og:image"[^>]*content="([^"]+)"/);
        const ogTitle = html.match(/og:title"[^>]*content="([^"]+)"/);
        const ogDesc = html.match(/og:description"[^>]*content="([^"]+)"/);
        if (ogImg && ogTitle && !/<title>Facebook<\/title>/.test(html)) {
          const picUrl = decodeHtmlEntities(ogImg[1]);
          const mediaIdMatch = picUrl.match(/[?&]media_id=(\d+)/);
          if (mediaIdMatch) targetUserId = mediaIdMatch[1];
          let usable = true;
          if (FB_CKS() && /lookaside\.fbsbx\.com/.test(picUrl)) {
            usable = await isUsableImageUrl(picUrl);
            if (!usable) console.warn(`[fb-profile] lookaside URL for ${username} is not an image, trying logged-in path`);
          }
          if (usable) {
            const stats = ogDesc ? parseFbDescription(decodeHtmlEntities(ogDesc[1])) : {};
            return {
              username,
              full_name: decodeHtmlEntities(ogTitle[1]).trim(),
              profile_pic_url: upgradeFbScontentUrl(picUrl),
              followers: stats.followers || null,
              following: stats.talking || null,
              posts: null,
            };
          }
        }
        // No og:image but page exists → mobile UA can confirm it's a
        // personal profile via the `refresh: 0; URL=fb://profile/?id=<NNN>`
        // header. Used to surface a clearer login-required error.
        try {
          const probeR = await httpsGet(`https://www.facebook.com/${encodeURIComponent(username)}`, {
            'User-Agent': UA_MOBILE_IPHONE,
          });
          const refresh = probeR.headers && probeR.headers.refresh;
          const idMatch = typeof refresh === 'string' && refresh.match(/[?&]id=(\d+)/);
          if (idMatch) {
            isPersonalProfile = true;
            if (!targetUserId) targetUserId = idMatch[1];
          }
        } catch (_) {}
      } else if (crawlerR.status === 404) {
        setResponseStatus(event, 404);
        return { error: 'User not found' };
      }
    } catch (_) { /* fall through to logged-in path */ }

    if (isPersonalProfile && !FB_CKS()) {
      setResponseStatus(event, 401);
      return { error: 'This profile is private to logged-out users. Add a Facebook session in the sidebar, then try again.' };
    }

    // ---------- Logged-in fallback (full data for private/locked accounts) ----------
    const reqUA = getHeader(event, 'user-agent');
    const browserUA = reqUA && /Mozilla/.test(reqUA) ? reqUA : UA_DESKTOP_124;
    const fbHeaders = fbBrowserHeaders(browserUA);
    if (FB_CKS()) fbHeaders['Cookie'] = FB_CKS();
    // Prefer profile.php?id=<NNN> when we have the target's numeric id.
    // FB's anti-abuse routinely 400s www.facebook.com/<username> with
    // cookies that don't match the originating browser fingerprint, but
    // serves the same profile data through profile.php with no issue.
    const desktopUrl = targetUserId
      ? `https://www.facebook.com/profile.php?id=${targetUserId}`
      : `https://www.facebook.com/${encodeURIComponent(username)}`;
    let r = await httpsGet(desktopUrl, fbHeaders);
    if (targetUserId && r.status >= 400 && r.status < 500) {
      console.warn(`[fb-profile] profile.php?id=${targetUserId} returned ${r.status} for ${username}, retrying via /<username>`);
      r = await httpsGet(`https://www.facebook.com/${encodeURIComponent(username)}`, fbHeaders);
    }
    if (FB_CKS() && r.status >= 400 && r.status < 500) {
      console.warn(`[fb-profile] authed fetch returned ${r.status} for ${username}, retrying anonymously as last resort`);
      const anonHeaders = { ...fbHeaders };
      delete anonHeaders['Cookie'];
      r = await httpsGet(`https://www.facebook.com/${encodeURIComponent(username)}`, anonHeaders);
    }

    if (r.status === 404) {
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }
    const desktopOk = r.status === 200;
    const html = desktopOk ? r.body : '';
    const isSplash = desktopOk && /<title>Facebook<\/title>|logoSplashScreen/.test(html);
    const hasNoContent = desktopOk && /Page Not Found|content isn't available|isn&#039;t available/i.test(html);

    if (hasNoContent) {
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }

    if (FB_CKS()) {
      const nameFromPage = html.match(/"name"\s*:\s*"([^"]{2,50})".*?"profile_picture"/) ||
                           html.match(/,"name":"([^"]{2,50})","__typename":"User"/) ||
                           html.match(/"actor_name"\s*:\s*"([^"]{2,50})"/);
      const bestPicUrl = pickLargestFbPicUrl(html);
      if (nameFromPage && bestPicUrl) {
        return {
          username,
          full_name: nameFromPage[1],
          profile_pic_url: upgradeFbScontentUrl(bestPicUrl),
          followers: null, following: null, posts: null,
        };
      }
    }

    if (isSplash && !FB_CKS()) {
      setResponseStatus(event, 401);
      return { error: 'This profile requires login. Please log in with Facebook first.' };
    }

    // Mobile fallback
    if (isSplash || !desktopOk || !html.match(/og:image/)) {
      const mHeaders = fbBrowserHeaders(UA_MOBILE_IPHONE);
      if (FB_CKS()) mHeaders['Cookie'] = FB_CKS();
      const mobileUrl = targetUserId
        ? `https://m.facebook.com/profile.php?id=${targetUserId}`
        : `https://m.facebook.com/${encodeURIComponent(username)}`;
      const mr = await httpsGet(mobileUrl, mHeaders);
      if (mr.status === 200 && !/<title>Facebook<\/title>/.test(mr.body)) {
        const ogImg = mr.body.match(/og:image"[^>]*content="([^"]+)"/);
        const ogTitle = mr.body.match(/og:title"[^>]*content="([^"]+)"/);
        const ogDesc = mr.body.match(/og:description"[^>]*content="([^"]+)"/);
        if (ogImg && ogTitle) {
          const mPicUrl = decodeHtmlEntities(ogImg[1]);
          const usable = !/lookaside\.fbsbx\.com/.test(mPicUrl) || await isUsableImageUrl(mPicUrl);
          if (usable) {
            const mStats = ogDesc ? parseFbDescription(decodeHtmlEntities(ogDesc[1])) : {};
            return {
              username,
              full_name: decodeHtmlEntities(ogTitle[1]).trim(),
              profile_pic_url: upgradeFbScontentUrl(mPicUrl),
              followers: mStats.followers || null,
              following: mStats.talking || null,
              posts: null,
            };
          }
          console.warn(`[fb-profile] mobile-page lookaside URL for ${username} is not an image, falling through to final og match`);
        }
      }
      // Final safety net: m.facebook.com served via Safari-iOS UA with NO
      // cookies almost always returns a usable og:image (scontent URL, not
      // lookaside). FB serves the mobile preview to anyone hitting the
      // mobile site with a mobile UA, even when the authed paths are
      // blocking us.
      const anonMobileCandidates = [];
      if (targetUserId) {
        anonMobileCandidates.push(`https://m.facebook.com/profile.php?id=${targetUserId}`);
        anonMobileCandidates.push(`https://www.facebook.com/profile.php?id=${targetUserId}`);
      }
      anonMobileCandidates.push(`https://m.facebook.com/${encodeURIComponent(username)}`);
      const anonHeaders = fbBrowserHeaders(UA_MOBILE_IPHONE);
      for (const candidate of anonMobileCandidates) {
        try {
          const anonM = await httpsGet(candidate, anonHeaders);
          console.log(`[fb-profile] anon mobile probe ${candidate} → status=${anonM.status} bodyLen=${(anonM.body || '').length}`);
          if (anonM.status !== 200) continue;
          const ogImg = anonM.body.match(/og:image"[^>]*content="([^"]+)"/);
          const ogTitle = anonM.body.match(/og:title"[^>]*content="([^"]+)"/);
          const ogDesc = anonM.body.match(/og:description"[^>]*content="([^"]+)"/);
          if (!ogImg || !ogTitle) {
            console.log(`[fb-profile]   no og:image/og:title on ${candidate}`);
            continue;
          }
          const aPicUrl = decodeHtmlEntities(ogImg[1]);
          const aUsable = !/lookaside\.fbsbx\.com/.test(aPicUrl) || await isUsableImageUrl(aPicUrl);
          if (!aUsable) {
            console.log(`[fb-profile]   ${candidate} returned an unusable lookaside URL, trying next`);
            continue;
          }
          console.warn(`[fb-profile] served ${username} via anonymous fallback: ${candidate}`);
          const aStats = ogDesc ? parseFbDescription(decodeHtmlEntities(ogDesc[1])) : {};
          return {
            username,
            full_name: decodeHtmlEntities(ogTitle[1]).trim(),
            profile_pic_url: upgradeFbScontentUrl(aPicUrl),
            followers: aStats.followers || null,
            following: aStats.talking || null,
            posts: null,
          };
        } catch (e) {
          console.log(`[fb-profile]   anon probe ${candidate} threw: ${e.message}`);
        }
      }

      if (isSplash || !desktopOk) {
        if (FB_CKS()) {
          setResponseStatus(event, 502);
          return {
            error: 'Facebook won\'t share this profile with us. ' +
                   'This usually means the profile owner restricted visibility to friends-only (FB doesn\'t expose those pictures to anyone but logged-in friends). ' +
                   'Try a public profile (e.g. a Page like "cristiano") to confirm your session is otherwise working.',
          };
        }
        setResponseStatus(event, 401);
        return { error: 'This profile requires login. Please log in with Facebook first.' };
      }
    }

    const ogImageMatch = html.match(/og:image"[^>]*content="([^"]+)"/);
    const ogTitleMatch = html.match(/og:title"[^>]*content="([^"]+)"/);
    const ogDescMatch  = html.match(/og:description"[^>]*content="([^"]+)"/);

    if (!ogImageMatch || !ogTitleMatch) {
      setResponseStatus(event, 404);
      return { error: 'User not found' };
    }

    const profilePicUrl = decodeHtmlEntities(ogImageMatch[1]);
    const fullName = ogTitleMatch ? decodeHtmlEntities(ogTitleMatch[1]).trim() : '';
    const stats = ogDescMatch ? parseFbDescription(decodeHtmlEntities(ogDescMatch[1])) : {};

    return {
      username,
      full_name: fullName,
      profile_pic_url: upgradeFbScontentUrl(profilePicUrl),
      followers: stats.followers || null,
      following: stats.talking || null,
      posts: null,
    };
  } catch (err) {
    console.error(err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch profile' };
  }
});
