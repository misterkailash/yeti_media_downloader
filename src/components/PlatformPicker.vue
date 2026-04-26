<script setup>
import { storeToRefs } from 'pinia';
import { usePlatformStore, PLATFORM_LIST } from '../stores/platform';
import { useSearchStore } from '../stores/search';
import { useUiStore } from '../stores/ui';
import { usePostsStore } from '../stores/posts';
import { useStoriesStore } from '../stores/stories';

import instagram from '../assets/instagram.png';
import facebook from '../assets/facebook.png';
import tiktok from '../assets/tiktok.png';
import threads from '../assets/threads.png';
import vsco from '../assets/vsco.png';

const ICONS = { 'instagram.png': instagram, 'facebook.png': facebook, 'tiktok.png': tiktok, 'threads.png': threads, 'vsco.png': vsco };

const platform = usePlatformStore();
const search = useSearchStore();
const ui = useUiStore();
const posts = usePostsStore();
const stories = useStoriesStore();
const { current } = storeToRefs(platform);

function pick(id) {
  if (id === current.value) return;
  platform.set(id);
  search.clearResults();
  posts.reset();
  stories.reset();
  ui.clearError();
  ui.hideAuthWarn();
  search.hideSuggest();
  search.query = '';
}
</script>

<template>
  <div class="platforms">
    <div
      v-for="p in PLATFORM_LIST"
      :key="p.id"
      class="platform-card"
      :class="{ active: current === p.id }"
      @click="pick(p.id)"
    >
      <div class="p-icon">
        <img :src="ICONS[p.icon]" :alt="p.label" width="28" height="28">
      </div>
      <div class="p-label">{{ p.label }}</div>
    </div>
  </div>
</template>
