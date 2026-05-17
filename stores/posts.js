import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { handleIgAuth } from './authHandler';

function postFileName(handle, post, suffix, ext) {
  const base = handle + '_' + (post.code || post.id);
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

  // Bulk-download state (one in-flight at a time across all categories)
  const bulkDownloading = ref(false);
  const bulkCategory = ref('');     // 'photo' | 'reel' | 'video'
  const bulkLabel = ref('');

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
    bulkDownloading.value = false;
    bulkCategory.value = '';
    bulkLabel.value = '';
  }

  // Flatten the loaded feed into a list of downloadable items for a tab.
  // - Photo  → image posts (thumbnail) + every slide of carousel posts
  // - Video  → standalone video posts (videoUrl)
  // - Reel   → reels (videoUrl)
  function buildBulkItems(category) {
    const handle = currentHandle.value || 'instagram';
    const items = [];
    let i = 0;
    for (const p of allPosts.value) {
      const code = p.code || p.id;
      if (category === 'photo') {
        if (p.type === 'image' && p.thumbnail) {
          items.push({ url: p.thumbnail, ext: 'jpg', name: `${handle}_${code}` });
        } else if (p.type === 'carousel' && Array.isArray(p.carouselItems)) {
          let slideIdx = 0;
          for (const ci of p.carouselItems) {
            slideIdx++;
            if (ci.type === 'video' && ci.videoUrl) {
              items.push({ url: ci.videoUrl, ext: 'mp4', name: `${handle}_${code}_${slideIdx}` });
            } else if (ci.url) {
              items.push({ url: ci.url, ext: 'jpg', name: `${handle}_${code}_${slideIdx}` });
            }
          }
        }
      } else if (category === 'video' && p.type === 'video' && p.videoUrl) {
        items.push({ url: p.videoUrl, ext: 'mp4', name: `${handle}_${code}` });
      } else if (category === 'reel' && p.type === 'reel' && p.videoUrl) {
        items.push({ url: p.videoUrl, ext: 'mp4', name: `${handle}_reel_${code}` });
      }
      i++;
    }
    return items;
  }

  // Bulk-download every item visible in the given tab as a single zip.
  // Chrome blocks N sequential programmatic downloads, so we ship the URLs
  // to the server, let it fetch + bundle, and stream one zip back.
  async function bulkDownload(category) {
    if (bulkDownloading.value) return;
    const items = buildBulkItems(category);
    if (!items.length) return;

    const handle = currentHandle.value || 'instagram';
    const zipBase = `${handle}_${category === 'photo' ? 'photos' : category === 'video' ? 'videos' : 'reels'}`;
    bulkDownloading.value = true;
    bulkCategory.value = category;
    bulkLabel.value = `Packing ${items.length}…`;
    try {
      const res = await fetch('/api/ig-bulk-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: zipBase, items }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = zipBase + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      bulkLabel.value = `Downloaded (${items.length})`;
    } catch (err) {
      console.warn('bulk download failed', err);
      bulkLabel.value = 'Failed — try again';
    } finally {
      setTimeout(() => {
        bulkDownloading.value = false;
        bulkCategory.value = '';
        bulkLabel.value = '';
      }, 1800);
    }
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
    bulkDownloading, bulkCategory, bulkLabel,
    filteredPosts,
    reset, fetchPosts, loadMore, handleScroll, setFilter, openModal, closeModal, setCarouselIndex,
    postFileName, buildBulkItems, bulkDownload,
  };
});
