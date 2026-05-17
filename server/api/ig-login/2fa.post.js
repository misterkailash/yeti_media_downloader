// POST /api/ig-login/2fa
// Body: { code, twoFactorId, username, csrfToken }
//
// Second leg of the IG login. The first /api/ig-login response includes
// twoFactorId + csrfToken when IG demands TOTP/SMS; the frontend collects
// the code and posts both back here.
import { httpsGet, httpsPost } from '../../utils/http.js';
import { UA_DESKTOP_124, UA_INSTAGRAM_ANDROID } from '../../utils/ua.js';
import { IG_APP_ID } from '../../utils/ig.js';
import { setIg } from '../../utils/session.js';

function extractCookie(cookies, name) {
  for (const c of cookies) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { code, twoFactorId, username, csrfToken } = body || {};
  if (!code || !twoFactorId) {
    setResponseStatus(event, 400);
    return { error: 'Verification code is required.' };
  }

  try {
    const tfPayload = new URLSearchParams({
      verificationCode: String(code).trim(),
      identifier: twoFactorId,
      username: username || '',
    }).toString();

    const tfRes = await httpsPost('https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/', tfPayload, {
      'User-Agent': UA_DESKTOP_124,
      'x-csrftoken': csrfToken || 'missing',
      'x-requested-with': 'XMLHttpRequest',
      'x-ig-app-id': '936619743392459',
      'Referer': 'https://www.instagram.com/accounts/login/two_factor/',
      'Origin': 'https://www.instagram.com',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `csrftoken=${csrfToken || 'missing'}`,
    });

    console.log(`[auth] 2FA response status=${tfRes.status}`);

    let tfData;
    try { tfData = JSON.parse(tfRes.body); } catch (_) {
      setResponseStatus(event, 500);
      return { error: 'Instagram returned an unexpected response.' };
    }

    if (tfData.authenticated === false || tfData.status === 'fail') {
      setResponseStatus(event, 401);
      return { error: tfData.message || 'Invalid verification code.' };
    }

    const sid = extractCookie(tfRes.cookies, 'sessionid');
    const dsUser = extractCookie(tfRes.cookies, 'ds_user_id') || (tfData.userId ? String(tfData.userId) : '');
    if (!sid) {
      setResponseStatus(event, 500);
      return { error: 'Verification succeeded but no session cookie was returned.' };
    }

    const ig = { sessionid: sid, dsUserId: dsUser, username: username || '' };
    try {
      const infoRes = await httpsGet(`https://i.instagram.com/api/v1/users/${dsUser}/info/`, {
        'User-Agent': UA_INSTAGRAM_ANDROID,
        'x-ig-app-id': IG_APP_ID,
        'Cookie': `sessionid=${sid}; ds_user_id=${dsUser}`,
      });
      if (infoRes.status === 200) {
        const infoData = JSON.parse(infoRes.body);
        if (infoData.user) ig.username = infoData.user.username;
      }
    } catch (_) {}
    setIg(ig);

    console.log(`[auth] 2FA verified, logged in as @${ig.username} (user ${dsUser})`);
    return {
      success: true,
      username: ig.username,
      fullName: tfData.logged_in_user?.full_name || '',
    };
  } catch (err) {
    console.error('[auth] 2FA error:', err.message);
    setResponseStatus(event, 500);
    return { error: 'Verification failed. Please try again.' };
  }
});
