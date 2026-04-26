<script setup>
import { storeToRefs } from 'pinia';
import { useStoriesStore } from '../stores/stories';

const storiesStore = useStoriesStore();
const { highlights, highlightsVisible } = storeToRefs(storiesStore);

function thumb(url) {
  return url ? '/api/image-proxy?url=' + encodeURIComponent(url) : '';
}
</script>

<template>
  <div class="highlights-section" :class="{ visible: highlightsVisible }">
    <h3>Highlights</h3>
    <div class="highlights-row">
      <div
        v-for="h in highlights"
        :key="h.id"
        class="highlight-item"
        @click="storiesStore.openHighlight(h.id)"
      >
        <div class="highlight-cover">
          <img v-if="h.coverUrl" :src="thumb(h.coverUrl)" :alt="h.title" loading="lazy">
          <div v-else style="width:100%;height:100%;background:var(--bg)"></div>
        </div>
        <span class="hl-title">{{ h.title || 'Highlight' }}</span>
        <span class="hl-count">{{ h.itemCount }} items</span>
      </div>
    </div>
  </div>
</template>
