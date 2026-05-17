// POST /api/tt-login — establish a TikTok session from a pasted sessionid.
//
// Same paste-cookies pattern as FB. We probe /foryou for the embedded
// universal-data rehydration JSON to confirm TikTok hasn't bounced the
// cookie and to pull the user's @handle when possible. The user-id isn't
// strictly required (yt-dlp downloads with just sessionid), so we accept
// even if username extraction fails.
import { httpsGet } from '../utils/http.js';
import { UA_DESKTOP_124_LITE } from '../utils/ua.js';
import { setTt } from '../utils/session.js';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { cookies } = body || {};
  if (!cookies || !/sessionid=/.test(cookies)) {
    setResponseStatus(event, 400);
    return { error: 'Please provide a sessionid cookie.' };
  }

  try {
    const cookieStr = String(cookies).trim();

    const probeRes = await httpsGet('https://www.tiktok.com/foryou', {
      'User-Agent': UA_DESKTOP_124_LITE,
      'Cookie': cookieStr,
      'Accept': 'text/html,application/xhtml+xml',
    });

    if (probeRes.status !== 200) {
      setResponseStatus(event, 401);
      return { error: 'TikTok rejected the cookie. Get a fresh sessionid from your browser.' };
    }

    let username = '';
    const m = probeRes.body.match(/"uniqueId"\s*:\s*"([A-Za-z0-9._]{1,40})"/);
    if (m) username = m[1];

    setTt({ cookies: cookieStr, userId: '', username: username || '' });

    console.log(`[tt-auth] connected${username ? ` as @${username}` : ''}`);
    return { success: true, username: username || null };
  } catch (err) {
    console.error('[tt-auth] login error:', err.message);
    setResponseStatus(event, 500);
    return { error: 'Login failed. Please try again.' };
  }
});
