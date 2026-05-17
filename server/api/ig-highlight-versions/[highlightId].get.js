// GET /api/ig-highlight-versions/:highlightId — HD video versions for
// every item in a highlight reel. Uses yt-dlp + the user's session
// cookies, same approach as /api/ig-post-versions/:code. The mobile
// reels_media endpoint serves degraded video_versions (capped around
// 720x1280); yt-dlp goes through the web-API path the real instagram.com
// client uses and exposes the full 1080x1920 originals.
//
// Returns { items: [{ id, videoVersions: [{ url, width, height }, ...] }] }
// where `id` matches the `pk` we already returned from /api/ig-highlight/
// so the frontend can merge HD versions item-by-item.
import { IG_SID } from '../../utils/session.js';
import { UA_DESKTOP_124 } from '../../utils/ua.js';
import { ytExec } from '../../utils/yt-dlp.js';
import {
  invalidateIgSession, writeIgCookieFile, igFormatsFromYtDlp,
} from '../../utils/ig.js';

export default defineEventHandler(async (event) => {
  if (!IG_SID()) {
    setResponseStatus(event, 401);
    return { error: 'Login required for high-quality variants.' };
  }
  let highlightId = getRouterParam(event, 'highlightId') || '';
  highlightId = highlightId.replace(/^highlight:/, '');
  if (!/^\d{5,30}$/.test(highlightId)) {
    setResponseStatus(event, 400);
    return { error: 'Invalid highlight ID.' };
  }
  const cookieFile = writeIgCookieFile();
  if (!cookieFile) {
    setResponseStatus(event, 401);
    return { error: 'Login required for high-quality variants.' };
  }
  const url = `https://www.instagram.com/stories/highlights/${highlightId}/`;
  try {
    const t0 = Date.now();
    const ytArgs = [
      '--dump-single-json',
      '--no-warnings',
      '--no-check-certificate',
      '--cookies', cookieFile,
      '--user-agent', UA_DESKTOP_124,
      url,
    ];
    const { stdout } = await ytExec(ytArgs);
    const info = JSON.parse(stdout);

    const entries = Array.isArray(info.entries) ? info.entries
      : (info.formats || info.url) ? [info] : [];
    if (!entries.length) {
      console.log(`[ig-highlight-versions] ${highlightId} no entries`);
      return { items: [] };
    }

    const items = entries.map(e => ({
      id: String(e.id || e.display_id || ''),
      videoVersions: igFormatsFromYtDlp(e),
    })).filter(it => it.id && it.videoVersions.length);

    console.log(`[ig-highlight-versions] ${highlightId} ok in ${Date.now() - t0}ms (${items.length}/${entries.length} items)`);
    return { items };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[ig-highlight-versions]', msg.slice(0, 400));
    if (/login.required|requires login|login_required|session/i.test(msg)) {
      invalidateIgSession('ig-highlight-versions login required');
      setResponseStatus(event, 401);
      return { error: 'Session expired.', loggedOut: true };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch highlight HD versions.' };
  }
});
