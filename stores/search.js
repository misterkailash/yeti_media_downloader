import { defineStore } from 'pinia';
import { ref } from 'vue';
import { usePlatformStore } from './platform';
import { useUiStore } from './ui';
import { usePostsStore } from './posts';
import { useStoriesStore } from './stories';
import { useLoginStore } from './login';


function formatBytes(n) {
  if (!n) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
  return n + ' B';
}

export const useSearchStore = defineStore('search', () => {
  const query = ref('');
  const profile = ref(null);   // { avatar, fullName, username, meta: [{value,label}], handle }
  const video = ref(null);     // { kind, cover, badges, nickname, author, description, downloadHref, downloadName, downloadLabel }

  // Autocomplete state
  const suggestUsers = ref([]);
  const suggestActiveIdx = ref(-1);
  const suggestVisible = ref(false);
  const suggestSearched = ref(false);
  let suggestTimer = null;
  let suggestSeq = 0;

  function clearResults() {
    profile.value = null;
    video.value = null;
  }

  function hideSuggest() {
    clearTimeout(suggestTimer);
    // Bump the sequence so any in-flight runSuggest result is discarded.
    suggestSeq++;
    suggestVisible.value = false;
    suggestUsers.value = [];
    suggestActiveIdx.value = -1;
    suggestSearched.value = false;
  }

  async function runSuggest(q) {
    const seq = ++suggestSeq;
    try {
      const res = await fetch('/api/ig-search?q=' + encodeURIComponent(q));
      if (seq !== suggestSeq) return;
      const data = await res.json();
      if (seq !== suggestSeq) return;
      suggestUsers.value = data.users || [];
      suggestActiveIdx.value = -1;
      suggestSearched.value = true;
      suggestVisible.value = true;
    } catch (_) { /* ignore */ }
  }

  function onInput(value) {
    query.value = value;
    const platform = usePlatformStore();
    const login = useLoginStore();
    // IG anonymous topsearch returns nothing useful, so skip the fetch
    // (and the dropdown) entirely when the user isn't signed in.
    if (platform.current !== 'instagram' || !login.loggedIn) {
      hideSuggest();
      return;
    }
    const q = value.trim().replace(/^@/, '');
    clearTimeout(suggestTimer);
    if (q.length < 1) {
      hideSuggest();
      return;
    }
    suggestTimer = setTimeout(() => runSuggest(q), 120);
  }

  function pickSuggest(idx) {
    const u = suggestUsers.value[idx];
    if (!u) return;
    query.value = u.username;
    hideSuggest();
    submit();
  }

  function suggestKeyDown(e) {
    if (!suggestVisible.value || !suggestUsers.value.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestActiveIdx.value = (suggestActiveIdx.value + 1) % suggestUsers.value.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestActiveIdx.value = (suggestActiveIdx.value - 1 + suggestUsers.value.length) % suggestUsers.value.length;
    } else if (e.key === 'Enter' && suggestActiveIdx.value >= 0) {
      e.preventDefault();
      pickSuggest(suggestActiveIdx.value);
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  }

  async function submit() {
    const ui = useUiStore();
    const platform = usePlatformStore();
    const posts = usePostsStore();
    const stories = useStoriesStore();

    hideSuggest();
    const cfg = platform.config(platform.current);
    let handle = query.value.trim();
    if (cfg.kind === 'profile' || !cfg.kind) handle = handle.replace(/^@/, '');
    if (!handle) return;

    clearResults();
    posts.reset();
    stories.reset();
    ui.clearError();
    ui.hideAuthWarn();
    ui.loading = true;

    try {
      const res = await fetch(cfg.endpoint + encodeURIComponent(handle));
      let data;
      try {
        data = await res.json();
      } catch (_) {
        // Server returned non-JSON (typically Nitro's HTML 404). Most
        // commonly: the dev server is stale on a newly added route.
        throw new Error(
          res.status === 404
            ? 'Endpoint not found — restart the dev server to pick up new routes.'
            : `Server returned ${res.status} (non-JSON). Check the server console.`
        );
      }
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');

      if (cfg.kind === 'video') {
        // TikTok photo carousel — server flagged this aweme as a photo post,
        // so render it with the existing album UI and ZIP the JPEGs on download.
        if (data.kind === 'photo') {
          const slides = Array.isArray(data.slides) ? data.slides : [];
          const fileName = `tiktok_${data.author || 'photo'}_${data.id}`;
          const badges = [{ text: `${slides.length} photos`, clean: true }];
          video.value = {
            kind: 'ig-album',
            cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
            referrerPolicy: null,
            nickname: data.nickname || data.author || '',
            author: data.author ? '@' + data.author : '',
            description: data.description || '',
            badges,
            downloadHref: '#',
            downloadName: fileName + '.zip',
            downloadLabel: `Download all (${slides.length} photos)`,
            albumSlides: slides,
            albumZipName: fileName,
          };
          return;
        }

        const fileName = `tiktok_${data.author || 'video'}_${data.id}`;
        const badges = [];
        badges.push({ text: data.watermark ? 'watermarked' : 'no watermark', clean: !data.watermark });
        if (data.quality) badges.push({ text: data.quality });
        else if (data.height) badges.push({ text: `${data.height}p` });
        if (data.codec) badges.push({ text: data.codec.replace(/^h/, 'H.') });
        const size = formatBytes(data.sizeBytes);
        if (size) badges.push({ text: size });
        if (data.duration) badges.push({ text: `${Math.round(data.duration)}s` });

        video.value = {
          kind: 'video',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.nickname || data.author || '',
          author: data.author ? '@' + data.author : '',
          description: data.description || '',
          badges,
          downloadHref: '/api/tt-video-proxy?url=' + encodeURIComponent(data.downloadUrl) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + '.mp4',
          downloadLabel: 'Download HD Video',
        };
      } else if (cfg.kind === 'youtube') {
        // YouTube returns a list of qualities; pick the highest by default
        // and let the user switch via the picker. Each pick rewrites the
        // download URL to the matching itag.
        // Use the video title as the filename — strip filesystem-illegal
        // chars but keep spaces, parens, and other punctuation for
        // readability. The server further handles Unicode via RFC 5987.
        const rawName = data.title || `youtube_${data.id}`;
        const fileName = rawName
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        const qualities = (data.qualities || []).map(q => ({
          itag: q.itag,
          label: q.label,
          height: q.height,
          fps: q.fps,
          sizeBytes: q.sizeBytes,
          sizeApprox: !!q.sizeApprox,
          downloadHref: '/api/yt-stream?url=' + encodeURIComponent(handle)
            + '&itag=' + q.itag
            + '&name=' + encodeURIComponent(fileName),
        }));
        const top = qualities[0];
        const badges = [];
        if (top) badges.push({ text: top.label });
        if (top && top.sizeBytes) {
          const size = formatBytes(top.sizeBytes);
          if (size) badges.push({ text: size });
        }
        if (data.duration) {
          const m = Math.floor(data.duration / 60);
          const s = String(data.duration % 60).padStart(2, '0');
          badges.push({ text: `${m}:${s}` });
        }

        video.value = {
          kind: 'youtube',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.title || '',
          author: data.author ? data.author : '',
          description: data.description || '',
          badges,
          qualities,
          selectedItag: top ? top.itag : null,
          downloadHref: top ? top.downloadHref : '',
          downloadName: fileName + '.mp4',
          downloadLabel: top ? `Download ${top.label}` : 'Download',
        };
      } else if (cfg.kind === 'fb-video') {
        // Facebook videos: yt-dlp returns multiple DASH variants, the
        // server hands them all back as `qualities` and the user picks.
        // The mux/prepare flow is keyed on (url, formatId) so each
        // quality has its own cached temp file.
        const rawName = data.author && data.title
          ? `${data.author} - ${data.title}`
          : (data.title || data.author || `facebook_${data.id}`);
        const fileName = rawName
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        const qualities = (data.qualities || []).map(q => ({
          itag: q.formatId,
          label: q.label,
          height: q.height,
          fps: q.fps,
          sizeBytes: q.sizeBytes,
          sizeApprox: !!q.sizeApprox,
          downloadHref: '/api/fb-video-stream?url=' + encodeURIComponent(handle)
            + '&formatId=' + encodeURIComponent(q.formatId)
            + '&name=' + encodeURIComponent(fileName),
        }));
        const top = qualities[0];
        const badges = [];
        if (top) badges.push({ text: top.label });
        if (top && top.sizeBytes) {
          const size = formatBytes(top.sizeBytes);
          if (size) badges.push({ text: top.sizeApprox ? `~${size}` : size });
        }
        if (data.duration) {
          const m = Math.floor(data.duration / 60);
          const s = String(data.duration % 60).padStart(2, '0');
          badges.push({ text: `${m}:${s}` });
        }

        video.value = {
          kind: 'fb-video',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.title || '',
          author: data.author || '',
          description: data.description || '',
          badges,
          qualities,
          selectedItag: top ? top.itag : null,
          downloadHref: top ? top.downloadHref : '',
          downloadName: fileName + '.mp4',
          downloadLabel: top ? `Download ${top.label}` : 'Download Video',
        };
      } else if (cfg.kind === 'reddit') {
        // Reddit videos use the same yt-dlp + ffmpeg mux pipeline as
        // YouTube — DASH video stream + separate DASH audio stream merged
        // into a single mp4. The "Preparing X%" indicator polls
        // /api/rd-prepare-status while we mux server-side.
        const rawName = data.title || `reddit_${data.id}`;
        const fileName = rawName
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        const badges = [];
        if (data.height) badges.push({ text: `${data.height}p` });
        const size = formatBytes(data.sizeBytes);
        if (size) badges.push({ text: `~${size}` });
        if (data.duration) {
          const m = Math.floor(data.duration / 60);
          const s = String(data.duration % 60).padStart(2, '0');
          badges.push({ text: `${m}:${s}` });
        }

        video.value = {
          // Reuse the youtube prepare-flow (same /api/.../-prepare-status
          // pattern). VideoResult.PREPARE_ENDPOINTS keys on `kind`.
          kind: 'reddit',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.title || '',
          author: data.author ? 'u/' + data.author : '',
          description: data.description || '',
          badges,
          downloadHref: '/api/rd-stream?url=' + encodeURIComponent(handle) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + '.mp4',
          downloadLabel: 'Download Video',
        };
      } else if (cfg.kind === 'soundcloud') {
        // SoundCloud: server transcodes to 320 kbps CBR MP3 via ffmpeg.
        // Honesty caveat — transcoding from 128 kbps source doesn't add
        // real audio quality, but the output file is genuinely 320 kbps.
        const rawName = `${data.artist || 'soundcloud'} - ${data.title || 'track'}`;
        const fileName = rawName
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        const badges = [];
        badges.push({ text: '320 kbps MP3', clean: true });
        if (data.sourceBitrate) badges.push({ text: `source ${data.sourceBitrate}kbps` });
        const size = formatBytes(data.sizeBytes);
        if (size) badges.push({ text: `~${size}` });
        if (data.duration) {
          const m = Math.floor(data.duration / 60);
          const s = String(data.duration % 60).padStart(2, '0');
          badges.push({ text: `${m}:${s}` });
        }

        video.value = {
          kind: 'audio',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.title || '',
          author: data.artist || '',
          description: data.description || '',
          badges,
          downloadHref: '/api/sc-stream?url=' + encodeURIComponent(handle) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + '.mp3',
          downloadLabel: 'Download MP3 (320 kbps)',
          // Used by VideoResult's "Preparing X%" indicator while the
          // server is transcoding. Same pattern as YouTube but for audio.
          scUrl: handle,
        };
      } else if (cfg.kind === 'tweet') {
        // X / Twitter: same response shape as TikTok video, but media may
        // be a photo or a video. Branch on data.mediaType.
        const fileName = `x_${data.author || 'tweet'}_${data.id}`;
        const isVideo = data.mediaType === 'video';
        const badges = [];
        if (isVideo) {
          if (data.height) badges.push({ text: `${data.height}p` });
          if (data.bitrate) badges.push({ text: `${Math.round(data.bitrate / 1000)}kbps` });
          const size = formatBytes(data.sizeBytes);
          if (size) badges.push({ text: size });
          if (data.duration) badges.push({ text: `${Math.round(data.duration)}s` });
        } else {
          badges.push({ text: 'original size', clean: true });
          if (data.width && data.height) badges.push({ text: `${data.width}×${data.height}` });
        }
        if (data.mediaCount > 1) badges.push({ text: `1 of ${data.mediaCount}` });

        video.value = {
          kind: isVideo ? 'video' : 'image',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover || data.downloadUrl),
          referrerPolicy: null,
          nickname: data.nickname || data.author || '',
          author: data.author ? '@' + data.author : '',
          description: data.description || '',
          badges,
          downloadHref: isVideo
            ? '/api/tt-video-proxy?url=' + encodeURIComponent(data.downloadUrl) + '&name=' + encodeURIComponent(fileName)
            : '/api/image-proxy?url=' + encodeURIComponent(data.downloadUrl) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + (isVideo ? '.mp4' : '.jpg'),
          downloadLabel: isVideo ? 'Download Video' : 'Download Image',
        };
      } else if (cfg.kind === 'ig-post') {
        // Instagram post / reel by URL.
        // - Single video → /api/ig-stream (mux video+audio).
        // - Single image → image-proxy direct download.
        // - Carousel (slides[]) → ZIP all slides via /api/album-zip.
        const isVideo = data.mediaType === 'video';
        const slides = Array.isArray(data.slides) ? data.slides : null;
        const isAlbum = !!(slides && slides.length > 1);
        let author = data.author;
        if (!author) {
          const m = handle.match(/instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|reels|tv)\//i);
          if (m) author = m[1];
        }
        const fileName = `${author || 'instagram'}_${data.id}`.replace(/[^a-zA-Z0-9._-]/g, '_');
        const badges = [];
        if (isAlbum) {
          badges.push({ text: `${slides.length} slides`, clean: true });
        } else if (isVideo) {
          if (data.height) badges.push({ text: `${data.height}p` });
          const size = formatBytes(data.sizeBytes);
          if (size) badges.push({ text: size });
          if (data.duration) badges.push({ text: `${Math.round(data.duration)}s` });
        } else {
          badges.push({ text: 'original size', clean: true });
          if (data.width && data.height) badges.push({ text: `${data.width}×${data.height}` });
        }

        const singleHref = isVideo
          ? '/api/ig-stream?url=' + encodeURIComponent(handle) + '&name=' + encodeURIComponent(fileName)
          : '/api/image-proxy?url=' + encodeURIComponent(data.downloadUrl) + '&name=' + encodeURIComponent(fileName);

        video.value = {
          kind: isAlbum ? 'ig-album' : (isVideo ? 'ig-post' : 'image'),
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.author || '',
          author: data.author ? '@' + data.author : '',
          description: data.description || '',
          badges,
          downloadHref: singleHref,
          downloadName: fileName + (isVideo ? '.mp4' : '.jpg'),
          downloadLabel: isAlbum
            ? `Download all (${slides.length} slides)`
            : (isVideo ? 'Download Video' : 'Download Image'),
          igUrl: handle,
          // Album-mode metadata used by VideoResult to POST to /api/album-zip
          // when the user clicks the download button.
          albumSlides: isAlbum ? slides : null,
          albumZipName: isAlbum ? fileName : null,
        };
      } else if (cfg.kind === 'image') {
        const fileName = `vsco_${data.author || 'post'}_${data.id || Date.now()}`;
        video.value = {
          kind: 'image',
          cover: data.imageUrl,
          referrerPolicy: 'no-referrer',
          nickname: data.title || data.author || '',
          author: data.author ? '@' + data.author : '',
          description: data.description || '',
          badges: [{ text: 'HD image', clean: true }],
          downloadHref: '/api/image-proxy?url=' + encodeURIComponent(data.imageUrl) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + '.jpg',
          downloadLabel: 'Download HD Image',
        };
      } else {
        const today = new Date();
        const dateStr = today.getFullYear() + '-'
          + String(today.getMonth() + 1).padStart(2, '0') + '-'
          + String(today.getDate()).padStart(2, '0');
        const fileName = `${platform.current}_${handle}_${dateStr}`;
        // Path-style URL: the filename sits in the URL path so Chrome uses
        // it as the default "Save image as" name. inline=1 tells the proxy
        // not to set Content-Disposition, so the image opens in a new tab
        // instead of triggering a download.
        const proxied = '/api/image-proxy/' + encodeURIComponent(fileName) + '.jpg'
          + '?url=' + encodeURIComponent(data.profile_pic_url) + '&inline=1';
        const labels = cfg.statLabels;
        const meta = [];
        if (data.followers && labels.followers) meta.push({ value: data.followers, label: labels.followers });
        if (data.following && labels.following) meta.push({ value: data.following, label: labels.following });
        if (data.posts && labels.posts) meta.push({ value: data.posts, label: labels.posts });

        profile.value = {
          avatar: proxied,
          fullName: data.full_name || 'No name',
          username: '@' + (data.username || handle),
          meta,
          handle,
          picWidth: data.pic_width || 0,
          downloadName: fileName + '.jpg',
        };

        if (platform.current === 'instagram') {
          posts.fetchPosts(handle);
          stories.fetchStories(handle);
          stories.fetchHighlights(handle);
        }
      }
    } catch (err) {
      ui.showError(err.message === 'User not found' ? 'User not found.' : (err.message || 'Failed to fetch.'));
    } finally {
      ui.loading = false;
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      query.value = text;
    } catch (_) { /* ignore */ }
  }

  return {
    query, profile, video,
    suggestUsers, suggestActiveIdx, suggestVisible, suggestSearched,
    onInput, hideSuggest, suggestKeyDown, pickSuggest,
    submit, paste, clearResults,
  };
});
