<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';
import { usePostsStore } from '../stores/posts';
import { useStoriesStore } from '../stores/stories';

const search = useSearchStore();
const posts = usePostsStore();
const storiesStore = useStoriesStore();

const { profile } = storeToRefs(search);
const {
  allPosts,
  bulkDownloading: postsBulkDownloading,
  bulkCategory: postsBulkCategory,
  bulkLabel: postsBulkLabel,
} = storeToRefs(posts);
const {
  stories, highlights,
  bulkDownloading: storiesBulkDownloading,
  bulkCategory: storiesBulkCategory,
  bulkLabel: storiesBulkLabel,
} = storeToRefs(storiesStore);

const TABS = [
  { id: 'profile',    label: 'PROFILE' },
  { id: 'stories',    label: 'STORIES' },
  { id: 'highlights', label: 'HIGHLIGHTS' },
  { id: 'photo',      label: 'PHOTOS' },
  { id: 'reels',      label: 'REELS' },
  { id: 'video',      label: 'VIDEOS' },
];

const activeTab = ref('profile');
const previewOpen = ref(false);

function openPreview() { previewOpen.value = true; }
function closePreview() { previewOpen.value = false; }

function onKey(e) {
  if (e.key === 'Escape' && previewOpen.value) closePreview();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// Reset to PROFILE whenever a new search lands so the user always sees
// the bio/stats first rather than a stale tab from the prior account.
watch(profile, (p, prev) => {
  if (p && p !== prev) activeTab.value = 'profile';
});

const counts = computed(() => {
  const out = { photo: 0, video: 0, reel: 0 };
  for (const p of allPosts.value) {
    if (p.type === 'image' || p.type === 'carousel') out.photo++;
    else if (p.type === 'video') out.video++;
    else if (p.type === 'reel') out.reel++;
  }
  return out;
});

const badge = (id) => {
  if (id === 'photo')      return counts.value.photo || null;
  if (id === 'video')      return counts.value.video || null;
  if (id === 'reels')      return counts.value.reel || null;
  if (id === 'stories')    return stories.value.length || null;
  if (id === 'highlights') return highlights.value.length || null;
  return null;
};

const qualityLabel = computed(() => {
  const w = profile.value?.picWidth;
  if (!w) return '';
  if (w >= 1080) return `HD · ${w}×${w}`;
  return `${w}×${w}`;
});

// "Download all" wiring — each tab maps to a store + category, plus a
// human label that drives the button copy. Returned shape is what the
// template iterates over to decide whether to render the button.
const POSTS_CATEGORIES = { photo: 'photos', reel: 'reels', video: 'videos' };

const bulkAction = computed(() => {
  const id = activeTab.value;
  if (id === 'photo' || id === 'reels' || id === 'video') {
    const cat = id === 'reels' ? 'reel' : id;
    const totalItems = posts.buildBulkItems(cat).length;
    if (!totalItems) return null;
    const label = POSTS_CATEGORIES[cat];
    return {
      label: `Download all ${label}`,
      run: () => posts.bulkDownload(cat),
      busy: postsBulkDownloading.value && postsBulkCategory.value === cat,
      busyLabel: postsBulkLabel.value,
      count: totalItems,
    };
  }
  if (id === 'stories' && stories.value.length) {
    return {
      label: 'Download all stories',
      run: () => storiesStore.bulkDownloadStories(),
      busy: storiesBulkDownloading.value && storiesBulkCategory.value === 'stories',
      busyLabel: storiesBulkLabel.value,
      count: stories.value.length,
    };
  }
  if (id === 'highlights' && highlights.value.length) {
    return {
      label: 'Download all highlights',
      run: () => storiesStore.bulkDownloadHighlights(),
      busy: storiesBulkDownloading.value && storiesBulkCategory.value === 'highlights',
      busyLabel: storiesBulkLabel.value,
      count: highlights.value.length,
    };
  }
  return null;
});

async function saveAvatar(e) {
  e.preventDefault();
  const p = profile.value;
  if (!p?.avatar) return;
  try {
    const r = await fetch(p.avatar);
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = p.downloadName || 'profile.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (_) {
    window.open(p.avatar, '_blank', 'noopener');
  }
}
</script>

<template>
  <div v-if="profile" class="ig-tabs-wrap" data-platform="instagram">
    <div class="ig-tabs-row">
    <nav class="ig-tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.id"
        :class="{ active: activeTab === t.id }"
        role="tab"
        :aria-selected="activeTab === t.id"
        @click="activeTab = t.id"
      >
        <span class="ig-tab-icon">
          <!-- PROFILE: id-card -->
          <svg v-if="t.id === 'profile'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="3"/>
            <circle cx="9" cy="11" r="2.2"/>
            <path d="M6 17c.7-1.6 2-2.5 3-2.5s2.3.9 3 2.5"/>
            <path d="M14.5 9h4"/><path d="M14.5 12h4"/><path d="M14.5 15h2.5"/>
          </svg>
          <!-- PHOTO: camera -->
          <svg v-else-if="t.id === 'photo'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8h3l2-2h6l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/>
            <circle cx="12" cy="13" r="3.5"/>
          </svg>
          <!-- VIDEO: play-circle -->
          <svg v-else-if="t.id === 'video'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
          </svg>
          <!-- STORIES: dashed ring with vertical bar -->
          <svg v-else-if="t.id === 'stories'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" stroke-dasharray="3 2.5"/>
            <line x1="12" y1="8" x2="12" y2="13"/>
            <circle cx="12" cy="16" r=".9" fill="currentColor" stroke="none"/>
          </svg>
          <!-- REELS: play in rounded square -->
          <svg v-else-if="t.id === 'reels'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4"/>
            <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
          </svg>
          <!-- HIGHLIGHTS: heart in circle -->
          <svg v-else-if="t.id === 'highlights'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <path d="M16.6 9.4a2.5 2.5 0 0 0-3.6 0L12 10.4l-1-1a2.5 2.5 0 0 0-3.6 3.6L12 17.6l4.6-4.6a2.5 2.5 0 0 0 0-3.6z" fill="currentColor" stroke="none"/>
          </svg>
        </span>
        <span class="ig-tab-label">{{ t.label }}</span>
        <span v-if="badge(t.id)" class="ig-tab-badge">{{ badge(t.id) }}</span>
      </button>
    </nav>
      <button
        v-if="bulkAction"
        class="ig-download-all"
        :disabled="bulkAction.busy"
        :title="bulkAction.label"
        @click="bulkAction.run"
      >
        <span v-if="bulkAction.busy" class="ig-da-spinner"></span>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span class="ig-da-label">
          {{ bulkAction.busy ? (bulkAction.busyLabel || 'Working…') : `${bulkAction.label} (${bulkAction.count})` }}
        </span>
      </button>
    </div>

    <div class="ig-tab-panel">
      <!-- PROFILE -->
      <section v-if="activeTab === 'profile'" class="ig-panel-profile">
        <button class="ig-bio-avatar" type="button" :title="'View full-size profile picture'" @click="openPreview">
          <img :src="profile.avatar" :alt="profile.fullName">
        </button>
        <div class="ig-bio-info">
          <div class="ig-bio-name">{{ profile.fullName }}</div>
          <div class="ig-bio-handle">{{ profile.username }}</div>
          <div v-if="profile.meta?.length" class="ig-bio-stats">
            <div v-for="(m, i) in profile.meta" :key="i" class="ig-stat">
              <strong>{{ m.value }}</strong>
              <span>{{ m.label }}</span>
            </div>
          </div>
          <div class="ig-dp-actions">
            <a class="btn-save-hd" :href="profile.avatar" @click="saveAvatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Save profile picture</span>
            </a>
            <span v-if="qualityLabel" class="quality-badge">{{ qualityLabel }}</span>
          </div>
        </div>
      </section>

      <!-- STORIES -->
      <section v-else-if="activeTab === 'stories'" class="ig-panel-grid">
        <StoriesSection v-if="stories.length" />
        <div v-else class="ig-empty">No active stories.</div>
      </section>

      <!-- HIGHLIGHTS -->
      <section v-else-if="activeTab === 'highlights'" class="ig-panel-grid">
        <HighlightsSection v-if="highlights.length" />
        <div v-else class="ig-empty">No highlights.</div>
      </section>

      <!-- PHOTOS -->
      <section v-else-if="activeTab === 'photo'" class="ig-panel-grid">
        <PostsGrid category="photo" hide-header />
      </section>

      <!-- REELS -->
      <section v-else-if="activeTab === 'reels'" class="ig-panel-grid">
        <PostsGrid category="reel" hide-header />
      </section>

      <!-- VIDEOS -->
      <section v-else-if="activeTab === 'video'" class="ig-panel-grid">
        <PostsGrid category="video" hide-header />
      </section>
    </div>

    <!-- Profile picture preview modal -->
    <Teleport to="body">
      <div v-if="previewOpen" class="ig-pp-backdrop" @click.self="closePreview">
        <button type="button" class="ig-pp-close" aria-label="Close" @click="closePreview">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
        <img class="ig-pp-frame" :src="profile.avatar" :alt="profile.fullName">
      </div>
    </Teleport>
  </div>
</template>
