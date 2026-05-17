// GET /api/ig-highlight/:highlightId — items in a single highlight reel.
// Pass either the bare numeric ID or the `highlight:<id>` form; we coerce.
import { httpsGet } from '../../utils/http.js';
import { IG_SID } from '../../utils/session.js';
import {
  invalidateIgSession, parseIgChallenge, igVideoVersions, igAuthedHeaders,
} from '../../utils/ig.js';

export default defineEventHandler(async (event) => {
  if (!IG_SID()) {
    setResponseStatus(event, 401);
    return { error: 'Login required.' };
  }
  const highlightId = getRouterParam(event, 'highlightId');

  try {
    const reelId = highlightId.startsWith('highlight:') ? highlightId : `highlight:${highlightId}`;
    const r = await httpsGet(`https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`, igAuthedHeaders());

    if (r.status === 401 || r.status === 403) {
      invalidateIgSession(`ig-highlight ${r.status}`);
      setResponseStatus(event, 401);
      return { error: 'Session expired.', loggedOut: true };
    }
    if (r.status !== 200) {
      const ch = parseIgChallenge(r.body);
      if (ch.required) {
        setResponseStatus(event, 401);
        return {
          error: 'Instagram requires verification for this login.',
          challengeRequired: true,
          challengeUrl: ch.url,
        };
      }
      setResponseStatus(event, r.status);
      return { error: 'Failed to fetch highlight items.' };
    }

    const j = JSON.parse(r.body);
    const reels = j.reels || j.reels_media;
    const reel = reels ? reels[reelId] || Object.values(reels)[0] : null;

    if (!reel || !reel.items || reel.items.length === 0) {
      return { items: [] };
    }

    const items = reel.items.map(item => {
      const isVideo = item.media_type === 2 || item.video_versions;
      let thumbnail = null;
      if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length) {
        thumbnail = item.image_versions2.candidates[0].url;
      }
      let videoUrl = null;
      let videoVersions = [];
      if (isVideo && item.video_versions && item.video_versions.length) {
        videoVersions = igVideoVersions(item.video_versions);
        videoUrl = videoVersions[0]?.url || item.video_versions[0].url;
      }
      return {
        id: item.pk || item.id,
        type: isVideo ? 'video' : 'image',
        thumbnail,
        videoUrl,
        videoVersions,
        timestamp: item.taken_at,
      };
    });

    return { items, title: reel.title || '' };
  } catch (err) {
    console.error('[ig-highlight]', err.message);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch highlight items.' };
  }
});
