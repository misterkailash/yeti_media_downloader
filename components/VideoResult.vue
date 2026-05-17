<script setup>
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';

const search = useSearchStore();
const { video } = storeToRefs(search);

const preparing = ref(false);
const preparePercent = ref(0);
const prepareError = ref('');
let prepareAbort = null;

// Carousel slide navigation. Reset whenever a fresh result lands.
const activeSlide = ref(0);
watch(video, () => { activeSlide.value = 0; });

const isAlbum = computed(
  () => video.value?.kind === 'ig-album' && Array.isArray(video.value.albumSlides),
);
const currentSlide = computed(() => {
  if (!isAlbum.value) return null;
  return video.value.albumSlides[activeSlide.value] || null;
});
const coverSrc = computed(() => {
  if (isAlbum.value && currentSlide.value) {
    return '/api/image-proxy?url=' + encodeURIComponent(currentSlide.value.url);
  }
  return video.value?.cover || '';
});

function prevSlide() {
  if (!isAlbum.value) return;
  const n = video.value.albumSlides.length;
  activeSlide.value = (activeSlide.value - 1 + n) % n;
}
function nextSlide() {
  if (!isAlbum.value) return;
  const n = video.value.albumSlides.length;
  activeSlide.value = (activeSlide.value + 1) % n;
}
function goToSlide(i) {
  if (!isAlbum.value) return;
  activeSlide.value = i;
}

// Per-slide download (image only — videos in carousels are rare and would
// need their own mux pipeline; for those, fall back to "Download all").
async function downloadCurrentSlide(e) {
  e.preventDefault();
  if (!isAlbum.value || !currentSlide.value) return;
  const slide = currentSlide.value;
  const idx = activeSlide.value + 1;
  const base = video.value.albumZipName || 'instagram_album';
  const ext = slide.mediaType === 'video' ? 'mp4' : 'jpg';
  const fileName = `${base}_${String(idx).padStart(2, '0')}`;
  const url = '/api/image-proxy?url=' + encodeURIComponent(slide.url) + '&name=' + encodeURIComponent(fileName);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${fileName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  } catch (err) {
    prepareError.value = err.message || 'Failed to download slide';
  }
}

function formatSize(n, approx) {
  if (!n) return '';
  let s;
  if (n >= 1e9) s = (n / 1e9).toFixed(2) + ' GB';
  else if (n >= 1e6) s = (n / 1e6).toFixed(1) + ' MB';
  else if (n >= 1e3) s = (n / 1e3).toFixed(0) + ' KB';
  else s = n + ' B';
  return approx ? '~' + s : s;
}

function pickQuality(q) {
  if (!video.value || !q) return;
  // If switching qualities while preparing, abandon the in-flight poll
  if (prepareAbort) prepareAbort();
  preparing.value = false;
  prepareError.value = '';
  video.value = {
    ...video.value,
    selectedItag: q.itag,
    downloadHref: q.downloadHref,
    downloadLabel: `Download ${q.label}`,
    badges: video.value.badges.map((b, i) => i === 0 ? { ...b, text: q.label } : b),
  };
}

// Some platforms need server-side preparation before a download can be
// served with proper Content-Length / Range support — YouTube muxes
// audio+video into mp4, SoundCloud transcodes to 320 kbps MP3, and
// Reddit/FB-video/IG-post mux DASH streams. We poll a status endpoint,
// show "Preparing X%" in the button, and only trigger the actual
// download when the file is ready. Other platforms with direct URLs
// (TikTok, X, image) just navigate normally.
const PREPARE_ENDPOINTS = {
  youtube: { status: '/api/yt-prepare-status', params: ['url', 'itag'] },
  audio: { status: '/api/sc-prepare-status', params: ['url'] },
  reddit: { status: '/api/rd-prepare-status', params: ['url'] },
  'fb-video': { status: '/api/fb-video-prepare-status', params: ['url', 'formatId'] },
  'ig-post': { status: '/api/ig-prepare-status', params: ['url'] },
};

async function downloadAlbumZip(e) {
  e.preventDefault();
  if (!video.value || !video.value.albumSlides?.length) return;
  preparing.value = true;
  preparePercent.value = 0;
  prepareError.value = '';
  try {
    const zipName = video.value.albumZipName || 'instagram_album';
    const items = video.value.albumSlides.map((s, i) => ({
      url: s.url,
      name: `${zipName}_${String(i + 1).padStart(2, '0')}`,
      ext: s.mediaType === 'video' ? 'mp4' : 'jpg',
    }));
    const r = await fetch('/api/album-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: zipName, items }),
    });
    if (!r.ok) throw new Error(`Server returned ${r.status}`);
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${zipName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  } catch (err) {
    prepareError.value = err.message || 'Failed to bundle album';
  } finally {
    preparing.value = false;
  }
}

async function onDownloadClick(e) {
  if (!video.value) return;
  if (video.value.kind === 'ig-album') {
    return downloadAlbumZip(e);
  }
  const cfg = PREPARE_ENDPOINTS[video.value.kind];
  if (!cfg) return; // not a prepare-needed platform — let the <a> navigate
  e.preventDefault();
  const href = video.value.downloadHref;
  const u = new URL(href, window.location.origin);
  const params = cfg.params.map(p => `${p}=${encodeURIComponent(u.searchParams.get(p) || '')}`).join('&');
  // If any required param is missing, fall back to plain navigation
  if (cfg.params.some(p => !u.searchParams.get(p))) { window.location.href = href; return; }

  preparing.value = true;
  preparePercent.value = 0;
  prepareError.value = '';
  let cancelled = false;
  prepareAbort = () => { cancelled = true; };

  try {
    while (!cancelled) {
      const r = await fetch(cfg.status + '?' + params);
      const data = await r.json();
      if (cancelled) return;
      if (data.error) throw new Error(data.error);
      preparePercent.value = Number(data.percent) || 0;
      if (data.ready) break;
      await new Promise(r => setTimeout(r, 800));
    }
    if (cancelled) return;
    // File is ready — navigate to the stream URL. IDM intercepts cleanly.
    window.location.href = href;
  } catch (err) {
    prepareError.value = err.message || 'Failed to prepare download';
  } finally {
    if (!cancelled) preparing.value = false;
    prepareAbort = null;
  }
}
</script>

