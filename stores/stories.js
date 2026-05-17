import { defineStore } from 'pinia';
import { ref } from 'vue';
import { handleIgAuth } from './authHandler';
import { useUiStore } from './ui';

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function dateStr(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

async function blobDownload(url, filename) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}

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
  const viewerKind = ref('');   // 'story' | 'highlight'
  const viewerTitle = ref('');  // highlight title (empty for stories)

  // Bulk download state (current reel)
  const dlAllRunning = ref(false);
  const dlAllDone = ref(0);
  const dlAllTotal = ref(0);
  const dlAllErrors = ref(0);

  // Tab-level bulk-zip state (stories / highlights). Mirrors the posts
  // store's bulk state so InstagramTabs can render a single button.
  const bulkDownloading = ref(false);
  const bulkCategory = ref('');   // 'stories' | 'highlights'
  const bulkLabel = ref('');

  function reset() {
    stories.value = [];
    highlights.value = [];
    storiesVisible.value = false;
    highlightsVisible.value = false;
    viewerOpen.value = false;
    viewerKind.value = '';
    viewerTitle.value = '';
    dlAllRunning.value = false;
    dlAllDone.value = 0;
    dlAllTotal.value = 0;
    dlAllErrors.value = 0;
    bulkDownloading.value = false;
    bulkCategory.value = '';
    bulkLabel.value = '';
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
    viewerHandle.value = handle;
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

  async function downloadCurrentReel() {
    if (dlAllRunning.value) return;
    if (!viewerItems.value.length) return;
    const handle = viewerHandle.value || 'instagram';
    const kind = viewerKind.value || 'reel';
    const titleSlug = slugify(viewerTitle.value) || kind;

    dlAllRunning.value = true;
    dlAllDone.value = 0;
    dlAllTotal.value = viewerItems.value.length;
    dlAllErrors.value = 0;

    let idx = 0;
    for (const item of viewerItems.value) {
      idx++;
      const isVideo = item.type === 'video' && item.videoUrl;
      const sourceUrl = isVideo ? item.videoUrl : item.thumbnail;
      if (!sourceUrl) { dlAllErrors.value++; dlAllDone.value++; continue; }
      const ext = isVideo ? 'mp4' : 'jpg';
      const baseName = kind === 'highlight'
        ? `${handle}_highlight-${titleSlug}_${dateStr(item.timestamp)}_${String(idx).padStart(2, '0')}_${item.id}`
        : `${handle}_story_${dateStr(item.timestamp)}_${String(idx).padStart(2, '0')}_${item.id}`;
      const fileName = `${baseName}.${ext}`;
      const proxyUrl = isVideo
        ? '/api/ig-video-proxy?url=' + encodeURIComponent(sourceUrl) + '&name=' + encodeURIComponent(baseName)
        : '/api/image-proxy?url=' + encodeURIComponent(sourceUrl) + '&name=' + encodeURIComponent(baseName);
      try {
        await blobDownload(proxyUrl, fileName);
      } catch (e) {
        console.warn('reel item download failed', fileName, e);
        dlAllErrors.value++;
      }
      dlAllDone.value++;
      await new Promise((r) => setTimeout(r, 150));
    }

    dlAllRunning.value = false;
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
      const matched = highlights.value.find((h) => h.id === hlId);
      viewerKind.value = 'highlight';
      viewerTitle.value = (matched && matched.title) || data.title || '';
      viewerOpen.value = true;
      // Fire-and-forget HD upgrade. The mobile reels_media endpoint serves
      // capped video_versions (~720x1280); yt-dlp via /api/ig-highlight-versions/
      // returns full 1080x1920 variants. We swap them in once available so
      // downloads use the highest available quality. Already-open viewer
      // sessions keep working with the degraded URLs in the meantime.
      upgradeHighlightToHd(hlId);
    } catch (e) {
      console.warn('highlight error', e);
      ui.showAuthWarn('Network error loading highlight. Check your connection.');
    }
  }

  async function upgradeHighlightToHd(hlId) {
    try {
      const res = await fetch('/api/ig-highlight-versions/' + encodeURIComponent(hlId));
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.items) || !data.items.length) return;
      const byId = new Map(data.items.map((it) => [String(it.id), it.videoVersions]));
      // Bail if the viewer moved on to a different highlight while yt-dlp ran.
      if (!viewerOpen.value || viewerKind.value !== 'highlight') return;
      viewerItems.value = viewerItems.value.map((it) => {
        const hd = byId.get(String(it.id));
        if (hd && hd.length && hd[0].url) {
          return { ...it, videoUrl: hd[0].url, videoVersions: hd };
        }
        return it;
      });
    } catch (_) { /* ignore - viewer keeps degraded versions */ }
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
    viewerKind.value = 'story';
    viewerTitle.value = '';
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

  function itemsFromStoryArray(arr, handle, kind, titleSlug) {
    const out = [];
    let idx = 0;
    for (const s of arr) {
      idx++;
      const isVideo = s.type === 'video' && s.videoUrl;
      const sourceUrl = isVideo ? s.videoUrl : s.thumbnail;
      if (!sourceUrl) continue;
      const baseName = kind === 'highlight'
        ? `${handle}_highlight-${titleSlug}_${dateStr(s.timestamp)}_${String(idx).padStart(2, '0')}_${s.id}`
        : `${handle}_story_${dateStr(s.timestamp)}_${String(idx).padStart(2, '0')}_${s.id}`;
      out.push({ url: sourceUrl, ext: isVideo ? 'mp4' : 'jpg', name: baseName });
    }
    return out;
  }

  async function bulkZipAndSave(category, items, zipBase) {
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

  async function bulkDownloadStories() {
    if (bulkDownloading.value || !stories.value.length) return;
    const handle = viewerHandle.value || 'instagram';
    const items = itemsFromStoryArray(stories.value, handle, 'story', '');
    if (!items.length) return;
    await bulkZipAndSave('stories', items, `${handle}_stories`);
  }

  // Highlights need per-highlight item fetches first. Walk them
  // sequentially so we don't blast IG with N parallel requests; bail out
  // of a single failure rather than aborting the whole batch.
  async function bulkDownloadHighlights() {
    if (bulkDownloading.value || !highlights.value.length) return;
    const handle = viewerHandle.value || 'instagram';
    bulkDownloading.value = true;
    bulkCategory.value = 'highlights';
    bulkLabel.value = `Fetching 0/${highlights.value.length}…`;

    const allItems = [];
    let i = 0;
    for (const hl of highlights.value) {
      i++;
      bulkLabel.value = `Fetching ${i}/${highlights.value.length}…`;
      try {
        const res = await fetch('/api/ig-highlight/' + encodeURIComponent(hl.id));
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data.items)) continue;
        const titleSlug = slugify(hl.title) || 'highlight';
        allItems.push(...itemsFromStoryArray(data.items, handle, 'highlight', titleSlug));
      } catch (_) { /* skip and continue */ }
    }

    if (!allItems.length) {
      bulkLabel.value = 'Nothing to download';
      setTimeout(() => {
        bulkDownloading.value = false;
        bulkCategory.value = '';
        bulkLabel.value = '';
      }, 1800);
      return;
    }

    // Hand off to the shared zipper. It owns the loading-state reset.
    bulkDownloading.value = false; // reset so bulkZipAndSave can set it
    await bulkZipAndSave('highlights', allItems, `${handle}_highlights`);
  }

  return {
    stories, highlights, storiesVisible, highlightsVisible,
    viewerItems, viewerIndex, viewerOpen, viewerHandle,
    viewerKind, viewerTitle,
    dlAllRunning, dlAllDone, dlAllTotal, dlAllErrors,
    bulkDownloading, bulkCategory, bulkLabel,
    reset, hideAll, fetchStories, fetchHighlights,
    openStory, openHighlight, closeViewer, nextItem, prevItem,
    downloadCurrentReel,
    bulkDownloadStories, bulkDownloadHighlights,
  };
});
