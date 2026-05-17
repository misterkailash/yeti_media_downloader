<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePostsStore } from '../stores/posts';
import { useLoginStore } from '../stores/login';

const props = defineProps({
  // When supplied, hides the internal All/Posts/Reels/Videos tabs and the
  // section header, and shows only posts of the given category. Used by
  // InstagramTabs so the outer PROFILE/PHOTO/VIDEO/REELS tabs drive the
  // filtering instead of the in-grid filter.
  // Values: '' (default — show internal tabs) | 'photo' | 'video' | 'reel'
  category: { type: String, default: '' },
  hideHeader: { type: Boolean, default: false },
});

const posts = usePostsStore();
const login = useLoginStore();
const { visible, allPosts, filteredPosts, currentFilter, loadingInitial, emptyMessage, isPrivate } = storeToRefs(posts);

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Posts' },
  { id: 'reel', label: 'Reels' },
  { id: 'video', label: 'Videos' },
];

// When the parent passes `category`, derive the visible posts locally
// (Photo = image + carousel; the in-store filter doesn't merge those).
const categoryPosts = computed(() => {
  if (!props.category) return null;
  return allPosts.value.filter((p) => {
    if (props.category === 'photo') return p.type === 'image' || p.type === 'carousel';
    if (props.category === 'video') return p.type === 'video';
    if (props.category === 'reel') return p.type === 'reel';
    return true;
  });
});

const displayPosts = computed(() => categoryPosts.value ?? filteredPosts.value);
const showInternalTabs = computed(() => !props.category);
const emptyFallback = computed(() => {
  if (emptyMessage.value) return emptyMessage.value;
  if (!displayPosts.value.length) {
    if (props.category === 'photo') return 'No photos.';
    if (props.category === 'video') return 'No videos.';
    if (props.category === 'reel') return 'No reels.';
    return 'No posts match this filter.';
  }
  return '';
});

function thumb(url) {
  return '/api/image-proxy?url=' + encodeURIComponent(url);
}
function badge(type) {
  if (type === 'reel') return 'Reel';
  if (type === 'video') return 'Video';
  if (type === 'carousel') return 'Album';
  return '';
}
function formatStat(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n;
}
</script>

<template>
  <div class="posts-section" :class="{ visible }">
    <!-- Initial fetch: show ONLY a spinner. We hide the "Posts & Reels"
         header and tabs so a private result never causes them to flash on
         screen before being replaced by the locked-account panel. -->
    <div v-if="loadingInitial" class="posts-loader posts-loader-initial">
      <div class="spinner"></div>
    </div>
    <div v-else-if="isPrivate" class="posts-private">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#aaa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
      <strong>This Account is Private</strong>
      <span class="posts-private-sub">Log in with an account that follows this user to see their posts.</span>
      <button class="private-login-btn" @click="login.open()">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Login with Instagram
      </button>
    </div>
    <template v-else>
      <h3 v-if="!hideHeader">Posts &amp; Reels</h3>
      <div v-if="showInternalTabs" class="posts-tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          :class="{ active: currentFilter === t.id }"
          @click="posts.setFilter(t.id)"
        >{{ t.label }}</button>
      </div>
      <div class="posts-grid">
        <div v-if="emptyFallback" class="posts-empty">{{ emptyFallback }}</div>
        <template v-else>
          <div
            v-for="p in displayPosts"
            :key="p.id || p.code"
            class="post-item"
            @click="posts.openModal(p)"
          >
            <img :src="thumb(p.thumbnail)" alt="Post" loading="lazy">
            <div class="post-overlay">
              <span class="stat">
                <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                {{ formatStat(p.likeCount) }}
              </span>
              <span class="stat">
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                {{ formatStat(p.commentCount) }}
              </span>
            </div>
            <span v-if="badge(p.type)" class="post-type-badge">{{ badge(p.type) }}</span>
          </div>
        </template>
      </div>
      <div v-if="posts.loadingMore" class="posts-loader"><div class="spinner"></div></div>
    </template>
  </div>
</template>
