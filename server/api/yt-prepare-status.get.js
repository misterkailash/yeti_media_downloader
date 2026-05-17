// GET /api/yt-prepare-status?url=...&itag=...
//
// Frontend polls this while showing "Preparing X%". First call also
// starts the mux pipeline (getMuxEntry kicks off yt-dlp on cache miss),
// so the server begins working as soon as the user clicks download.
import { normalizeYtUrl, getMuxEntry } from '../utils/yt-mux.js';

export default defineEventHandler((event) => {
  const q = getQuery(event);
  const url = normalizeYtUrl(q.url);
  const itag = q.itag;
  if (!url || !itag) {
    setResponseStatus(event, 400);
    return { error: 'bad request' };
  }
  const entry = getMuxEntry(url, itag);
  entry.lastAccess = Date.now();
  return {
    percent: entry.percent,
    ready: !!entry.file,
    error: entry.error ? String(entry.error.message || entry.error) : null,
  };
});
