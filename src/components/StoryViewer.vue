<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useStoriesStore } from '../stores/stories';
import { usePostsStore } from '../stores/posts';

const storiesStore = useStoriesStore();
const posts = usePostsStore();
const { viewerOpen, viewerItems, viewerIndex, viewerHandle } = storeToRefs(storiesStore);

const currentItem = computed(() => viewerItems.value[viewerIndex.value]);

function thumb(url) {
  return '/api/image-proxy?url=' + encodeURIComponent(url);
}

const mediaSrc = computed(() => {
  const item = currentItem.value;
  if (!item) return '';
  if (item.type === 'video' && item.videoUrl) return thumb(item.videoUrl);
  return thumb(item.thumbnail);
});
const isVideo = computed(() => currentItem.value?.type === 'video' && currentItem.value?.videoUrl);

const downloadHref = computed(() => mediaSrc.value);
const downloadName = computed(() => {
  const item = currentItem.value;
  if (!item) return 'story';
  return posts.postFileName(viewerHandle.value, { timestamp: item.timestamp, code: item.id }, null, isVideo.value ? 'mp4' : 'jpg');
});

function closeIfBackdrop(e) {
  if (e.target === e.currentTarget) storiesStore.closeViewer();
}

async function blobDownload(url, filename) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl; a.download = filename || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}

async function onDownload(e) {
  e.preventDefault();
  const url = downloadHref.value;
  const filename = downloadName.value;
  if (!url || url === '#') return;
  try { await blobDownload(url, filename); }
  catch (err) { console.warn('story download failed', err); window.open(url, '_blank'); }
}

function onKey(e) {
  if (!viewerOpen.value) return;
  if (e.key === 'ArrowLeft') storiesStore.prevItem();
  else if (e.key === 'ArrowRight') storiesStore.nextItem();
  else if (e.key === 'Escape') storiesStore.closeViewer();
}

onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="story-viewer-overlay" :class="{ visible: viewerOpen }" @click="closeIfBackdrop">
    <div class="story-viewer" v-if="viewerOpen && currentItem" @click.stop>
      <div class="sv-progress">
        <div
          v-for="(_, i) in viewerItems"
          :key="i"
          class="sv-bar"
          :class="{ done: i < viewerIndex, active: i === viewerIndex }"
        ></div>
      </div>
      <div class="sv-media">
        <video
          v-if="isVideo"
          :src="mediaSrc"
          controls
          autoplay
          playsinline
          :poster="thumb(currentItem.thumbnail)"
        ></video>
        <img v-else :src="mediaSrc" alt="Story">
        <div class="sv-nav">
          <button class="sv-prev" @click="storiesStore.prevItem()"></button>
          <button class="sv-next" @click="storiesStore.nextItem()"></button>
        </div>
      </div>
      <div class="sv-actions">
        <a class="sv-dl" :href="downloadHref" :download="downloadName" @click="onDownload">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>
          </svg>
          Download
        </a>
        <button class="sv-close" @click="storiesStore.closeViewer()">Close</button>
      </div>
      <div class="sv-counter">{{ viewerIndex + 1 }} / {{ viewerItems.length }}</div>
    </div>
  </div>
</template>
