<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { usePostsStore } from '../stores/posts';

const posts = usePostsStore();
const { modalOpen, modalPost, modalCaption, currentHandle, carouselIndex } = storeToRefs(posts);

const sliderRef = ref(null);
const downloadingAll = ref(false);
const downloadAllLabel = ref('');
// Index into the active item's videoVersions[]. Reset to 0 (highest)
// whenever the modal opens or the carousel slide changes.
const selectedVersionIdx = ref(0);

const isCarousel = computed(
  () => modalPost.value?.type === 'carousel' && modalPost.value.carouselItems?.length > 1
);
const isVideo = computed(() => !isCarousel.value && !!modalPost.value?.videoUrl);

function thumb(url) {
  return '/api/image-proxy?url=' + encodeURIComponent(url);
}

const carouselItems = computed(() => {
  if (!isCarousel.value) return [];
  return modalPost.value.carouselItems.map((ci) => ({
    type: ci.type,
    url: thumb(ci.url),
    videoUrl: ci.videoUrl ? thumb(ci.videoUrl) : null,
    rawUrl: ci.url,
    rawVideoUrl: ci.videoUrl,
    videoVersions: ci.videoVersions || [],
  }));
});

// The video being viewed/downloaded right now. For non-carousel posts it's
// the post itself; for carousels it's the slide at carouselIndex.
const activeVideoVersions = computed(() => {
  if (isCarousel.value) {
    const ci = modalPost.value?.carouselItems?.[carouselIndex.value];
    return ci?.videoVersions || [];
  }
  return modalPost.value?.videoVersions || [];
});

// Show the picker any time we have at least one version with a real
// height — single-quality reels are common, and labeling the available
// quality is more useful than silently hiding the row.
const showQualityPicker = computed(() => {
  const v = activeVideoVersions.value;
  return v.length > 0 && v.some(x => x.height);
});

function qualityLabel(v, i) {
  if (v.height) return `${v.height}p`;
  return ['Best', 'High', 'Medium', 'Low'][i] || `Option ${i + 1}`;
}

function pickQuality(i) {
  selectedVersionIdx.value = i;
}

const slidesLoaded = ref(new Set());
function loadSlide(idx) {
  if (idx < 0 || idx >= carouselItems.value.length) return;
  slidesLoaded.value.add(idx);
  slidesLoaded.value = new Set(slidesLoaded.value);
}

watch(carouselIndex, (i) => {
  loadSlide(i);
  loadSlide(i + 1);
  loadSlide(i - 1);
  selectedVersionIdx.value = 0;
});

watch(modalOpen, (open) => {
  selectedVersionIdx.value = 0;
  if (open && isCarousel.value) {
    slidesLoaded.value = new Set();
    loadSlide(0);
    loadSlide(1);
  } else if (!open) {
    downloadingAll.value = false;
    downloadAllLabel.value = '';
  }
  if (open) fetchFullQualities();
});

// IG's profile feed serves a degraded video_versions list (reels capped
// around 720x1280). When the modal opens we fire one extra call to the
// per-media info endpoint and merge in the full quality list — same way
// sealx etc surface 1080x1920 originals. Falls through silently if the
// user isn't logged into IG (401) or the post isn't a video.
async function fetchFullQualities() {
  const post = modalPost.value;
  if (!post || !post.code) return;
  const hasVideo = post.videoUrl || (post.carouselItems || []).some(ci => ci.videoUrl);
  if (!hasVideo) return;
  try {
    const r = await fetch('/api/ig-post-versions/' + encodeURIComponent(post.code));
    if (!r.ok) return;
    const data = await r.json();
    if (!post || post.code !== modalPost.value?.code) return; // modal switched
    if (Array.isArray(data.videoVersions) && data.videoVersions.length) {
      post.videoVersions = data.videoVersions;
      // Top-level URL may have changed; keep the fallback consistent.
      if (data.videoVersions[0].url) post.videoUrl = data.videoVersions[0].url;
    }
    if (Array.isArray(data.carousel) && Array.isArray(post.carouselItems)) {
      post.carouselItems.forEach((ci, i) => {
        const c = data.carousel[i];
        if (c && Array.isArray(c.videoVersions) && c.videoVersions.length) {
          ci.videoVersions = c.videoVersions;
          ci.videoUrl = c.videoVersions[0].url;
        }
      });
    }
    // Reset the picker selection so the user lands on the new top quality
    selectedVersionIdx.value = 0;
  } catch (_) { /* ignore — picker just won't upgrade */ }
}

// Pass the bare basename (no extension) — the image-proxy adds the right
// extension based on the actual response content-type (.mp4 / .jpg / etc).
const downloadName = computed(() => {
  if (!modalPost.value) return 'download';
  if (isCarousel.value) {
    const ci = modalPost.value.carouselItems[carouselIndex.value];
    if (!ci) return 'download';
    return posts.postFileName(currentHandle.value, modalPost.value, String(carouselIndex.value + 1), '');
  }
  return posts.postFileName(currentHandle.value, modalPost.value, null, '');
});

// `name=` is what makes the proxy stamp Content-Disposition: attachment.
// Without it, browsers render videos/images inline (in a new tab) instead
// of downloading.
function proxiedDownload(url) {
  return '/api/image-proxy?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(downloadName.value);
}

