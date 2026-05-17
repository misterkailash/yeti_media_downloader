// Range-aware sendFile for the muxed-mp4 stream endpoints. Express's
// res.sendFile() handles Range / Content-Length / conditional GET out of
// the box; Nitro / h3 doesn't, so we reimplement just enough to make IDM
// happy: byte-range parsing, 206 partial responses, Content-Length, and
// Accept-Ranges. Falls back to a full-file 200 when there's no Range.
const fs = require('fs');

function sendFile(req, res, filePath, { contentType, contentDisposition } = {}) {
  return new Promise((resolve) => {
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        if (!res.headersSent) { res.statusCode = 500; res.end(); }
        return resolve();
      }
      const size = stat.size;
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      let start = 0;
      let end = size - 1;
      let status = 200;

      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          const a = m[1] ? parseInt(m[1], 10) : NaN;
          const b = m[2] ? parseInt(m[2], 10) : NaN;
          if (Number.isFinite(a) && Number.isFinite(b)) { start = a; end = b; }
          else if (Number.isFinite(a)) { start = a; }
          else if (Number.isFinite(b)) { start = Math.max(0, size - b); }
          if (start > end || end >= size) { end = size - 1; }
          if (start <= end) {
            status = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          } else {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            res.end();
            return resolve();
          }
        }
      }

      res.statusCode = status;
      res.setHeader('Content-Length', (end - start + 1).toString());

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => { if (!res.headersSent) { res.statusCode = 500; res.end(); } resolve(); });
      stream.pipe(res);
      res.on('finish', resolve);
      // On client abort, destroy the ReadStream so its file descriptor is
      // released immediately instead of waiting for GC.
      res.on('close', () => { stream.destroy(); resolve(); });
    });
  });
}

module.exports = { sendFile };
