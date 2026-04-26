import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { handleIgAuth } from './search';

function postFileName(handle, post, suffix, ext) {
  const d = post.timestamp ? new Date(post.timestamp * 1000) : new Date();
  const date = d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
  const base = handle + '_' + date + '_' + (post.code || post.id);
  return base + (suffix ? '_' + suffix : '') + (ext ? '.' + ext : '');
}

export const usePostsStore = defineStore('posts', () => {
  const visible = ref(false);
  const allPosts = ref([]);
  const currentFilter = ref('all');
  const nextMaxId = ref(null);
  const currentHandle = ref('');
  const loadingMore = ref(false);
  const loadingInitial = ref(false);
  const emptyMessage = ref('');
  const isPrivate = ref(false);

  // Modal state
  const modalOpen = ref(false);
  const modalPost = ref(null);
  const modalCaption = ref('');
  const carouselIndex = ref(0);

  const filteredPosts = computed(() =>
    currentFilter.value === 'all'
      ? allPosts.value
      : allPosts.value.filter((p) => p.type === currentFilter.value)
  );

  function reset() {
    visible.value = false;
    allPosts.value = [];
    currentFilter.value = 'all';
    nextMaxId.value = null;
    currentHandle.value = '';
    loadingMore.value = false;
    loadingInitial.value = false;
    emptyMessage.value = '';
    isPrivate.value = false;
    modalOpen.value = false;
    modalPost.value = null;
  }

  async function fetchPosts(handle) {
    currentHandle.value = handle;
    nextMaxId.value = null;
    allPosts.value = [];
    isPrivate.value = false;
    emptyMessage.value = '';
    visible.value = true;
    loadingInitial.value = true;
    try {
      const res = await fetch('/api/ig-posts/' + encodeURIComponent(handle));
      if (await handleIgAuth(res)) {
        emptyMessage.value = 'Posts unavailable — see the banner above.';
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        emptyMessage.value = 'Failed to load posts.';
        return;
      }
      if (data.private) {
        isPrivate.value = true;
        return;
      }
      if (!data.posts || data.posts.length === 0) {
        emptyMessage.value = 'No posts found.';
        return;
      }
      allPosts.value = data.posts;
      nextMaxId.value = data.next_max_id || null;
      currentFilter.value = 'all';
    } catch (_) {
      emptyMessage.value = 'Failed to load posts.';
    } finally {
      loadingInitial.value = false;
    }
  }

  async function loadMore() {
    if (loadingMore.value || !nextMaxId.value || !currentHandle.value) return;
    loadingMore.value = true;
    try {
      const res = await fetch('/api/ig-posts/' + encodeURIComponent(currentHandle.value) + '?max_id=' + encodeURIComponent(nextMaxId.value));
      const data = await res.json();
      if (!res.ok || !data.posts || data.posts.length === 0) {
        nextMaxId.value = null;
        return;
      }
      allPosts.value = allPosts.value.concat(data.posts);
      nextMaxId.value = data.next_max_id || null;
    } catch (_) {
      nextMaxId.value = null;
    } finally {
      loadingMore.value = false;
    }
  }

  function handleScroll() {
    if (!visible.value || !nextMaxId.value) return;
    const threshold = 400;
    if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - threshold)) {
      loadMore();
    }
  }

  function setFilter(f) {
    currentFilter.value = f;
  }

  function openModal(post) {
    modalPost.value = post;
    modalCaption.value = post.caption || '';
    carouselIndex.value = 0;
    modalOpen.value = true;
  }

  function closeModal() {
    modalOpen.value = false;
    modalPost.value = null;
  }

  function setCarouselIndex(i) {
    carouselIndex.value = i;
  }

  return {
    visible, allPosts, currentFilter, nextMaxId, currentHandle, loadingMore, loadingInitial,
    emptyMessage, isPrivate, modalOpen, modalPost, modalCaption, carouselIndex,
    filteredPosts,
    reset, fetchPosts, loadMore, handleScroll, setFilter, openModal, closeModal, setCarouselIndex,
    postFileName,
  };
});
