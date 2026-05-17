// POST /api/ig-bulk-zip
// Body: { name, items: [{ url, ext, name }, ...] }
//
// Bulk-download companion to /api/album-zip — same wire format, same
// allowlisted CDNs (IG/FB), but a higher item ceiling for the IG profile
// "Download all photos / reels / videos / stories / highlights" buttons.
// Single-post album zipping should keep using /api/album-zip; this one is
// for whole-tab bulk downloads driven by InstagramTabs.
import { fetchBinary, buildZip } from '../utils/album-zip.js';

const MAX_ITEMS = 200;

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const items = Array.isArray(body?.items) ? body.items : [];
    const zipName = (body?.name || 'instagram_bulk').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'instagram_bulk';
    if (!items.length) {
      setResponseStatus(event, 400);
      return { error: 'no items' };
    }
    if (items.length > MAX_ITEMS) {
      setResponseStatus(event, 400);
      return { error: `too many items (max ${MAX_ITEMS})` };
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
    console.warn('[ig-bulk-zip]', err.message);
    setResponseStatus(event, 500);
    return { error: 'zip failed' };
  }
});
