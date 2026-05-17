// GET /api/fb-video-stream?url=...&formatId=...&name=...
import { contentDispoAttachment } from '../utils/util.js';
import { sendFile } from '../utils/send-file.js';
import { normalizeFbVideoUrl, resolveFbShareUrl, getFbEntry, abortFbEntry } from '../utils/fb-mux.js';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const raw = normalizeFbVideoUrl(q.url);
  const name = q.name;
  const formatId = q.formatId || '';
  const req = event.node.req;
  const res = event.node.res;
  if (!raw) { res.statusCode = 400; res.end(); return; }
  const url = await resolveFbShareUrl(raw);

  const dispo = contentDispoAttachment(name, 'mp4');
  const entry = getFbEntry(url, formatId);
  entry.lastAccess = Date.now();
  entry.waiters++;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.waiters--;
    if (entry.waiters === 0 && !entry.file) abortFbEntry(entry);
  };
  req.once('close', release);

  try {
    const filePath = await entry.promise;
    entry.lastAccess = Date.now();
    await sendFile(req, res, filePath, {
      contentType: 'video/mp4',
      contentDisposition: dispo,
    });
  } catch (err) {
    console.warn(`[fb-video-stream] ${err.message}: ${(err.stderr || '').slice(0, 300)}`);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  } finally {
    release();
  }
});
