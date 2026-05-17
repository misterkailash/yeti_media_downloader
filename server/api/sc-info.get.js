// GET /api/sc-info?url=<soundcloud-url>
// Returns track metadata + estimated 320 kbps MP3 size for the result card.
import { ytExec } from '../utils/yt-dlp.js';
import { normalizeScUrl } from '../utils/sc-mux.js';

export default defineEventHandler(async (event) => {
  const url = normalizeScUrl(getQuery(event).url);
  if (!url) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid SoundCloud URL' };
  }
  try {
    const t0 = Date.now();
    console.log(`[sc-info] start: ${url}`);
    const { stdout } = await ytExec([
      '--dump-single-json',
      '--no-warnings',
      '--no-check-certificate',
      '--no-playlist',
      url,
    ]);
    console.log(`[sc-info] yt-dlp ok in ${Date.now() - t0}ms`);
    const info = JSON.parse(stdout);

    const audioFmts = (info.formats || []).filter(f =>
      (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
    );
    const best = audioFmts.sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0))[0] || null;
    const sourceAbrKbps = best ? Number(best.abr) || 128 : 128;
    const duration = Number(info.duration) || 0;
    const outBitrateKbps = 320;
    const sizeBytes = duration ? Math.round(outBitrateKbps * 1000 / 8 * duration) : 0;

    return {
      id: info.id,
      title: info.title || info.track || '',
      artist: info.uploader || info.artist || info.creator || '',
      description: (info.description || '').slice(0, 300),
      cover: info.thumbnail || '',
      duration,
      sourceBitrate: sourceAbrKbps,
      outputBitrate: outBitrateKbps,
      sizeBytes,
      ext: 'mp3',
    };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[sc-info]', msg.slice(0, 400));
    if (/private|unavailable|not found|410/i.test(msg)) {
      setResponseStatus(event, 404);
      return { error: 'Track unavailable (private, removed, or region-locked)' };
    }
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch track info' };
  }
});
