// POST /api/album-zip
// Body: { name, items: [{ url, ext, name }, ...] }
//
// Fetches every slide server-side from the allowed CDNs, packs them into a
// store-mode zip, and returns the whole thing as one download. Workaround
// for Chrome's "only the first programmatic download fires" rule.
import { fetchBinary, buildZip } from '../utils/album-zip.js';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const items = Array.isArray(body?.items) ? body.items : [];
    const zipName = (body?.name || 'album').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'album';
    if (!items.length || items.length > 30) {
      setResponseStatus(event, 400);
      return { error: 'invalid items' };
    }

    const results = await Promise.all(items.map(async (it, i) => {
      if (!it.url || typeof it.url !== 'string') return null;
      const buf = await fetchBinary(it.url);
      if (!buf) return null;
      const ext = it.ext || (buf[0] === 0xFF && buf[1] === 0xD8 ? 'jpg' : 'mp4');
      const safeName = String(it.name || `${i + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      return { name: `${safeName}.${ext}`, data: buf };
    }));
    const entries = results.filter(Boolean);
    if (!entries.length) {
      setResponseStatus(event, 502);
      return { error: 'no items fetched' };
    }

    const zip = buildZip(entries);
    setHeader(event, 'Content-Type', 'application/zip');
    setHeader(event, 'Content-Length', zip.length);
    setHeader(event, 'Content-Disposition', `attachment; filename="${zipName}.zip"`);
    return zip;
  } catch (err) {
    console.warn('[album-zip]', err.message);
    setResponseStatus(event, 500);
    return { error: 'zip failed' };
  }
});
