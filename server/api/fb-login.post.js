// POST /api/fb-login — establish a Facebook session from pasted cookies.
//
// FB blocks scripted username/password logins (checkpoint flagging fires
// on most new-IP attempts), so this app uses the paste-cookies pattern
// instead. The /fb-auth HTML page walks the user through extracting their
// browser's `c_user`, `xs`, `fr`, `datr` and `sb` cookies via DevTools
// and posts them here.
//
// Validation is best-effort: we probe profile.php for the embedded user
// markers and accept on a positive match. An inconclusive probe (FB's
// anti-abuse layer 4xx-ing the datacenter IP) is logged but not failed,
// since the cookies will likely work fine from the user's own browser
// context downstream. Only a definitive logged-out signal hard-fails.
import { httpsGet } from '../utils/http.js';
import { UA_DESKTOP_124 } from '../utils/ua.js';
import { decodeHtmlEntities } from '../utils/util.js';
import { setFb } from '../utils/session.js';
import { fbBrowserHeaders } from '../utils/fb.js';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { cookies, userAgent } = body || {};
  if (!cookies || !cookies.includes('c_user') || !cookies.includes('xs')) {
    setResponseStatus(event, 400);
    return { error: 'Please provide c_user and xs cookies.' };
  }

  try {
    const cookieStr = String(cookies).trim();

    const cUserMatch = cookieStr.match(/c_user=(\d+)/);
    if (!cUserMatch) {
      setResponseStatus(event, 400);
      return { error: 'Could not find c_user value in the cookies.' };
    }
    const cUser = cUserMatch[1];

    // FB binds sessions to the User-Agent that issued them. Use the caller's
    // real UA if they passed one (the bookmarklet does); otherwise fall back.
    const validateUA = (typeof userAgent === 'string' && userAgent.length > 20 && userAgent.length < 500)
      ? userAgent
      : UA_DESKTOP_124;

    let displayName = '';
    let authMarkerFound = false;
    try {
      const profRes = await httpsGet(
        `https://www.facebook.com/profile.php?id=${cUser}`,
        { ...fbBrowserHeaders(validateUA), 'Cookie': cookieStr },
      );

      // Positive auth signal: logged-in viewer's ID is embedded in inline JSON.
      const authMarker = new RegExp('"(?:__user|USER_ID|actorID|user_id)"\\s*:\\s*"?' + cUser + '"?');
      authMarkerFound = profRes.status === 200 && authMarker.test(profRes.body);
      const loggedOutMarker = /"__user"\s*:\s*"?0"?/.test(profRes.body);

      if (authMarkerFound) {
        const nameMatch = profRes.body.match(/"name"\s*:\s*"([^"]{2,50})"/) ||
                          profRes.body.match(/og:title"[^>]*content="([^"]+)"/);
        if (nameMatch) {
          const candidate = decodeHtmlEntities(nameMatch[1]).trim();
          if (!candidate.includes('|') && !candidate.includes('Facebook')) {
            displayName = candidate;
          }
        }
      } else if (loggedOutMarker || profRes.status === 401 || profRes.status === 403) {
        const cookieNames = cookieStr.split(';').map(s => s.split('=')[0].trim()).filter(Boolean);
        console.warn('[fb-auth] cookies are explicitly logged-out for user ' + cUser + ': status=' + profRes.status + ' loggedOut=' + loggedOutMarker + ' cookies=[' + cookieNames.join(',') + ']');
        setResponseStatus(event, 401);
        return { error: 'Facebook rejected these cookies as expired. Please paste fresh values from your browser.' };
      } else {
        const cookieNames = cookieStr.split(';').map(s => s.split('=')[0].trim()).filter(Boolean);
        console.warn('[fb-auth] validation inconclusive for user ' + cUser + ', accepting anyway: status=' + profRes.status + ' bodyLen=' + (profRes.body || '').length + ' cookies=[' + cookieNames.join(',') + ']');
      }
    } catch (probeErr) {
      console.warn('[fb-auth] validation probe failed for user ' + cUser + ': ' + probeErr.message);
    }

    if (!displayName) displayName = 'User ' + cUser;
    setFb({ cookies: cookieStr, userId: cUser, username: displayName, accessToken: '' });

    console.log('[fb-auth] connected as ' + displayName + ' (user ' + cUser + ', validated=' + authMarkerFound + ')');
    return { success: true, username: displayName, userId: cUser, validated: authMarkerFound };
  } catch (err) {
    console.error('[fb-auth] login error:', err.message);
    setResponseStatus(event, 500);
    return { error: 'Login failed. Please try again.' };
  }
});
