// Instagram mux state — used by:
//   server/api/ig-prepare-status.get.js
//   server/api/ig-stream.get.js
//
// IG often serves video + audio as separate DASH streams. yt-dlp's
// bestvideo*+bestaudio/best picks the right pair and ffmpeg merges them
// into a single mp4. Cookies are attached when the per-browser IG session
// is set — without them yt-dlp's anonymous fetch can return a video-only
// stream (silent download).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ytdlpPath, ffmpegPath } = require('./yt-dlp');
const { UA_DESKTOP_124 } = require('./ua');
const { IG_SID } = require('./session');
const { writeIgCookieFile } = require('./ig');

const igMuxCache = new Map();
const IG_CACHE_TTL_MS = 10 * 60 * 1000;
// Keep failed entries cached briefly so a refresh-storm against a permanently
// broken URL doesn't fan out into N concurrent yt-dlp processes.
const IG_FAIL_COOLDOWN_MS = 30 * 1000;

function startIgMux(url, entry) {
  const tempPath = path.join(
    os.tmpdir(),
    `yeti_ig_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`,
  );
  const args = [
    '-f', 'bestvideo*+bestaudio/best',
    '--merge-output-format', 'mp4',
    '-o', tempPath,
    '--newline', '--progress',
    '--no-warnings', '--no-check-certificate', '--no-playlist',
    '--user-agent', UA_DESKTOP_124,
    '--ffmpeg-location', ffmpegPath,
  ];
  if (IG_SID()) {
    const cookieFile = writeIgCookieFile();
    if (cookieFile) args.push('--cookies', cookieFile);
  }
  args.push(url);
  const proc = spawn(ytdlpPath || 'yt-dlp', args, { windowsHide: true });
  entry.proc = proc;
  let stderrBuf = '';
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
  proc.stdout.on('data', (chunk) => {
    const m = chunk.toString().match(/(\d+(?:\.\d+)?)%/g);
    if (m && m.length) {
      const last = m[m.length - 1];
      entry.percent = Math.min(100, Number(last.slice(0, -1)));
    }
  });
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        fs.unlink(tempPath, () => {});
        const err = new Error(`yt-dlp exited ${code}`);
        err.stderr = stderrBuf;
        return reject(err);
      }
      entry.percent = 100;
      entry.file = tempPath;
      resolve(tempPath);
    });
  });
}

function getIgEntry(url) {
  let entry = igMuxCache.get(url);
  if (entry) {
    if (entry.error && Date.now() - entry.failedAt > IG_FAIL_COOLDOWN_MS) {
      igMuxCache.delete(url);
    } else {
      entry.lastAccess = Date.now();
      return entry;
    }
  }
  entry = {
    url, file: null, error: null, failedAt: 0, proc: null, waiters: 0,
    cacheKey: url,
    percent: 0, lastAccess: Date.now(), promise: null,
  };
  igMuxCache.set(url, entry);
  entry.promise = startIgMux(url, entry).catch((err) => {
    entry.error = err;
    entry.failedAt = Date.now();
    throw err;
  });
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of igMuxCache) {
    if (now - entry.lastAccess > IG_CACHE_TTL_MS) {
      igMuxCache.delete(key);
      if (entry.proc && !entry.proc.killed) entry.proc.kill('SIGKILL');
      if (entry.file) fs.unlink(entry.file, () => {});
    }
  }
}, 60 * 1000).unref();

function abortIgEntry(entry) {
  if (!entry) return;
  if (entry.proc && !entry.proc.killed && !entry.file) entry.proc.kill('SIGKILL');
  if (entry.cacheKey) igMuxCache.delete(entry.cacheKey);
}

module.exports = { getIgEntry, abortIgEntry };
