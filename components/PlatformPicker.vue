<script setup>
import { PLATFORM_LIST } from '~/stores/platform';

import instagram from '~/assets/instagram.png';
import facebook from '~/assets/facebook.png';
import tiktok from '~/assets/tiktok.png';
import threads from '~/assets/threads.png';
import vsco from '~/assets/vsco.png';
import x from '~/assets/x.png';
import youtube from '~/assets/youtube.png';
import soundcloud from '~/assets/soundcloud.png';
import reddit from '~/assets/reddit.png';

const ICONS = { 'instagram.png': instagram, 'facebook.png': facebook, 'tiktok.png': tiktok, 'threads.png': threads, 'vsco.png': vsco, 'x.png': x, 'youtube.png': youtube, 'soundcloud.png': soundcloud, 'reddit.png': reddit };

// Each card is a NuxtLink — URL changes (real route per platform for SEO,
// shareable links and browser back/forward), but client-side navigation
// keeps the layout mounted so switching platforms feels like one
// continuous page. The state-reset side effects (clear search, posts,
// stories, ui) that used to live here are now done by pages/[platform].vue
// via a watchEffect on route.params.platform — keeping a single source of
// truth and making direct navigation work the same as in-app clicks.
const route = useRoute();
</script>

<template>
  <div class="platforms">
    <NuxtLink
      v-for="p in PLATFORM_LIST"
      :key="p.id"
      :to="`/${p.id}`"
      class="platform-card"
      :class="{ active: route.params.platform === p.id }"
    >
      <div class="p-icon">
        <img :src="ICONS[p.icon]" :alt="p.label" width="28" height="28">
      </div>
      <div class="p-label">{{ p.label }}</div>
    </NuxtLink>
  </div>
</template>
