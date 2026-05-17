// SoundCloud mux state — yt-dlp -x mp3 with `ffmpeg:-b:a 320k` produces a
// 320 kbps CBR MP3. Transcoding from a 128 kbps source doesn't add real
// audio quality, but the output file genuinely measures 320 kbps so a
// player or DAW that filters by bitrate accepts it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ytdlpPath, ffmpegPath } = require('./yt-dlp');

const SC_URL_RE = /^https?:\/\/(www\.|m\.)?soundcloud\.com\//i;
function normalizeScUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (SC_URL_RE.test(s)) return s;
  if (/^(www\.|m\.)?soundcloud\.com\//i.test(s)) return 'https://' + s;
  return null;
}

const scMuxCache = new Map();
const SC_CACHE_TTL_MS = 10 * 60 * 1000;
// Keep failed entries cached briefly so a refresh-storm against a permanently
// broken URL doesn't fan out into N concurrent yt-dlp processes.
const SC_FAIL_COOLDOWN_MS = 30 * 1000;

function startScMux(url, entry) {
  const tempBase = path.join(
    os.tmpdir(),
    `yeti_sc_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const tempPath = tempBase + '.mp3';
  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--postprocessor-args', 'ffmpeg:-b:a 320k',
    '-o', tempBase + '.%(ext)s',
    '--newline', '--progress',
    '--no-playlist', '--no-warnings', '--no-check-certificate',
    '--ffmpeg-location', ffmpegPath,
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
      // Cap at 95% — the ffmpeg postprocess restarts at 0% and would
      // otherwise make the UI bounce backwards.
      entry.percent = Math.min(95, Number(last.slice(0, -1)));
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
      fs.stat(tempPath, (statErr) => {
        if (statErr) {
          const e = new Error(`mp3 output missing: ${statErr.message}`);
          e.stderr = stderrBuf;
          return reject(e);
        }
        entry.percent = 100;
        entry.file = tempPath;
        resolve(tempPath);
      });
    });
  });
}

function getScEntry(url) {
  let entry = scMuxCache.get(url);
  if (entry) {
    if (entry.error && Date.now() - entry.failedAt > SC_FAIL_COOLDOWN_MS) {
      scMuxCache.delete(url);
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
  scMuxCache.set(url, entry);
  entry.promise = startScMux(url, entry).catch((err) => {
    entry.error = err;
    entry.failedAt = Date.now();
    throw err;
  });
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of scMuxCache) {
    if (now - entry.lastAccess > SC_CACHE_TTL_MS) {
      scMuxCache.delete(key);
      if (entry.proc && !entry.proc.killed) entry.proc.kill('SIGKILL');
      if (entry.file) fs.unlink(entry.file, () => {});
    }
  }
}, 60 * 1000).unref();

function abortScEntry(entry) {
  if (!entry) return;
  if (entry.proc && !entry.proc.killed && !entry.file) entry.proc.kill('SIGKILL');
  if (entry.cacheKey) scMuxCache.delete(entry.cacheKey);
}

module.exports = { normalizeScUrl, getScEntry, abortScEntry };
