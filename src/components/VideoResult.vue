<script setup>
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';

const search = useSearchStore();
const { video } = storeToRefs(search);
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
      <a class="download-btn" :href="video.downloadHref" :download="video.downloadName">
        <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
        {{ video.downloadLabel }}
      </a>
    </div>
  </div>
</template>
