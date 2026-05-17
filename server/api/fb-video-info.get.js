// GET /api/fb-video-info?url=<facebook-video-url>
// Returns metadata + per-height qualities for the picker.
import { ytExec } from '../utils/yt-dlp.js';
import { normalizeFbVideoUrl, resolveFbShareUrl, fbCommonArgs } from '../utils/fb-mux.js';

export default defineEventHandler(async (event) => {
  const raw = normalizeFbVideoUrl(getQuery(event).url);
  if (!raw) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid Facebook video URL' };
  }
  const url = await resolveFbShareUrl(raw);
  try {
    const t0 = Date.now();
    console.log(`[fb-video-info] start: ${url}`);
    const ytArgs = ['--dump-single-json', ...fbCommonArgs(), url];
    const { stdout } = await ytExec(ytArgs);
    console.log(`[fb-video-info] yt-dlp ok in ${Date.now() - t0}ms`);
    const info = JSON.parse(stdout);

    const videoFmts = (info.formats || []).filter(f => f.vcodec && f.vcodec !== 'none' && f.height);
    const audioFmts = (info.formats || []).filter(f =>
      (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
    );
    const bestAudio = audioFmts.sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0))[0];
    const duration = Number(info.duration) || 0;

    const knownSize = (f) => Number(f.filesize) || Number(f.filesize_approx) || 0;
    const estFromTbr = (f, kind) => {
      const r = kind === 'audio' ? Number(f.abr) || 128 : Number(f.tbr) || 0;
      return duration && r ? Math.round(r * 1000 / 8 * duration) : 0;
    };

    const byHeight = new Map();
    for (const f of videoFmts) {
      const h = f.height;
      const tbr = Number(f.tbr) || 0;
      const prev = byHeight.get(h);
      if (!prev || tbr > (Number(prev.tbr) || 0)) byHeight.set(h, f);
    }
    const sortedFmts = Array.from(byHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
    if (!sortedFmts.length) {
      setResponseStatus(event, 404);
      return { error: 'No video found at this URL' };
    }

    const audioInline = (f) => f.acodec && f.acodec !== 'none';
    const qualities = sortedFmts.map(f => {
      const known = knownSize(f);
      const est = known || estFromTbr(f, 'video');
      const audioBytes = audioInline(f)
        ? 0
        : (bestAudio ? (knownSize(bestAudio) || estFromTbr(bestAudio, 'audio')) : 0);
      const sizeBytes = est + audioBytes + (audioBytes > 0 ? 200 * 1024 : 0);
      return {
        formatId: f.format_id,
        label: `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}`,
        height: f.height,
        fps: f.fps || 0,
        tbr: Number(f.tbr) || 0,
        sizeBytes,
        sizeApprox: !known,
      };
    });

    const top = sortedFmts[0];
    return {
      id: info.id,
      title: info.title || info.uploader || '',
      author: info.uploader || info.creator || '',
      description: (info.description || '').slice(0, 300),
      cover: info.thumbnail || '',
      duration,
      width: top.width || 0,
      height: top.height || 0,
      sizeBytes: qualities[0].sizeBytes,
      qualities,
    };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[fb-video-info]', msg.slice(0, 400));
    if (/login.required|requires login|login_required|cookies/i.test(msg)) {
      setResponseStatus(event, 401);
      return { error: 'This video requires login. Log in with Facebook in the sidebar first.' };
    }
    if (/not.found|removed|deleted|private|410|404/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'Video unavailable (removed, private, or deleted)' };
    }
    if (/no video|unsupported url/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'No downloadable video at this URL' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch video info' };
  }
});
