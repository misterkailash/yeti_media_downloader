// GET /api/sc-stream?url=...&name=...
import { contentDispoAttachment } from '../utils/util.js';
import { sendFile } from '../utils/send-file.js';
import { normalizeScUrl, getScEntry, abortScEntry } from '../utils/sc-mux.js';

export default defineEventHandler(async (event) => {
  const url = normalizeScUrl(getQuery(event).url);
  const name = getQuery(event).name;
  const req = event.node.req;
  const res = event.node.res;
  if (!url) { res.statusCode = 400; res.end(); return; }

  const dispo = contentDispoAttachment(name, 'mp3');
  const entry = getScEntry(url);
  entry.lastAccess = Date.now();
  entry.waiters++;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.waiters--;
    if (entry.waiters === 0 && !entry.file) abortScEntry(entry);
  };
  req.once('close', release);

  try {
    const filePath = await entry.promise;
    entry.lastAccess = Date.now();
    await sendFile(req, res, filePath, {
      contentType: 'audio/mpeg',
      contentDisposition: dispo,
    });
  } catch (err) {
    console.warn(`[sc-stream] ${err.message}: ${(err.stderr || '').slice(0, 300)}`);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  } finally {
    release();
  }
});
