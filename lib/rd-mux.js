// Reddit mux state — same shape as lib/yt-mux.js but keyed only on URL
// (Reddit videos don't have format-selectable qualities; yt-dlp picks the
// best available DASH stream + audio and ffmpeg muxes them).
//
// Used by server/api/rd-{info,prepare-status,stream}.get.js. The info
// endpoint also runs yt-dlp --dump-single-json to enumerate metadata
// (resolution, duration, estimated size) for the result card.
//
// resolveRedditShareUrl mirrors the helper that lives in server.js for as
// long as that file still has the Reddit endpoints. /r/<sub>/s/<id> share
// links 302-redirect to /comments/<postId>/...; yt-dlp's extractor doesn't
// follow them, so we resolve via HEAD and pass the canonical URL down.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ytdlpPath, ffmpegPath } = require('./yt-dlp');
const { httpHead } = require('./http');

const RD_URL_RE = /^https?:\/\/((www\.|old\.|new\.|np\.|m\.)?reddit\.com|redd\.it|v\.redd\.it)\//i;
function normalizeRdUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (RD_URL_RE.test(s)) return s;
  if (/^((www\.|old\.|new\.|np\.|m\.)?reddit\.com|redd\.it|v\.redd\.it)\//i.test(s)) return 'https://' + s;
  return null;
}

const RD_SHARE_RESOLVE = new Map();
async function resolveRedditShareUrl(url) {
  if (!/^https?:\/\/[^/]*reddit\.com\/r\/[^/]+\/s\/[A-Za-z0-9_-]+\/?(?:\?|$)/i.test(url)) {
    return url;
  }
  const cached = RD_SHARE_RESOLVE.get(url);
  if (cached) return cached;
  try {
    const head = await httpHead(url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    if (head.url && head.url !== url && /\/comments\//i.test(head.url)) {
      console.log(`[rd-share] ${url} -> ${head.url}`);
      RD_SHARE_RESOLVE.set(url, head.url);
      return head.url;
    }
  } catch (_) { /* ignore */ }
  return url;
}

const rdMuxCache = new Map();
const RD_CACHE_TTL_MS = 10 * 60 * 1000;
// Keep failed entries cached briefly so a refresh-storm against a permanently
// broken URL doesn't fan out into N concurrent yt-dlp processes.
const RD_FAIL_COOLDOWN_MS = 30 * 1000;

function startRdMux(url, entry) {
  const tempPath = path.join(
    os.tmpdir(),
    `yeti_rd_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`,
  );
  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '-o', tempPath,
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

function getRdEntry(url) {
  let entry = rdMuxCache.get(url);
  if (entry) {
    if (entry.error && Date.now() - entry.failedAt > RD_FAIL_COOLDOWN_MS) {
      rdMuxCache.delete(url);
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
  rdMuxCache.set(url, entry);
  entry.promise = startRdMux(url, entry).catch((err) => {
    entry.error = err;
    entry.failedAt = Date.now();
    throw err;
  });
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rdMuxCache) {
    if (now - entry.lastAccess > RD_CACHE_TTL_MS) {
      rdMuxCache.delete(key);
      if (entry.proc && !entry.proc.killed) entry.proc.kill('SIGKILL');
      if (entry.file) fs.unlink(entry.file, () => {});
    }
  }
}, 60 * 1000).unref();

function abortRdEntry(entry) {
  if (!entry) return;
  if (entry.proc && !entry.proc.killed && !entry.file) entry.proc.kill('SIGKILL');
  if (entry.cacheKey) rdMuxCache.delete(entry.cacheKey);
}

module.exports = { normalizeRdUrl, resolveRedditShareUrl, getRdEntry, abortRdEntry };
