<script setup>
import { storeToRefs } from 'pinia';
import { useStoriesStore } from '../stores/stories';

const storiesStore = useStoriesStore();
const { stories, storiesVisible } = storeToRefs(storiesStore);

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
function thumb(url) {
  return '/api/image-proxy?url=' + encodeURIComponent(url);
}
</script>

<template>
  <div class="stories-section" :class="{ visible: storiesVisible }">
    <h3>Stories</h3>
    <div class="stories-row">
      <div
        v-for="(s, i) in stories"
        :key="s.id"
        class="story-item"
        @click="storiesStore.openStory(i)"
      >
        <div class="story-badge">
          <div class="story-ring">
            <img :src="thumb(s.thumbnail)" alt="Story" loading="lazy">
          </div>
          <div v-if="s.type === 'video'" class="play-icon">
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        <span class="story-label">{{ timeAgo(s.timestamp) }}</span>
      </div>
    </div>
  </div>
</template>
