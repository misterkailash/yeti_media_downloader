<script setup>
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';

const search = useSearchStore();
const { video } = storeToRefs(search);

const preparing = ref(false);
const preparePercent = ref(0);
const prepareError = ref('');
let prepareAbort = null;

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
// audio+video into mp4, SoundCloud transcodes to 320 kbps MP3. Rather
// than letting the browser/IDM hang on a slow request, we poll a status
// endpoint, show progress in the button, and only trigger the actual
// download when the file is ready. Other platforms have direct URLs and
// just navigate normally.
const PREPARE_ENDPOINTS = {
  youtube: { status: '/api/yt-prepare-status', params: ['url', 'itag'] },
  audio: { status: '/api/sc-prepare-status', params: ['url'] },
  reddit: { status: '/api/rd-prepare-status', params: ['url'] },
  'fb-video': { status: '/api/fb-video-prepare-status', params: ['url', 'formatId'] },
};

async function onDownloadClick(e) {
  if (!video.value) return;
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
      <img :src="video.cover" :referrerpolicy="video.referrerPolicy || undefined" alt="Cover">
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
