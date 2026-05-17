// YouTube mux state — shared module-scope cache for the two endpoints
// at server/api/yt-{prepare-status,stream}.get.js.
//
// First /api/yt-prepare-status or /api/yt-stream call for a (url, itag)
// pair starts a yt-dlp + ffmpeg process that downloads the chosen video
// format, pairs it with bestaudio[ext=m4a]/bestaudio, and muxes to an
// mp4 temp file. The prepare-status endpoint polls `entry.percent` while
// it runs; the stream endpoint awaits `entry.promise` and serves the
// finished file with Range support.
//
// Entries time out 10 minutes after last access. The cleanup interval
// kills any orphan yt-dlp process and unlinks the temp file.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ytdlpPath, ffmpegPath } = require('./yt-dlp');

const YT_URL_RE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
function normalizeYtUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (YT_URL_RE.test(s)) return s;
  if (/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(s)) return 'https://' + s;
  return null;
}

const YT_BASE_ARGS = [
  '--no-warnings',
  '--no-check-certificate',
  '--ffmpeg-location', ffmpegPath,
  '--js-runtimes', `node:${process.execPath}`,
  '--no-playlist',
];

const ytMuxCache = new Map(); // (url|itag) -> MuxEntry
const YT_CACHE_TTL_MS = 10 * 60 * 1000;
// Keep failed entries cached briefly so a refresh-storm against a permanently
// broken URL doesn't fan out into N concurrent yt-dlp processes.
const YT_FAIL_COOLDOWN_MS = 30 * 1000;

function startMux(url, itag, entry) {
  const tempPath = path.join(
    os.tmpdir(),
    `yeti_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`,
  );
  const args = [
    '-f', `${itag}+bestaudio[ext=m4a]/${itag}+bestaudio/${itag}/best`,
    '--merge-output-format', 'mp4',
    '-o', tempPath,
    '--newline', '--progress',
    ...YT_BASE_ARGS,
    url,
  ];
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

function getMuxEntry(url, itag) {
  const key = `${url}|${itag}`;
  let entry = ytMuxCache.get(key);
  if (entry) {
    if (entry.error && Date.now() - entry.failedAt > YT_FAIL_COOLDOWN_MS) {
      // Cooldown expired — drop the stale failure and re-spawn below.
      ytMuxCache.delete(key);
    } else {
      entry.lastAccess = Date.now();
      return entry;
    }
  }
  entry = {
    url, itag, file: null, error: null, failedAt: 0, proc: null, waiters: 0,
    cacheKey: key,
    percent: 0, lastAccess: Date.now(), promise: null,
  };
  ytMuxCache.set(key, entry);
  entry.promise = startMux(url, itag, entry).catch((err) => {
    entry.error = err;
    entry.failedAt = Date.now();
    throw err;
  });
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ytMuxCache) {
    if (now - entry.lastAccess > YT_CACHE_TTL_MS) {
      ytMuxCache.delete(key);
      if (entry.proc && !entry.proc.killed) entry.proc.kill('SIGKILL');
      if (entry.file) fs.unlink(entry.file, () => {});
    }
  }
}, 60 * 1000).unref();

// Called by the stream endpoint when the last interested client disconnects.
// Kills any running yt-dlp + ffmpeg process and drops the cache entry so the
// next request starts fresh instead of inheriting the killed proc's failure.
function abortMuxEntry(entry) {
  if (!entry) return;
  if (entry.proc && !entry.proc.killed && !entry.file) entry.proc.kill('SIGKILL');
  if (entry.cacheKey) ytMuxCache.delete(entry.cacheKey);
}

module.exports = {
  normalizeYtUrl, YT_BASE_ARGS, getMuxEntry, abortMuxEntry,
};
