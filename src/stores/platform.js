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
  'facebook-videos': {
    kind: 'fb-video',
    endpoint: '/api/fb-video-info?url=',
    placeholder: 'paste facebook video URL',
    hint: 'Facebook video URL — e.g. https://www.facebook.com/watch?v=123 or https://fb.watch/abc',
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
  x: {
    kind: 'tweet',
    endpoint: '/api/x-tweet?url=',
    placeholder: 'paste tweet URL',
    hint: 'X / Twitter post URL — e.g. https://x.com/user/status/1234567890',
  },
  youtube: {
    kind: 'youtube',
    endpoint: '/api/yt-info?url=',
    placeholder: 'paste youtube video URL',
    hint: 'YouTube video URL — e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  },
  soundcloud: {
    kind: 'soundcloud',
    endpoint: '/api/sc-info?url=',
    placeholder: 'paste soundcloud track URL',
    hint: 'SoundCloud track URL — e.g. https://soundcloud.com/artist/track-name',
  },
  reddit: {
    kind: 'reddit',
    endpoint: '/api/rd-info?url=',
    placeholder: 'paste reddit post URL',
    hint: 'Reddit post URL — e.g. https://www.reddit.com/r/funny/comments/abc123/title/',
  },
};

export const PLATFORM_LIST = [
  { id: 'instagram', label: 'Insta Save', icon: 'instagram.png' },
  { id: 'facebook', label: 'Facebook DP', icon: 'facebook.png' },
  { id: 'facebook-videos', label: 'FB Videos', icon: 'facebook.png' },
  { id: 'threads', label: 'Threads Save', icon: 'threads.png' },
  { id: 'tiktok', label: 'TikTok DP', icon: 'tiktok.png' },
  { id: 'tiktok-videos', label: 'TikTok Videos', icon: 'tiktok.png' },
  { id: 'x', label: 'X Save', icon: 'x.png' },
  { id: 'youtube', label: 'YouTube', icon: 'youtube.png' },
  { id: 'soundcloud', label: 'SoundCloud', icon: 'soundcloud.png' },
  { id: 'reddit', label: 'Reddit', icon: 'reddit.png' },
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
