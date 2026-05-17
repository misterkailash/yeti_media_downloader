// Facebook video mux state — shared by:
//   server/api/fb-video-info.get.js
//   server/api/fb-video-prepare-status.get.js
//   server/api/fb-video-stream.get.js
//
// fbCommonArgs sets a real-browser UA + Accept-Language so FB serves the
// full DASH manifest (HD/FHD) instead of just the SD progressive .mp4.
// Cookies from the active FB session (FB_CKS) get appended when present —
// required for login-gated videos and reels.
//
// resolveFbShareUrl follows /share/r|v|p/<id>/ redirector URLs to the
// canonical /reel/<id>/ or /watch?v=<id>. yt-dlp's Facebook extractor
// doesn't always follow them, so we resolve via HTML scraping first.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ytdlpPath, ffmpegPath } = require('./yt-dlp');
const { httpsGet } = require('./http');
const { UA_DESKTOP_124 } = require('./ua');
const { FB_CKS } = require('./session');

const FB_VIDEO_URL_RE = /^https?:\/\/((www\.|m\.|web\.|mbasic\.)?facebook\.com|fb\.watch)\//i;
function normalizeFbVideoUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (FB_VIDEO_URL_RE.test(s)) return s;
  if (/^((www\.|m\.|web\.|mbasic\.)?facebook\.com|fb\.watch)\//i.test(s)) return 'https://' + s;
  return null;
}

async function resolveFbShareUrl(url) {
  if (!/\/share\/[a-z]\//i.test(url)) return url;
  try {
    const headers = {
      'User-Agent': UA_DESKTOP_124,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (FB_CKS()) headers['Cookie'] = FB_CKS();
    const r = await httpsGet(url, headers);
    const body = r.body || '';
    const isReel = /\/share\/r\//i.test(url);
    const m = body.match(/"video_id"\s*:\s*"(\d{8,})"/)
          || body.match(/\/reel\/(\d{8,})/i)
          || body.match(/\/videos\/(\d{8,})/i)
          || body.match(/\/watch\/?\?v=(\d{8,})/i)
          || body.match(/<meta\s+property="al:android:url"\s+content="fb:\/\/[^"]*?(\d{8,})/i);
    if (m) {
      const id = m[1];
      const resolved = isReel
        ? `https://www.facebook.com/reel/${id}/`
        : `https://www.facebook.com/watch/?v=${id}`;
      console.log(`[fb-share] ${url} -> ${resolved}`);
      return resolved;
    }
    console.warn(`[fb-share] could not resolve ${url} - passing through to yt-dlp`);
  } catch (err) {
    console.warn(`[fb-share] resolve failed for ${url}: ${err.message}`);
  }
  return url;
}

function fbCommonArgs() {
  const args = [
    '--user-agent', UA_DESKTOP_124,
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--no-warnings',
    '--no-check-certificate',
    '--no-playlist',
  ];
  if (FB_CKS()) args.push('--add-header', `Cookie: ${FB_CKS()}`);
  return args;
}

const fbMuxCache = new Map();
const FB_CACHE_TTL_MS = 10 * 60 * 1000;
// Keep failed entries cached briefly so a refresh-storm against a permanently
// broken URL doesn't fan out into N concurrent yt-dlp processes.
const FB_FAIL_COOLDOWN_MS = 30 * 1000;
const fbCacheKey = (url, formatId) => `${formatId || 'best'}|${url}`;

function startFbMux(url, formatId, entry) {
  const tempPath = path.join(
    os.tmpdir(),
    `yeti_fb_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`,
  );
  const formatSpec = formatId
    ? `${formatId}+bestaudio/${formatId}`
    : 'bestvideo*+bestaudio/best';
  const args = [
    '-f', formatSpec,
    '--merge-output-format', 'mp4',
    '-o', tempPath,
    '--newline', '--progress',
    ...fbCommonArgs(),
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

function getFbEntry(url, formatId) {
  const key = fbCacheKey(url, formatId);
  let entry = fbMuxCache.get(key);
  if (entry) {
    if (entry.error && Date.now() - entry.failedAt > FB_FAIL_COOLDOWN_MS) {
      fbMuxCache.delete(key);
    } else {
      entry.lastAccess = Date.now();
      return entry;
    }
  }
  entry = {
    url, formatId, file: null, error: null, failedAt: 0, proc: null, waiters: 0,
    cacheKey: key,
    percent: 0, lastAccess: Date.now(), promise: null,
  };
  fbMuxCache.set(key, entry);
  entry.promise = startFbMux(url, formatId, entry).catch((err) => {
    entry.error = err;
    entry.failedAt = Date.now();
    throw err;
  });
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fbMuxCache) {
    if (now - entry.lastAccess > FB_CACHE_TTL_MS) {
      fbMuxCache.delete(key);
      if (entry.proc && !entry.proc.killed) entry.proc.kill('SIGKILL');
      if (entry.file) fs.unlink(entry.file, () => {});
    }
  }
}, 60 * 1000).unref();

function abortFbEntry(entry) {
  if (!entry) return;
  if (entry.proc && !entry.proc.killed && !entry.file) entry.proc.kill('SIGKILL');
  if (entry.cacheKey) fbMuxCache.delete(entry.cacheKey);
}

module.exports = {
  normalizeFbVideoUrl, resolveFbShareUrl, fbCommonArgs, getFbEntry, abortFbEntry,
};
