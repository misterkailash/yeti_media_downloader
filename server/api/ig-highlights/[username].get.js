// GET /api/ig-highlights/:username — Instagram highlights tray for a user.
// Returns the list of highlight reels (id + title + cover) for the user.
// Individual reel contents come from /api/ig-highlight/:highlightId.
import { httpsGet } from '../../utils/http.js';
import { IG_SID } from '../../utils/session.js';
import {
  invalidateIgSession, parseIgChallenge, resolveUserId, igAuthedHeaders,
} from '../../utils/ig.js';

export default defineEventHandler(async (event) => {
  if (!IG_SID()) {
    setResponseStatus(event, 401);
    return { error: 'Login required to view highlights.' };
  }
  const username = getRouterParam(event, 'username');

  try {
    const userId = await resolveUserId(username);
    if (!userId) {
      setResponseStatus(event, 404);
      return { error: 'User not found.' };
    }

    const r = await httpsGet(`https://i.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, igAuthedHeaders());

    if (r.status === 401 || r.status === 403) {
      invalidateIgSession(`ig-highlights ${r.status}`);
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
      return { error: 'Failed to fetch highlights.' };
    }

    const j = JSON.parse(r.body);
    if (!j.tray || j.tray.length === 0) {
      return { highlights: [] };
    }

    const highlights = j.tray.map(h => {
      let coverUrl = null;
      if (h.cover_media && h.cover_media.cropped_image_version) {
        coverUrl = h.cover_media.cropped_image_version.url;
      } else if (h.cover_media && h.cover_media.media && h.cover_media.media.image_versions2) {
        coverUrl = h.cover_media.media.image_versions2.candidates[0].url;
      }
      return {
        id: h.id,
        title: h.title || '',
        coverUrl,
        itemCount: h.media_count || 0,
      };
    });

    return { highlights };
  } catch (err) {
    console.error('[ig-highlights]', err.message);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch highlights.' };
  }
});
