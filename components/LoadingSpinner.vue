<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';
import { usePlatformStore } from '../stores/platform';

const ui = useUiStore();
const platform = usePlatformStore();
const { loading } = storeToRefs(ui);
const { current } = storeToRefs(platform);

// Map per-platform kind → what the user is waiting for. "profile" stays
// the fallback so adding a new platform that follows the DP pattern Just
// Works without touching this file.
const LABEL_BY_KIND = {
  youtube: 'video',
  reddit: 'video',
  video: 'video',          // tiktok-videos
  'fb-video': 'video',
  soundcloud: 'track',
  'ig-post': 'post',
  tweet: 'post',
  image: 'post',           // vsco
};

const noun = computed(() => {
  const cfg = platform.config(current.value);
  if (!cfg) return 'profile';
  return LABEL_BY_KIND[cfg.kind] || 'profile';
});
</script>

<template>
  <div class="loader" :class="{ visible: loading }">
    <div class="spinner"></div>
    <p>fetching {{ noun }}…</p>
  </div>
</template>
