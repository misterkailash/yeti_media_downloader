import { defineStore } from 'pinia';
import { ref } from 'vue';

export const PLATFORMS = {
  instagram: {
    endpoint: '/api/profile/',
    placeholder: 'enter instagram username',
    hint: 'Instagram username — e.g. zuck',
    statLabels: { followers: 'followers', following: 'following', posts: 'posts' },
  },
  facebook: {
    endpoint: '/api/fb-profile/',
    placeholder: 'enter facebook username or page',
    hint: 'Facebook username or page — e.g. zuck, cristiano',
    statLabels: { followers: 'followers', following: 'talking about', posts: null },
  },
  threads: {
    kind: 'profile',
    endpoint: '/api/threads-profile/',
    placeholder: 'enter threads username',
    hint: 'Threads username — e.g. zuck',
    statLabels: { followers: 'followers', following: 'following', posts: 'threads' },
  },
  vsco: {
    kind: 'image',
    endpoint: '/api/vsco-post?url=',
    placeholder: 'paste vsco post URL',
    hint: 'VSCO post URL — e.g. https://vsco.co/user/media/abc123...',
  },
  tiktok: {
    kind: 'profile',
    endpoint: '/api/tt-profile/',
    placeholder: 'enter tiktok username',
    hint: 'TikTok username — e.g. khaby.lame',
    statLabels: { followers: 'followers', following: 'following', posts: 'videos' },
  },
  'tiktok-videos': {
    kind: 'video',
    endpoint: '/api/tt-video?url=',
    placeholder: 'paste tiktok video URL',
    hint: 'TikTok video URL — e.g. https://www.tiktok.com/@user/video/123',
  },
};

export const PLATFORM_LIST = [
  { id: 'instagram', label: 'Insta Save', icon: 'instagram.png' },
  { id: 'facebook', label: 'FB Save', icon: 'facebook.png' },
  { id: 'threads', label: 'Threads Save', icon: 'threads.png' },
  { id: 'tiktok', label: 'TikTok Save', icon: 'tiktok.png' },
  { id: 'tiktok-videos', label: 'TikTok Videos', icon: 'tiktok.png' },
  { id: 'vsco', label: 'VSCO Post', icon: 'vsco.png' },
];

export const usePlatformStore = defineStore('platform', () => {
  const current = ref('instagram');
  const config = (id) => PLATFORMS[id];
  function set(id) {
    if (id === current.value) return;
    current.value = id;
  }
  return { current, config, set, PLATFORMS, PLATFORM_LIST };
});
