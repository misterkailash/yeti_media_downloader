// GET /api/tt-video?url=<tiktok-url>
//
// Multi-tier HD extraction:
//   1. Race ssstik.io and tikdownloader.io in parallel — both can return
//      the original 1080p (no watermark) via TikTok's own CDN. Whichever
//      returns HD first wins; otherwise either's SD link is taken.
//   2. TikTok mobile API (often region-blocked but a clean HD path when
//      it works).
//   3. tikwm.com — 720p no-watermark re-encode.
//   4. Webscrape — watermarked HD from the canonical TikTok page.
//
// Photo slideshows go through tikwm only (images[] array of JPEGs) and
// are returned as kind:'photo' so the frontend can album-zip them.
import { httpsGet } from '../utils/http.js';
import { httpHead } from '../utils/http.js';
import { UA_DESKTOP_120 } from '../utils/ua.js';
import {
  fetchSsstik, fetchTikdownloader, fetchTtMobileApi, fetchTikwm,
  resolveTtVideoUrl,
} from '../utils/tt.js';

const PROFILE_HINT = 'This looks like a TikTok profile, not a video. Switch to the TikTok DP tab to download the profile picture.';

export default defineEventHandler(async (event) => {
  const rawUrl = String((getQuery(event).url || '')).trim();

  if (rawUrl && /^@?[A-Za-z0-9._]+$/.test(rawUrl)) {
    setResponseStatus(event, 400);
    return { error: PROFILE_HINT };
  }
  if (!rawUrl || !/^https?:\/\/[^/]*tiktok\.com\//i.test(rawUrl)) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid TikTok video URL' };
  }
  if (/tiktok\.com\/@[A-Za-z0-9._]+\/?(?:\?|#|$)/i.test(rawUrl)) {
    setResponseStatus(event, 400);
    return { error: PROFILE_HINT };
  }

  try {
    const resolvedUrl = await resolveTtVideoUrl(rawUrl);
    const videoMatch = resolvedUrl.match(/\/video\/(\d+)/);
    const photoMatch = resolvedUrl.match(/\/photo\/(\d+)/);
    if (!videoMatch && !photoMatch) {
      if (/tiktok\.com\/@[A-Za-z0-9._]+\/?(?:\?|#|$)/i.test(resolvedUrl)) {
        setResponseStatus(event, 400);
        return { error: PROFILE_HINT };
      }
      setResponseStatus(event, 400);
      return { error: 'Could not extract video ID from URL' };
    }

    if (photoMatch && !videoMatch) {
      const photoId = photoMatch[1];
      const tikwm = await fetchTikwm(resolvedUrl);
      if (!tikwm || !Array.isArray(tikwm.images) || !tikwm.images.length) {
        setResponseStatus(event, 404);
        return { error: 'No images found in this TikTok photo post' };
      }
      const slides = tikwm.images.map((url) => ({ url, mediaType: 'photo' }));
      console.log(`[tt-video] ${photoId} -> tikwm photo (${slides.length} images)`);
      return {
        id: photoId,
        kind: 'photo',
        author: (tikwm.author && tikwm.author.unique_id) || '',
        nickname: (tikwm.author && tikwm.author.nickname) || '',
        description: tikwm.title || '',
        cover: slides[0].url,
        duration: 0,
        slides,
        source: 'tikwm',
      };
    }

    const videoId = videoMatch[1];

    const [ssstik, tikdl] = await Promise.all([
      fetchSsstik(resolvedUrl).catch(() => null),
      fetchTikdownloader(resolvedUrl).catch(() => null),
    ]);
    const primary =
      (ssstik && ssstik.isHd && ssstik) ||
      (tikdl  && tikdl.isHd  && tikdl)  ||
      ssstik || tikdl;
    if (primary && primary.url) {
      const sourceName = primary === ssstik ? 'ssstik' : 'tikdownloader';
      const referer = sourceName === 'ssstik' ? 'https://ssstik.io/' : 'https://tikdownloader.io/';
      const final = await httpHead(primary.url, {
        'User-Agent': UA_DESKTOP_120,
        'Referer': referer,
      });
      console.log(`[tt-video] ${videoId} -> ${sourceName} (HD: ${primary.isHd}, ${final.size} bytes)`);
      return {
        id: videoId,
        author: primary.author || '',
        nickname: primary.author || '',
        description: primary.title || '',
        cover: primary.cover || '',
        duration: 0, width: 0, height: 0, bitrate: 0, codec: '',
        sizeBytes: final.size,
        downloadUrl: final.url || primary.url,
        watermark: false,
        quality: primary.isHd ? 'Original HD' : 'No Watermark',
        source: sourceName,
      };
    }

    const aweme = await fetchTtMobileApi(videoId);
    if (aweme && aweme.video) {
      const v = aweme.video;
      const author = aweme.author || {};
      let bestUrl = null;
      let bestWidth = v.width || 0;
      let bestHeight = v.height || 0;
      let bestBitrate = 0, bestSize = 0, bestCodec = '';
      if (Array.isArray(v.bit_rate)) {
        for (const b of v.bit_rate) {
          const br = Number(b.bit_rate) || 0;
          const url = b.play_addr && Array.isArray(b.play_addr.url_list) && b.play_addr.url_list[0];
          if (url && br > bestBitrate) {
            bestBitrate = br; bestUrl = url;
            bestWidth  = b.play_addr.width  || bestWidth;
            bestHeight = b.play_addr.height || bestHeight;
            bestSize   = Number(b.play_addr.data_size) || 0;
            bestCodec  = b.is_h265 ? 'H.265' : 'H.264';
          }
        }
      }
      if (!bestUrl && v.play_addr && Array.isArray(v.play_addr.url_list)) {
        bestUrl  = v.play_addr.url_list[0];
        bestSize = Number(v.play_addr.data_size) || 0;
      }
      if (bestUrl) {
        const cover = (v.origin_cover && v.origin_cover.url_list && v.origin_cover.url_list[0])
                   || (v.cover        && v.cover.url_list        && v.cover.url_list[0])
                   || '';
        let duration = v.duration || 0;
        if (duration > 1000) duration = duration / 1000;
        console.log(`[tt-video] ${videoId} -> mobile_api (${bestHeight}p, ${bestSize} bytes)`);
        return {
          id: videoId,
          author: author.unique_id || '',
          nickname: author.nickname || '',
          description: aweme.desc || '',
          cover, duration,
          width: bestWidth, height: bestHeight,
          bitrate: bestBitrate, codec: bestCodec,
          sizeBytes: bestSize,
          downloadUrl: bestUrl,
          watermark: false,
          quality: bestHeight ? `${bestHeight}p` : 'HD',
          source: 'mobile_api',
        };
      }
    }

    const tikwm = await fetchTikwm(resolvedUrl);
    if (tikwm && (tikwm.hdplay || tikwm.play)) {
      console.log(`[tt-video] ${videoId} -> tikwm`);
      const absUrl = (u) => u && (u.startsWith('http') ? u : `https://www.tikwm.com${u}`);
      const isHd = !!tikwm.hdplay;
      return {
        id: videoId,
        author: (tikwm.author && tikwm.author.unique_id) || '',
        nickname: (tikwm.author && tikwm.author.nickname) || '',
        description: tikwm.title || '',
        cover: absUrl(tikwm.origin_cover || tikwm.cover) || '',
        duration: tikwm.duration || 0,
        width: 0, height: 0, bitrate: 0, codec: '',
        sizeBytes: (isHd ? tikwm.hd_size : tikwm.size) || 0,
        downloadUrl: absUrl(isHd ? tikwm.hdplay : tikwm.play),
        watermark: false,
        quality: isHd ? 'HD' : 'SD',
        source: 'tikwm',
      };
    }

    console.log(`[tt-video] ${videoId} -> webscrape (watermarked)`);
    const r = await httpsGet(`https://www.tiktok.com/@_/video/${videoId}`, {
      'User-Agent': UA_DESKTOP_120,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (r.status !== 200) {
      // Clamp to 502 — passing upstream codes like 429/451 through would
      // couple our error surface to TikTok's and break frontend error
      // handling that distinguishes "TikTok problem" from "server problem".
      setResponseStatus(event, 502);
      return { error: `TikTok returned ${r.status}` };
    }

    const dataMatch = r.body.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!dataMatch) {
      setResponseStatus(event, 404);
      return { error: 'Could not find video data' };
    }

    let item;
    try {
      const data = JSON.parse(dataMatch[1]);
      const detail = data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.video-detail'];
      if (!detail || !detail.itemInfo || !detail.itemInfo.itemStruct) {
        setResponseStatus(event, 404);
        return { error: 'Video not found or unavailable' };
      }
      item = detail.itemInfo.itemStruct;
    } catch (_) {
      setResponseStatus(event, 500);
      return { error: 'Failed to parse TikTok data' };
    }

    const video = item.video || {};
    const author = item.author || {};
    let bestUrl = video.playAddr;
    let bestBitrate = 0, codec = '', dataSize = 0;
    if (Array.isArray(video.bitrateInfo)) {
      for (const b of video.bitrateInfo) {
        const br = Number(b.Bitrate) || 0;
        const url = b.PlayAddr && Array.isArray(b.PlayAddr.UrlList) && b.PlayAddr.UrlList[0];
        if (url && br > bestBitrate) {
          bestBitrate = br; bestUrl = url;
          codec = b.CodecType || '';
          dataSize = Number(b.PlayAddr.DataSize) || 0;
        }
      }
    }
    if (!bestUrl) {
      setResponseStatus(event, 404);
      return { error: 'No playable video URL found' };
    }
    return {
      id: videoId,
      author: author.uniqueId || '',
      nickname: author.nickname || '',
      description: item.desc || '',
      cover: video.originCover || video.cover || '',
      duration: video.duration || 0,
      width: video.width || 0, height: video.height || 0,
      bitrate: bestBitrate, codec, sizeBytes: dataSize,
      downloadUrl: bestUrl,
      watermark: true,
      quality: video.height ? `${video.height}p` : 'HD',
      source: 'webscrape',
    };
  } catch (err) {
    console.error('[tt-video]', err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch video' };
  }
});
