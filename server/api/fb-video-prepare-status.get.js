// GET /api/fb-video-prepare-status?url=...&formatId=...
import { normalizeFbVideoUrl, resolveFbShareUrl, getFbEntry } from '../utils/fb-mux.js';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const raw = normalizeFbVideoUrl(q.url);
  if (!raw) { setResponseStatus(event, 400); return { error: 'bad request' }; }
  const url = await resolveFbShareUrl(raw);
  const formatId = q.formatId || '';
  const entry = getFbEntry(url, formatId);
  return {
    percent: entry.percent,
    ready: !!entry.file,
    error: entry.error ? String(entry.error.message || entry.error) : null,
  };
});