const downloadHref = computed(() => {
  if (!modalPost.value) return '#';
  if (isCarousel.value) {
    const ci = modalPost.value.carouselItems[carouselIndex.value];
    if (!ci) return '#';
    if (ci.videoUrl) {
      const versions = ci.videoVersions || [];
      const chosen = versions[selectedVersionIdx.value]?.url || ci.videoUrl;
      return proxiedDownload(chosen);
    }
    return proxiedDownload(ci.url);
  }
  if (modalPost.value.videoUrl) {
    const versions = modalPost.value.videoVersions || [];
    const chosen = versions[selectedVersionIdx.value]?.url || modalPost.value.videoUrl;
    return proxiedDownload(chosen);
  }
  return proxiedDownload(modalPost.value.thumbnail);
});

async function gotoSlide(i) {
  const total = carouselItems.value.length;
  posts.setCarouselIndex(Math.max(0, Math.min(total - 1, i)));
  await nextTick();
  const slider = sliderRef.value;
  if (slider) slider.children[carouselIndex.value]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
}

function arrow(dir) {
  gotoSlide(carouselIndex.value + dir);
}

function onScrollEnd() {
  const slider = sliderRef.value;
  if (!slider) return;
  const slideW = slider.offsetWidth;
  if (slideW > 0) {
    posts.setCarouselIndex(Math.round(slider.scrollLeft / slideW));
  }
}

function closeIfBackdrop(e) {
  if (e.target === e.currentTarget) posts.closeModal();
}

async function downloadAll() {
  if (!modalPost.value || !isCarousel.value) return;
  const items = modalPost.value.carouselItems;
  const total = items.length;
  downloadingAll.value = true;
  downloadAllLabel.value = `Packing ${total} items…`;

  const zipBase = posts.postFileName(currentHandle.value, modalPost.value, null, '').replace(/\.$/, '');
  const payload = {
    name: zipBase,
    items: items.map((ci, i) => ({
      url: ci.videoUrl || ci.url,
      ext: ci.videoUrl ? 'mp4' : 'jpg',
      name: `${zipBase}_${i + 1}`,
    })),
  };

  try {
    const res = await fetch('/api/album-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('zip HTTP ' + res.status);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = (payload.name || 'album') + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    downloadAllLabel.value = `Downloaded (${total})`;
  } catch (err) {
    console.warn('album-zip failed', err);
    downloadAllLabel.value = 'Failed — try again';
  } finally {
    setTimeout(() => {
      downloadingAll.value = false;
      downloadAllLabel.value = '';
    }, 1800);
  }
}
</script>

<template>
  <div class="post-modal-overlay" :class="{ visible: modalOpen }" @click="closeIfBackdrop">
    <div class="post-modal" v-if="modalOpen && modalPost" @click.stop>
      <div class="post-modal-img">
        <template v-if="isCarousel">
          <div class="carousel-slider" ref="sliderRef" @scrollend="onScrollEnd">
            <div v-for="(ci, i) in carouselItems" :key="i" class="carousel-slide">
              <video
                v-if="ci.type === 'video' && ci.videoUrl"
                :src="slidesLoaded.has(i) ? ci.videoUrl : undefined"
                controls
                preload="none"
                :poster="ci.url"
              ></video>
              <img
                v-else
                :src="slidesLoaded.has(i) ? ci.url : undefined"
                :alt="`Slide ${i+1}`"
                loading="lazy"
                decoding="async"
              >
            </div>
          </div>
          <div class="carousel-arrows">
            <button class="carousel-arrow" @click="arrow(-1)">
              <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="carousel-arrow" @click="arrow(1)">
              <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="carousel-nav">
            <button
              v-for="(_, i) in carouselItems"
              :key="i"
              class="carousel-dot"
              :class="{ active: i === carouselIndex }"
              @click="gotoSlide(i)"
            ></button>
          </div>
          <span class="carousel-counter">{{ carouselIndex + 1 }} / {{ carouselItems.length }}</span>
        </template>
        <video
          v-else-if="isVideo"
          :src="`/api/image-proxy?url=${encodeURIComponent(modalPost.videoUrl)}`"
          controls
          autoplay
          :poster="thumb(modalPost.thumbnail)"
        ></video>
        <img v-else :src="thumb(modalPost.thumbnail)" alt="Post">
      </div>
      <div class="post-modal-body">
        <div class="caption">{{ modalCaption }}</div>
        <div v-if="showQualityPicker" class="post-quality">
          <div class="post-quality-label">Choose quality:</div>
          <div class="post-quality-row">
            <button
              v-for="(v, i) in activeVideoVersions"
              :key="i"
              class="post-quality-btn"
              :class="{ active: i === selectedVersionIdx }"
              @click="pickQuality(i)"
            >
              {{ qualityLabel(v, i) }}
            </button>
          </div>
        </div>
        <div class="post-actions">
          <a class="btn-download" :href="downloadHref">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>
            </svg>
            Download
          </a>
          <button v-if="isCarousel" class="btn-download-all" :disabled="downloadingAll" @click="downloadAll">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>
              <path d="M8 7v-.5A1.5 1.5 0 019.5 5h5A1.5 1.5 0 0116 6.5V7"/>
            </svg>
            <span class="btn-label">{{ downloadAllLabel || `Download All (${carouselItems.length})` }}</span>
          </button>
          <button class="btn-close" @click="posts.closeModal()">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.post-quality {
  margin: 12px 0 4px;
  text-align: left;
}
.post-quality-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.post-quality-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.post-quality-btn {
  padding: 6px 12px;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
  font-family: var(--font);
  font-size: 0.78rem;
  font-weight: 600;
  transition: all 0.15s ease;
}
.post-quality-btn:hover {
  border-color: var(--accent);
  background: var(--accent-light);
}
.post-quality-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
