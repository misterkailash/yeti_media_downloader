// GET /api/yt-info?url=<youtube-url>
// Runs yt-dlp --dump-single-json, buckets formats by (height, fps), picks
// the best per bucket, and returns the qualities array the frontend
// renders as the picker.
import { ytExec } from '../utils/yt-dlp.js';
import { normalizeYtUrl, YT_BASE_ARGS } from '../utils/yt-mux.js';

export default defineEventHandler(async (event) => {
  const url = normalizeYtUrl(getQuery(event).url);
  if (!url) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid YouTube URL' };
  }
  try {
    const t0 = Date.now();
    console.log(`[yt-info] start: ${url}`);
    const { stdout, stderr } = await ytExec([
      '--dump-single-json',
      '--prefer-free-formats',
      ...YT_BASE_ARGS,
      url,
    ]);
    console.log(`[yt-info] yt-dlp ok in ${Date.now() - t0}ms (stdout=${stdout.length}b, stderr=${stderr.length}b)`);
    const info = JSON.parse(stdout);

    const buckets = new Map();
    const knownSize = (f) => Number(f.filesize) || Number(f.filesize_approx) || 0;
    const isHls = (f) => /m3u8/i.test(f.protocol || '');
    const score = (f) =>
      (f.ext === 'mp4' ? 1000 : 0) +
      (knownSize(f) > 0 ? 500 : 0) +
      (Number(f.tbr) || 0);
    for (const f of info.formats || []) {
      if (!f.vcodec || f.vcodec === 'none') continue;
      if (!f.height) continue;
      if (isHls(f)) continue;
      const fpsKey = f.fps && f.fps > 30 ? f.fps : 30;
      const key = `${f.height}_${fpsKey}`;
      const prev = buckets.get(key);
      if (!prev || score(f) > score(prev)) buckets.set(key, f);
    }
    const audioFormats = (info.formats || []).filter(f => (f.acodec && f.acodec !== 'none') && (!f.vcodec || f.vcodec === 'none'));
    const audioFmt =
      audioFormats.find(f => f.format_id === '140') ||
      audioFormats.find(f => f.ext === 'm4a') ||
      audioFormats.sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0))[0];
    const duration = Number(info.duration) || 0;
    const audioBytes = audioFmt
      ? (Number(audioFmt.filesize) || Number(audioFmt.filesize_approx) || Math.round(((Number(audioFmt.abr) || 128) * 1000 / 8) * duration))
      : Math.round(128 * 1000 / 8 * duration);
    const MUX_OVERHEAD = 256 * 1024;
    const qualities = [...buckets.values()]
      .sort((a, b) => (b.height - a.height) || ((b.fps || 0) - (a.fps || 0)))
      .map(f => {
        const hasAudio = f.acodec && f.acodec !== 'none';
        const declaredV = knownSize(f);
        const tbr = Number(f.tbr) || 0;
        const estimatedV = duration && tbr ? Math.round(tbr * 1000 / 8 * duration) : 0;
        const videoBytes = declaredV || estimatedV;
        const sizeBytes = hasAudio ? videoBytes : videoBytes + audioBytes + MUX_OVERHEAD;
        return {
          itag: String(f.format_id),
          label: `${f.height}p${f.fps && f.fps > 30 ? f.fps : ''}`,
          height: f.height,
          fps: f.fps || 30,
          ext: f.ext || 'mp4',
          codec: f.vcodec || '',
          sizeBytes,
          sizeApprox: !declaredV,
          bitrate: Math.round(tbr * 1000),
          needsMux: !hasAudio,
        };
      });

    if (qualities.length === 0) {
      setResponseStatus(event, 404);
      return { error: 'No downloadable video streams found' };
    }
    return {
      id: info.id,
      title: info.title || '',
      author: info.uploader || info.channel || '',
      channel: info.channel || info.uploader || '',
      description: (info.description || '').slice(0, 300),
      cover: info.thumbnail || '',
      duration: info.duration || 0,
      qualities,
    };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[yt-info]', msg.slice(0, 400));
    if (/private|unavailable|removed|members.only|sign in/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'Video unavailable (private, removed, or sign-in required)' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch video info' };
  }
});
