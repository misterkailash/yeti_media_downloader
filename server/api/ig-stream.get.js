// GET /api/ig-stream?url=<ig-post-url>&name=<basename>
// Awaits the muxed mp4 for this shortcode and streams it back with
// Range support so IDM-style download managers handle it natively.
import { extractIgShortcode } from '../utils/ig.js';
import { sendFile } from '../utils/send-file.js';
import { getIgEntry, abortIgEntry } from '../utils/ig-mux.js';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const url = String(q.url || '').trim();
  const name = q.name;
  const req = event.node.req;
  const res = event.node.res;

  const code = extractIgShortcode(url);
  if (!code) { res.statusCode = 400; res.end(); return; }

  const canonical = `https://www.instagram.com/p/${code}/`;
  const safe = name
    ? String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    : `instagram_${code}`;
  const entry = getIgEntry(canonical);
  entry.lastAccess = Date.now();
  entry.waiters++;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.waiters--;
    if (entry.waiters === 0 && !entry.file) abortIgEntry(entry);
  };
  req.once('close', release);

  try {
    const filePath = await entry.promise;
    entry.lastAccess = Date.now();
    await sendFile(req, res, filePath, {
      contentType: 'video/mp4',
      contentDisposition: `attachment; filename="${safe}.mp4"`,
    });
  } catch (err) {
    console.warn(`[ig-stream] ${err.message}: ${(err.stderr || '').slice(0, 300)}`);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  } finally {
    release();
  }
});
