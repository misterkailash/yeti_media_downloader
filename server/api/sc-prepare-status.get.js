// GET /api/sc-prepare-status?url=...
import { normalizeScUrl, getScEntry } from '../utils/sc-mux.js';

export default defineEventHandler((event) => {
  const url = normalizeScUrl(getQuery(event).url);
  if (!url) { setResponseStatus(event, 400); return { error: 'bad request' }; }
  const entry = getScEntry(url);
  return {
    percent: entry.percent,
    ready: !!entry.file,
    error: entry.error ? String(entry.error.message || entry.error) : null,
  };
});
