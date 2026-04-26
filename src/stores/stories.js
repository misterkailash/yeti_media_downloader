import { defineStore } from 'pinia';
import { ref } from 'vue';
import { handleIgAuth } from './search';
import { useUiStore } from './ui';

export const useStoriesStore = defineStore('stories', () => {
  const stories = ref([]);
  const highlights = ref([]);
  const storiesVisible = ref(false);
  const highlightsVisible = ref(false);

  // Viewer
  const viewerItems = ref([]);
  const viewerIndex = ref(0);
  const viewerOpen = ref(false);
  const viewerHandle = ref('');

  function reset() {
    stories.value = [];
    highlights.value = [];
    storiesVisible.value = false;
    highlightsVisible.value = false;
    viewerOpen.value = false;
  }

  function hideAll() {
    storiesVisible.value = false;
    highlightsVisible.value = false;
  }

  async function fetchStories(handle) {
    storiesVisible.value = false;
    stories.value = [];
    viewerHandle.value = handle;
    try {
      const res = await fetch('/api/ig-stories/' + encodeURIComponent(handle));
      if (await handleIgAuth(res)) return;
      if (!res.ok) return;
      const data = await res.json();
      if (!data.stories || data.stories.length === 0) return;
      stories.value = data.stories;
      storiesVisible.value = true;
    } catch (e) { console.warn('stories error', e); }
  }

  async function fetchHighlights(handle) {
    highlightsVisible.value = false;
    highlights.value = [];
    try {
      const res = await fetch('/api/ig-highlights/' + encodeURIComponent(handle));
      if (await handleIgAuth(res)) return;
      if (!res.ok) return;
      const data = await res.json();
      if (!data.highlights || data.highlights.length === 0) return;
      highlights.value = data.highlights;
      highlightsVisible.value = true;
    } catch (e) { console.warn('highlights error', e); }
  }

  async function openHighlight(hlId) {
    const ui = useUiStore();
    try {
      const res = await fetch('/api/ig-highlight/' + encodeURIComponent(hlId));
      if (await handleIgAuth(res)) return;
      if (!res.ok) {
        ui.showAuthWarn(`Failed to load highlight (error ${res.status}). Try again.`);
        return;
      }
      const data = await res.json();
      if (!data.items || data.items.length === 0) {
        ui.showAuthWarn('This highlight has no viewable items.');
        return;
      }
      ui.hideAuthWarn();
      viewerItems.value = data.items.map((item) => ({
        type: item.type,
        thumbnail: item.thumbnail,
        videoUrl: item.videoUrl,
        id: item.id,
        timestamp: item.timestamp,
      }));
      viewerIndex.value = 0;
      viewerOpen.value = true;
    } catch (e) {
      console.warn('highlight error', e);
      ui.showAuthWarn('Network error loading highlight. Check your connection.');
    }
  }

  function openStory(idx) {
    viewerItems.value = stories.value.map((s) => ({
      type: s.type,
      thumbnail: s.thumbnail,
      videoUrl: s.videoUrl,
      id: s.id,
      timestamp: s.timestamp,
    }));
    viewerIndex.value = idx;
    viewerOpen.value = true;
  }

  function closeViewer() {
    viewerOpen.value = false;
  }

  function nextItem() {
    if (viewerIndex.value < viewerItems.value.length - 1) viewerIndex.value++;
    else closeViewer();
  }
  function prevItem() {
    if (viewerIndex.value > 0) viewerIndex.value--;
  }

  return {
    stories, highlights, storiesVisible, highlightsVisible,
    viewerItems, viewerIndex, viewerOpen, viewerHandle,
    reset, hideAll, fetchStories, fetchHighlights,
    openStory, openHighlight, closeViewer, nextItem, prevItem,
  };
});
