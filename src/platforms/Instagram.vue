<script setup>
// Instagram view: profile picture + posts grid + stories + highlights.
// The IG-specific render is by far the richest of the platforms — these
// four sections all read from the shared search/posts/stories stores
// and self-hide when their data is empty.
import ProfileResult from '../components/ProfileResult.vue';
import StoriesSection from '../components/StoriesSection.vue';
import HighlightsSection from '../components/HighlightsSection.vue';
import PostsGrid from '../components/PostsGrid.vue';
</script>

<template>
  <ProfileResult />
  <StoriesSection />
  <HighlightsSection />
  <PostsGrid />
</template>
