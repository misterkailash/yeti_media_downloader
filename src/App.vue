<script setup>
import { onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import Hero from './components/Hero.vue';
import PlatformPicker from './components/PlatformPicker.vue';
import SearchBar from './components/SearchBar.vue';
import LoadingSpinner from './components/LoadingSpinner.vue';
import ErrorBanner from './components/ErrorBanner.vue';
import AuthWarningBanner from './components/AuthWarningBanner.vue';
import ProfileResult from './components/ProfileResult.vue';
import VideoResult from './components/VideoResult.vue';
import StoriesSection from './components/StoriesSection.vue';
import HighlightsSection from './components/HighlightsSection.vue';
import PostsGrid from './components/PostsGrid.vue';
import PostModal from './components/PostModal.vue';
import StoryViewer from './components/StoryViewer.vue';
import LoginModal from './components/LoginModal.vue';
import BackToTop from './components/BackToTop.vue';
import { useLoginStore } from './stores/login';
import { usePostsStore } from './stores/posts';

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
    <Hero />
    <h2 class="section-title">Select the Platform of your Media</h2>
    <PlatformPicker />
    <SearchBar />
    <LoadingSpinner />
    <ErrorBanner />
    <AuthWarningBanner />
    <ProfileResult />
    <VideoResult />
    <StoriesSection />
    <HighlightsSection />
    <PostsGrid />
  </main>
  <PostModal />
  <StoryViewer />
  <LoginModal />
  <BackToTop />
</template>
