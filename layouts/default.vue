<script setup>
import { onMounted } from 'vue';

// Persistent shell: Sidebar + modals stay mounted across route changes,
// so navigating between platforms (or to /sessions, /faq, etc.) is just a
// `<slot />` swap — no flash, no flicker, no remount of overlays.
const loginStore = useLoginStore();
const postsStore = usePostsStore();

onMounted(() => {
  loginStore.checkSession();
  window.addEventListener('scroll', postsStore.handleScroll);
});
</script>

<template>
  <Sidebar />
  <main class="main">
    <slot />
  </main>
  <PostModal />
  <StoryViewer />
  <LoginModal />
  <BackToTop />
</template>
