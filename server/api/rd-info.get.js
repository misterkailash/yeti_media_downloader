// GET /api/rd-info?url=<reddit-url>
// Returns metadata for the result card (resolution, duration, estimated
// size). The actual mux happens lazily on first prepare-status/stream
// call against the same URL.
import { ytExec } from '../utils/yt-dlp.js';
import { normalizeRdUrl, resolveRedditShareUrl } from '../utils/rd-mux.js';

export default defineEventHandler(async (event) => {
  let url = normalizeRdUrl(getQuery(event).url);
  if (!url) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid Reddit URL' };
  }
  url = await resolveRedditShareUrl(url);
  try {
    const t0 = Date.now();
    console.log(`[rd-info] start: ${url}`);
    const { stdout } = await ytExec([
      '--dump-single-json',
      '--no-warnings',
      '--no-check-certificate',
      '--no-playlist',
      url,
    ]);
    console.log(`[rd-info] yt-dlp ok in ${Date.now() - t0}ms`);
    const info = JSON.parse(stdout);

    const videoFmts = (info.formats || []).filter(f => f.vcodec && f.vcodec !== 'none' && f.height);
    const bestVideo = videoFmts.sort((a, b) =>
      (b.height || 0) - (a.height || 0) || (Number(b.tbr) || 0) - (Number(a.tbr) || 0)
    )[0];
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
    const videoBytes = bestVideo ? (knownSize(bestVideo) || estFromTbr(bestVideo, 'video')) : 0;
    const hasAudioInline = bestVideo && bestVideo.acodec && bestVideo.acodec !== 'none';
    const audioBytes = hasAudioInline ? 0 : (bestAudio ? (knownSize(bestAudio) || estFromTbr(bestAudio, 'audio')) : 0);
    const MUX_OVERHEAD = 200 * 1024;
    const sizeBytes = videoBytes + audioBytes + (audioBytes > 0 ? MUX_OVERHEAD : 0);

    if (!bestVideo) {
      setResponseStatus(event, 404);
      return { error: 'No video found in this Reddit post' };
    }
    return {
      id: info.id,
      title: info.title || '',
      author: info.uploader || info.creator || '',
      description: (info.description || '').slice(0, 300),
      cover: info.thumbnail || '',
      duration,
      width: bestVideo.width || 0,
      height: bestVideo.height || 0,
      sizeBytes,
    };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[rd-info]', msg.slice(0, 400));
    if (/not.found|removed|deleted|private|410/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'Post unavailable (removed, private, or deleted)' };
    }
    if (/no video|unsupported url/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'No downloadable video in this post (text/image-only posts not supported yet)' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch post info' };
  }
});
