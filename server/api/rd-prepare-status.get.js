// GET /api/rd-prepare-status?url=...
import { normalizeRdUrl, resolveRedditShareUrl, getRdEntry } from '../utils/rd-mux.js';

export default defineEventHandler(async (event) => {
  let url = normalizeRdUrl(getQuery(event).url);
  if (!url) {
    setResponseStatus(event, 400);
    return { error: 'bad request' };
  }
  url = await resolveRedditShareUrl(url);
  const entry = getRdEntry(url);
  return {
    percent: entry.percent,
    ready: !!entry.file,
    error: entry.error ? String(entry.error.message || entry.error) : null,
  };
});
