// POST /api/ig-login
// Body: { username, password }
//
// Web-API login (more reliable than the mobile signed_body path). Three
// outcomes:
//   - 2FA required → returns { twoFactorRequired, twoFactorId, csrfToken }
//     for the frontend's 2fa-modal step (POST /api/ig-login/2fa)
//   - Checkpoint required → 401 with an explanatory message
//   - Success → stores sessionid in the per-browser session and returns
//     the authed username
import { randomBytes } from 'node:crypto';
import { httpsGet, httpsPost } from '../utils/http.js';
import { UA_DESKTOP_124, UA_INSTAGRAM_ANDROID } from '../utils/ua.js';
import { IG_APP_ID } from '../utils/ig.js';
import { setIg } from '../utils/session.js';

function extractCookie(cookies, name) {
  for (const c of cookies) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { username, password } = body || {};
  if (!username || !password) {
    setResponseStatus(event, 400);
    return { error: 'Username and password are required.' };
  }

  const guid = randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

  try {
    const csrfRes = await httpsGet('https://i.instagram.com/api/v1/si/fetch_headers/?challenge_type=signup&guid=' + guid, {
      'User-Agent': UA_INSTAGRAM_ANDROID,
      'x-ig-app-id': IG_APP_ID,
    });
    const csrfToken = extractCookie(csrfRes.cookies, 'csrftoken') || 'missing';

    const loginPayload = new URLSearchParams({
      username: String(username).trim(),
      enc_password: '#PWD_INSTAGRAM_BROWSER:0:' + Math.floor(Date.now() / 1000) + ':' + password,
      queryParams: '{}',
      optIntoOneTap: 'false',
    }).toString();

    const loginRes = await httpsPost('https://www.instagram.com/api/v1/web/accounts/login/ajax/', loginPayload, {
      'User-Agent': UA_DESKTOP_124,
      'x-csrftoken': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'x-ig-app-id': '936619743392459',
      'Referer': 'https://www.instagram.com/accounts/login/',
      'Origin': 'https://www.instagram.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `csrftoken=${csrfToken}; mid=${randomBytes(14).toString('base64')}`,
    });

    console.log(`[auth] login response status=${loginRes.status}`);

    let loginData;
    try { loginData = JSON.parse(loginRes.body); } catch (_) {
      setResponseStatus(event, 500);
      return { error: 'Instagram returned an unexpected response. Try again later.' };
    }

    if (loginData.two_factor_required) {
      const tfCsrf = extractCookie(loginRes.cookies, 'csrftoken') || csrfToken;
      const tfId = loginData.two_factor_info?.two_factor_identifier;
      return {
        twoFactorRequired: true,
        twoFactorId: tfId,
        csrfToken: tfCsrf,
        twoFactorMethods: loginData.two_factor_info?.totp_two_factor_on ? ['totp'] : ['sms'],
        message: 'Two-factor authentication required.',
      };
    }

    if (loginData.message === 'checkpoint_required' || loginData.checkpoint_url) {
      setResponseStatus(event, 401);
      return {
        error: 'Instagram requires a security verification. Please log in via instagram.com in your browser first to verify your identity, then try again.',
      };
    }

    if (loginData.authenticated === false) {
      setResponseStatus(event, 401);
      return { error: 'Invalid username or password.' };
    }

    if (loginData.status === 'fail' && !loginData.authenticated) {
      setResponseStatus(event, 401);
      return { error: loginData.message || 'Invalid username or password.' };
    }

    const sid = extractCookie(loginRes.cookies, 'sessionid');
    const dsUser = extractCookie(loginRes.cookies, 'ds_user_id') || (loginData.userId ? String(loginData.userId) : '');
    if (!sid) {
      setResponseStatus(event, 500);
      return { error: 'Login succeeded but no session cookie was returned.' };
    }

    // Build the full cookie string from EVERY cookie IG set during the
    // CSRF + login round-trip. IG shadow-bans fresh sessions on users/info
    // (returns 200 with {"user":{}}) when the request only carries
    // sessionid+ds_user_id, but accepts the same session normally when the
    // full browser cookie set (csrftoken, mid, ig_did, rur, shbid, shbts)
    // is present. This was the silent regression from the pre-Nuxt flow,
    // which relied on a long-lived .env-persisted session that had already
    // "warmed up" into trusted state.
    const cookieMap = new Map();
    for (const c of [...csrfRes.cookies, ...loginRes.cookies]) {
      const m = c.match(/^([^=]+)=([^;]*)/);
      if (m) cookieMap.set(m[1].trim(), m[2]);
    }
    cookieMap.set('sessionid', sid);
    cookieMap.set('ds_user_id', dsUser);
    const cookieStr = [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

    const ig = { sessionid: sid, dsUserId: dsUser, cookieStr, username: String(username).trim() };
    try {
      const infoRes = await httpsGet(`https://i.instagram.com/api/v1/users/${dsUser}/info/`, {
        'User-Agent': UA_INSTAGRAM_ANDROID,
        'x-ig-app-id': IG_APP_ID,
        'Cookie': cookieStr,
      });
      if (infoRes.status === 200) {
        const infoData = JSON.parse(infoRes.body);
        if (infoData.user && infoData.user.username) ig.username = infoData.user.username;
      }
    } catch (_) { /* username is cosmetic */ }
    setIg(ig);

    console.log(`[auth] logged in as @${ig.username} (user ${dsUser}, ${cookieMap.size} cookies)`);
    return { success: true, username: ig.username };
  } catch (err) {
    console.error('[auth] login error:', err.message);
    setResponseStatus(event, 500);
    return { error: 'Login failed. Please try again.' };
  }
});
