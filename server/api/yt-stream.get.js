// GET /api/yt-stream?url=...&itag=...&name=...
//
// Awaits the in-flight mux (started by /api/yt-prepare-status or by this
// endpoint on first call) then streams the muxed mp4 via sendFile —
// Range-aware so the browser's pause/resume and IDM-style download
// managers work natively. The "Preparing X%" indicator on the frontend
// drives the user-facing progress; once it hits 100% the frontend
// navigates here and the file is served instantly.
import { contentDispoAttachment } from '../utils/util.js';
import { sendFile } from '../utils/send-file.js';
import { normalizeYtUrl, getMuxEntry, abortMuxEntry } from '../utils/yt-mux.js';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const url = normalizeYtUrl(q.url);
  const itag = q.itag;
  const name = q.name;
  const req = event.node.req;
  const res = event.node.res;

  if (!url || !itag) { res.statusCode = 400; res.end(); return; }

  const dispo = contentDispoAttachment(name, 'mp4');
  const entry = getMuxEntry(url, itag);
  entry.lastAccess = Date.now();
  entry.waiters++;

  // When the last interested client disconnects before the file is ready,
  // kill yt-dlp + ffmpeg so an abandoned tab doesn't burn CPU/disk for
  // the full 10-min TTL window.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.waiters--;
    if (entry.waiters === 0 && !entry.file) abortMuxEntry(entry);
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
    console.warn(`[yt-stream] ${err.message}: ${(err.stderr || '').slice(0, 300)}`);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  } finally {
    release();
  }
});
