// GET /api/ig-stories/:username — Instagram stories for a user.
//
// Always requires an IG session — IG no longer exposes story reels without
// auth. 401/403 from upstream invalidates the saved session (the cookie is
// dead, no point keeping it around). `challenge_required` responses get
// surfaced as a "verification required" message with the challenge URL.
import { httpsGet } from '../../utils/http.js';
import { IG_SID, IG_DS_ID } from '../../utils/session.js';
import {
  invalidateIgSession, parseIgChallenge, resolveUserId, igVideoVersions, igAuthedHeaders,
} from '../../utils/ig.js';

export default defineEventHandler(async (event) => {
  if (!IG_SID()) {
    setResponseStatus(event, 401);
    return { error: 'Login required to view stories.' };
  }
  const username = getRouterParam(event, 'username');

  try {
    const userId = await resolveUserId(username);
    if (!userId) {
      setResponseStatus(event, 404);
      return { error: 'User not found.' };
    }

    const r = await httpsGet(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, igAuthedHeaders());

    if (r.status === 401 || r.status === 403) {
      invalidateIgSession(`ig-stories ${r.status}`);
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
      return { error: 'Failed to fetch stories.' };
    }

    const j = JSON.parse(r.body);
    const reel = j.reel;
    if (!reel || !reel.items || reel.items.length === 0) {
      return { stories: [] };
    }

    const stories = reel.items.map(item => {
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
        expiringAt: item.expiring_at,
      };
    });

    return { stories };
  } catch (err) {
    console.error('[ig-stories]', err.message);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch stories.' };
  }
});
