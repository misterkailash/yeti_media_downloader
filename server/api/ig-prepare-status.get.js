// GET /api/ig-prepare-status?url=<ig-post-url>
// Same shape as the other prepare-status endpoints — first call kicks
// off the mux pipeline if there isn't one cached for this shortcode.
import { extractIgShortcode } from '../utils/ig.js';
import { getIgEntry } from '../utils/ig-mux.js';

export default defineEventHandler((event) => {
  const url = String(getQuery(event).url || '').trim();
  const code = extractIgShortcode(url);
  if (!code) {
    setResponseStatus(event, 400);
    return { error: 'bad request' };
  }
  const canonical = `https://www.instagram.com/p/${code}/`;
  const entry = getIgEntry(canonical);
  return {
    percent: entry.percent,
    ready: !!entry.file,
    error: entry.error ? String(entry.error.message || entry.error) : null,
  };
});
