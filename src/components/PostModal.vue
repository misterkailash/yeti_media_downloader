<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { usePostsStore } from '../stores/posts';

const posts = usePostsStore();
const { modalOpen, modalPost, modalCaption, currentHandle, carouselIndex } = storeToRefs(posts);

const sliderRef = ref(null);
const downloadingAll = ref(false);
const downloadAllLabel = ref('');

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
  }));
});

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
});

watch(modalOpen, (open) => {
  if (open && isCarousel.value) {
    slidesLoaded.value = new Set();
    loadSlide(0);
    loadSlide(1);
  } else if (!open) {
    downloadingAll.value = false;
    downloadAllLabel.value = '';
  }
});

const downloadHref = computed(() => {
  if (!modalPost.value) return '#';
  if (isCarousel.value) {
    const ci = modalPost.value.carouselItems[carouselIndex.value];
    if (!ci) return '#';
    return ci.videoUrl
      ? '/api/image-proxy?url=' + encodeURIComponent(ci.videoUrl)
      : '/api/image-proxy?url=' + encodeURIComponent(ci.url);
  }
  if (modalPost.value.videoUrl) {
    return '/api/image-proxy?url=' + encodeURIComponent(modalPost.value.videoUrl);
  }
  return thumb(modalPost.value.thumbnail);
});

const downloadFileName = computed(() => {
  if (!modalPost.value) return 'download';
  if (isCarousel.value) {
    const ci = modalPost.value.carouselItems[carouselIndex.value];
    if (!ci) return 'download';
    return posts.postFileName(currentHandle.value, modalPost.value, String(carouselIndex.value + 1), ci.videoUrl ? 'mp4' : 'jpg');
  }
  return posts.postFileName(currentHandle.value, modalPost.value, null, modalPost.value.videoUrl ? 'mp4' : 'jpg');
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
        <div class="post-actions">
          <a class="btn-download" :href="downloadHref" :download="downloadFileName">
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
