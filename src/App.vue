<script setup>
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import Sidebar from './components/Sidebar.vue';
import Hero from './components/Hero.vue';
import PlatformPicker from './components/PlatformPicker.vue';
import SearchBar from './components/SearchBar.vue';
import LoadingSpinner from './components/LoadingSpinner.vue';
import ErrorBanner from './components/ErrorBanner.vue';
import AuthWarningBanner from './components/AuthWarningBanner.vue';
import PostModal from './components/PostModal.vue';
import StoryViewer from './components/StoryViewer.vue';
import LoginModal from './components/LoginModal.vue';
import BackToTop from './components/BackToTop.vue';

import SessionsPage from './pages/SessionsPage.vue';

// Per-platform views — each composes the right result components and
// owns its rendering rules. Switched by `platform.current` below.
import Instagram from './platforms/Instagram.vue';
import Facebook from './platforms/Facebook.vue';
import FacebookVideo from './platforms/FacebookVideo.vue';
import Threads from './platforms/Threads.vue';
import TikTokDP from './platforms/TikTokDP.vue';
import TikTokVideo from './platforms/TikTokVideo.vue';
import YouTube from './platforms/YouTube.vue';
import SoundCloud from './platforms/SoundCloud.vue';
import Reddit from './platforms/Reddit.vue';
import X from './platforms/X.vue';
import VSCO from './platforms/VSCO.vue';

import { useLoginStore } from './stores/login';
import { usePostsStore } from './stores/posts';
import { usePlatformStore } from './stores/platform';
import { useUiStore } from './stores/ui';

const loginStore = useLoginStore();
const postsStore = usePostsStore();
const platform = usePlatformStore();
const ui = useUiStore();
const { current } = storeToRefs(platform);
const { view } = storeToRefs(ui);

onMounted(() => {
  loginStore.checkSession();
  window.addEventListener('scroll', postsStore.handleScroll);
});
</script>

<template>
  <Sidebar />
  <main class="main">
    <template v-if="view === 'sessions'">
      <SessionsPage />
    </template>
    <template v-else>
      <Hero />
      <h2 class="section-title">Select the Platform of your Media</h2>
      <PlatformPicker />
      <SearchBar />
      <LoadingSpinner />
      <ErrorBanner />
      <AuthWarningBanner />

      <Instagram   v-if="current === 'instagram'" />
      <Facebook    v-else-if="current === 'facebook'" />
      <FacebookVideo v-else-if="current === 'facebook-videos'" />
      <Threads     v-else-if="current === 'threads'" />
      <TikTokDP    v-else-if="current === 'tiktok'" />
      <TikTokVideo v-else-if="current === 'tiktok-videos'" />
      <YouTube     v-else-if="current === 'youtube'" />
      <SoundCloud  v-else-if="current === 'soundcloud'" />
      <Reddit      v-else-if="current === 'reddit'" />
      <X           v-else-if="current === 'x'" />
      <VSCO        v-else-if="current === 'vsco'" />
    </template>
  </main>
  <PostModal />
  <StoryViewer />
  <LoginModal />
  <BackToTop />
</template>
