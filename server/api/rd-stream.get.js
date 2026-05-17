// GET /api/rd-stream?url=...&name=...
import { contentDispoAttachment } from '../utils/util.js';
import { sendFile } from '../utils/send-file.js';
import { normalizeRdUrl, resolveRedditShareUrl, getRdEntry, abortRdEntry } from '../utils/rd-mux.js';

export default defineEventHandler(async (event) => {
  let url = normalizeRdUrl(getQuery(event).url);
  const name = getQuery(event).name;
  const req = event.node.req;
  const res = event.node.res;
  if (!url) { res.statusCode = 400; res.end(); return; }
  url = await resolveRedditShareUrl(url);

  const dispo = contentDispoAttachment(name, 'mp4');
  const entry = getRdEntry(url);
  entry.lastAccess = Date.now();
  entry.waiters++;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.waiters--;
    if (entry.waiters === 0 && !entry.file) abortRdEntry(entry);
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
    console.warn(`[rd-stream] ${err.message}: ${(err.stderr || '').slice(0, 300)}`);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  } finally {
    release();
  }
});
