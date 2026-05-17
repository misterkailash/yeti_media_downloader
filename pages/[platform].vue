<script setup>
import { storeToRefs } from 'pinia';

// Static metadata per platform — drives <title>, description and Open Graph
// tags so each route has its own SEO-friendly head. Keep keys in sync with
// stores/platform.js PLATFORMS.
const META = {
  instagram: {
    title: 'Instagram Profile & DP Downloader — Yeti',
    description: 'Download Instagram profile pictures in HD, view stories, highlights and posts. Free, no login required for public profiles.',
  },
  'instagram-post': {
    title: 'Instagram Post & Reel Downloader — Yeti',
    description: 'Paste any Instagram post or reel URL to download photos and videos in original quality. Supports /p/, /reel/ and /tv/ links.',
  },
  facebook: {
    title: 'Facebook Profile Picture Downloader — Yeti',
    description: 'Download Facebook profile pictures and page logos in full HD quality. Just enter a username or page name.',
  },
  'facebook-videos': {
    title: 'Facebook Video Downloader — Yeti',
    description: 'Download Facebook videos in MP4 — public watch links, page posts and fb.watch shortlinks. Login-gated videos supported with FB session.',
  },
  threads: {
    title: 'Threads Profile Downloader — Yeti',
    description: 'Download Threads profile pictures and follower stats. Works with any public Threads handle.',
  },
  vsco: {
    title: 'VSCO Post Downloader — Yeti',
    description: 'Download VSCO photos in original resolution. Paste any VSCO post URL.',
  },
  tiktok: {
    title: 'TikTok Profile Picture Downloader — Yeti',
    description: 'Download TikTok profile pictures and view follower stats. Just enter a TikTok username.',
  },
  'tiktok-videos': {
    title: 'TikTok Video Downloader (No Watermark) — Yeti',
    description: 'Download TikTok videos in HD without watermark. Paste any tiktok.com or vt.tiktok.com URL.',
  },
  x: {
    title: 'X / Twitter Video & Photo Downloader — Yeti',
    description: 'Download photos and videos from X (Twitter) posts. Paste any tweet URL.',
  },
  youtube: {
    title: 'YouTube Video Downloader — Yeti',
    description: 'Download YouTube videos from 144p to 4K with audio. Paste any YouTube link.',
  },
  soundcloud: {
    title: 'SoundCloud MP3 Downloader (320 kbps) — Yeti',
    description: 'Download SoundCloud tracks as 320 kbps MP3. Paste any SoundCloud track URL.',
  },
  reddit: {
    title: 'Reddit Video Downloader — Yeti',
    description: 'Download Reddit videos with audio muxed. Paste any reddit.com / redd.it / v.redd.it URL.',
  },
};

definePageMeta({
  // Reject unknown slugs at the router level → Nuxt returns a 404 page.
  validate(route) {
    return Object.prototype.hasOwnProperty.call({
      instagram: 1, 'instagram-post': 1, facebook: 1, 'facebook-videos': 1,
      threads: 1, vsco: 1, tiktok: 1, 'tiktok-videos': 1,
      x: 1, youtube: 1, soundcloud: 1, reddit: 1,
    }, route.params.platform);
  },
});

const route = useRoute();
const platform = usePlatformStore();
const search = useSearchStore();
const posts = usePostsStore();
const stories = useStoriesStore();
const ui = useUiStore();
const { current } = storeToRefs(platform);

// Keep the platform store in lockstep with the URL. Watching the route
// param (rather than relying on PlatformPicker's click handler) means
// direct navigation to /tiktok and browser back/forward both Just Work.
watchEffect(() => {
  const slug = route.params.platform;
  if (slug && slug !== current.value) {
    platform.set(slug);
    search.clearResults();
    posts.reset();
    stories.reset();
    ui.clearError();
    ui.hideAuthWarn();
    search.hideSuggest();
    search.query = '';
  }
});

const meta = computed(() => META[route.params.platform] || META.instagram);
useSeoMeta({
  title: () => meta.value.title,
  description: () => meta.value.description,
  ogTitle: () => meta.value.title,
  ogDescription: () => meta.value.description,
  ogType: 'website',
  twitterCard: 'summary_large_image',
});
</script>

<template>
  <Hero />
  <h2 class="section-title">Select the Platform of your Media</h2>
  <PlatformPicker />
  <SearchBar />
  <LoadingSpinner />
  <ErrorBanner />
  <AuthWarningBanner />

  <Instagram     v-if="current === 'instagram'" />
  <InstagramPost v-else-if="current === 'instagram-post'" />
  <Facebook      v-else-if="current === 'facebook'" />
  <FacebookVideo v-else-if="current === 'facebook-videos'" />
  <Threads       v-else-if="current === 'threads'" />
  <TikTokDP      v-else-if="current === 'tiktok'" />
  <TikTokVideo   v-else-if="current === 'tiktok-videos'" />
  <YouTube       v-else-if="current === 'youtube'" />
  <SoundCloud    v-else-if="current === 'soundcloud'" />
  <Reddit        v-else-if="current === 'reddit'" />
  <X             v-else-if="current === 'x'" />
  <VSCO          v-else-if="current === 'vsco'" />
</template>
