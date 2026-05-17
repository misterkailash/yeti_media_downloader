// GET /api/ig-post-versions/:code — full quality list for one IG post/reel.
//
// IG's profile feed (/feed/user/<id>/) and even the mobile media-info
// endpoint serve down-graded video_versions (reels capped at 720x1280).
// The only reliable way to surface the original 1080x1920 stream — which
// is what sealx and similar downloaders show — is to call yt-dlp with the
// user's IG session cookies. yt-dlp goes through the same web-API path
// the real instagram.com client uses, exposing the full DASH manifest.
//
// Carousel posts: yt-dlp emits a playlist with `entries[]`, one per slide.
// Single posts/reels just have `formats[]` directly.
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
  const code = getRouterParam(event, 'code');
  if (!/^[A-Za-z0-9_-]{3,50}$/.test(code)) {
    setResponseStatus(event, 400);
    return { error: 'Invalid shortcode.' };
  }
  const cookieFile = writeIgCookieFile();
  if (!cookieFile) {
    setResponseStatus(event, 401);
    return { error: 'Login required for high-quality variants.' };
  }
  // yt-dlp accepts both /reel/<code>/ and /p/<code>/, normalizing
  // internally — `/p/` works for posts and reels alike.
  const url = `https://www.instagram.com/p/${code}/`;
  try {
    const t0 = Date.now();
    const ytArgs = [
      '--dump-single-json',
      '--no-warnings',
      '--no-check-certificate',
      '--no-playlist',
      '--cookies', cookieFile,
      '--user-agent', UA_DESKTOP_124,
      url,
    ];
    const { stdout } = await ytExec(ytArgs);
    const info = JSON.parse(stdout);
    console.log(`[ig-post-versions] ${code} ok in ${Date.now() - t0}ms`);

    if (Array.isArray(info.entries) && info.entries.length) {
      const carousel = info.entries.map(e => ({ videoVersions: igFormatsFromYtDlp(e) }));
      const top = carousel.find(c => c.videoVersions.length)?.videoVersions || [];
      const heights = top.map(v => v.height).join(',');
      console.log(`[ig-post-versions] carousel ${carousel.length} item(s), top heights: ${heights}`);
      return { videoVersions: top, carousel };
    }

    const versions = igFormatsFromYtDlp(info);
    const heights = versions.map(v => v.height).join(',');
    console.log(`[ig-post-versions] heights: ${heights || '(none)'}`);
    return { videoVersions: versions, carousel: null };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[ig-post-versions]', msg.slice(0, 400));
    if (/login.required|requires login|login_required|session/i.test(msg)) {
      invalidateIgSession('ig-post-versions login required');
      setResponseStatus(event, 401);
      return { error: 'Session expired.', loggedOut: true };
    }
    if (/private|not.found|removed|deleted|404/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'Post unavailable (private, removed, or deleted)' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch media info' };
  }
});