<template>
  <div v-if="video" class="result-video visible" :data-kind="video.kind">
    <div class="video-cover">
      <img :src="coverSrc" :referrerpolicy="video.referrerPolicy || undefined" alt="Cover">
      <template v-if="isAlbum && video.albumSlides.length > 1">
        <button class="album-nav prev" type="button" @click="prevSlide" aria-label="Previous slide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button class="album-nav next" type="button" @click="nextSlide" aria-label="Next slide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div class="album-counter">{{ activeSlide + 1 }} / {{ video.albumSlides.length }}</div>
        <div class="album-dots">
          <button
            v-for="(s, i) in video.albumSlides"
            :key="i"
            type="button"
            class="album-dot"
            :class="{ active: i === activeSlide }"
            @click="goToSlide(i)"
            :aria-label="`Go to slide ${i + 1}`"
          ></button>
        </div>
      </template>
      <div class="video-badges">
        <span v-for="(b, i) in video.badges" :key="i" :class="{ 'badge-clean': b.clean }">{{ b.text }}</span>
      </div>
    </div>
    <div class="video-info">
      <div class="fullname">{{ video.nickname }}</div>
      <div class="username">{{ video.author }}</div>
      <div class="video-desc">{{ video.description }}</div>
      <div v-if="video.qualities && video.qualities.length" class="quality-picker">
        <div class="quality-label">Choose quality:</div>
        <div class="quality-row">
          <button
            v-for="q in video.qualities"
            :key="q.itag"
            class="quality-btn"
            :class="{ active: q.itag === video.selectedItag }"
            @click="pickQuality(q)"
            :title="q.sizeBytes ? formatSize(q.sizeBytes, q.sizeApprox) : ''"
          >
            <span class="q-label">{{ q.label }}</span>
            <span v-if="q.sizeBytes" class="q-size">{{ formatSize(q.sizeBytes, q.sizeApprox) }}</span>
          </button>
        </div>
      </div>
      <button v-if="isAlbum" class="download-btn slide-btn" type="button" @click="downloadCurrentSlide">
        <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
        Download Image
      </button>
      <a class="download-btn" :href="video.downloadHref" @click="onDownloadClick" :class="{ preparing }">
        <svg v-if="!preparing" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
        <span v-else class="dl-spinner"></span>
        {{ preparing ? `Preparing ${preparePercent.toFixed(0)}%` : video.downloadLabel }}
      </a>
      <div v-if="prepareError" class="prepare-error">{{ prepareError }}</div>
    </div>
  </div>
</template>

<style scoped>
/* ---- Album carousel overlay ---- */
.video-cover { position: relative; }
.album-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: background 0.15s ease, transform 0.15s ease;
}
.album-nav:hover { background: rgba(0, 0, 0, 0.78); transform: translateY(-50%) scale(1.06); }
.album-nav.prev { left: 12px; }
.album-nav.next { right: 12px; }
.album-nav svg { width: 20px; height: 20px; }
.album-counter {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 999px;
  z-index: 2;
  letter-spacing: 0.02em;
}
.album-dots {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 2;
}
.album-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: none;
  padding: 0;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.45);
  transition: transform 0.15s ease, background 0.15s ease;
}
.album-dot.active { background: #fff; transform: scale(1.35); }
.slide-btn {
  background: var(--surface) !important;
  color: var(--text) !important;
  border: 1.5px solid var(--border) !important;
  box-shadow: none !important;
  margin-bottom: 8px;
}
.slide-btn:hover {
  border-color: var(--accent) !important;
  color: var(--accent) !important;
  transform: translateY(-1px);
  box-shadow: none !important;
}
.slide-btn svg { stroke: currentColor; }

.quality-picker {
  width: 100%;
  max-width: 360px;
  margin: 18px auto 4px;
  text-align: left;
}
.quality-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 10px;
  text-align: center;
}
.quality-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}
.quality-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 8px;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  cursor: pointer;
  font-family: var(--font);
  transition: all 0.15s ease;
  min-height: 52px;
}
.quality-btn:hover {
  border-color: var(--accent);
  background: var(--accent-light);
  transform: translateY(-1px);
}
.quality-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 4px 14px rgba(43, 79, 126, 0.25);
}
.quality-btn.active .q-size {
  color: rgba(255, 255, 255, 0.78);
}
.q-label {
  font-weight: 700;
  font-size: 0.92rem;
  line-height: 1.1;
  letter-spacing: 0.01em;
}
.q-size {
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--text-dim);
  margin-top: 4px;
  letter-spacing: 0.02em;
}

.download-btn.preparing {
  cursor: progress;
  opacity: 0.85;
}
.dl-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: dl-spin 0.8s linear infinite;
}
@keyframes dl-spin {
  to { transform: rotate(360deg); }
}
.prepare-error {
  margin-top: 10px;
  font-size: 0.78rem;
  color: #d4524d;
  text-align: center;
}
</style>
