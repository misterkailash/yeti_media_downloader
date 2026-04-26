import { defineStore } from 'pinia';
import { ref } from 'vue';
import { usePlatformStore } from './platform';
import { useUiStore } from './ui';
import { usePostsStore } from './posts';
import { useStoriesStore } from './stories';

export { handleIgAuth } from './authHandler';

function formatBytes(n) {
  if (!n) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
  return n + ' B';
}

export const useSearchStore = defineStore('search', () => {
  const query = ref('');
  const profile = ref(null);   // { avatar, fullName, username, meta: [{value,label}], handle }
  const video = ref(null);     // { kind, cover, badges, nickname, author, description, downloadHref, downloadName, downloadLabel }

  // Autocomplete state
  const suggestUsers = ref([]);
  const suggestActiveIdx = ref(-1);
  const suggestVisible = ref(false);
  const suggestSearched = ref(false);
  let suggestTimer = null;
  let suggestSeq = 0;

  function clearResults() {
    profile.value = null;
    video.value = null;
  }

  function hideSuggest() {
    suggestVisible.value = false;
    suggestUsers.value = [];
    suggestActiveIdx.value = -1;
    suggestSearched.value = false;
  }

  async function runSuggest(q) {
    const seq = ++suggestSeq;
    try {
      const res = await fetch('/api/ig-search?q=' + encodeURIComponent(q));
      if (seq !== suggestSeq) return;
      const data = await res.json();
      if (seq !== suggestSeq) return;
      suggestUsers.value = data.users || [];
      suggestActiveIdx.value = -1;
      suggestSearched.value = true;
      suggestVisible.value = true;
    } catch (_) { /* ignore */ }
  }

  function onInput(value) {
    query.value = value;
    const platform = usePlatformStore();
    if (platform.current !== 'instagram') {
      hideSuggest();
      return;
    }
    const q = value.trim().replace(/^@/, '');
    clearTimeout(suggestTimer);
    if (q.length < 1) {
      hideSuggest();
      return;
    }
    suggestTimer = setTimeout(() => runSuggest(q), 120);
  }

  function pickSuggest(idx) {
    const u = suggestUsers.value[idx];
    if (!u) return;
    query.value = u.username;
    hideSuggest();
    submit();
  }

  function suggestKeyDown(e) {
    if (!suggestVisible.value || !suggestUsers.value.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestActiveIdx.value = (suggestActiveIdx.value + 1) % suggestUsers.value.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestActiveIdx.value = (suggestActiveIdx.value - 1 + suggestUsers.value.length) % suggestUsers.value.length;
    } else if (e.key === 'Enter' && suggestActiveIdx.value >= 0) {
      e.preventDefault();
      pickSuggest(suggestActiveIdx.value);
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  }

  async function submit() {
    const ui = useUiStore();
    const platform = usePlatformStore();
    const posts = usePostsStore();
    const stories = useStoriesStore();

    hideSuggest();
    const cfg = platform.config(platform.current);
    let handle = query.value.trim();
    if (cfg.kind === 'profile' || !cfg.kind) handle = handle.replace(/^@/, '');
    if (!handle) return;

    clearResults();
    posts.reset();
    stories.reset();
    ui.clearError();
    ui.hideAuthWarn();
    ui.loading = true;

    try {
      const res = await fetch(cfg.endpoint + encodeURIComponent(handle));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');

      if (cfg.kind === 'video') {
        const fileName = `tiktok_${data.author || 'video'}_${data.id}`;
        const badges = [];
        badges.push({ text: data.watermark ? 'watermarked' : 'no watermark', clean: !data.watermark });
        if (data.quality) badges.push({ text: data.quality });
        else if (data.height) badges.push({ text: `${data.height}p` });
        if (data.codec) badges.push({ text: data.codec.replace(/^h/, 'H.') });
        const size = formatBytes(data.sizeBytes);
        if (size) badges.push({ text: size });
        if (data.duration) badges.push({ text: `${Math.round(data.duration)}s` });

        video.value = {
          kind: 'video',
          cover: '/api/image-proxy?url=' + encodeURIComponent(data.cover),
          referrerPolicy: null,
          nickname: data.nickname || data.author || '',
          author: data.author ? '@' + data.author : '',
          description: data.description || '',
          badges,
          downloadHref: '/api/tt-video-proxy?url=' + encodeURIComponent(data.downloadUrl) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + '.mp4',
          downloadLabel: 'Download HD Video',
        };
      } else if (cfg.kind === 'image') {
        const fileName = `vsco_${data.author || 'post'}_${data.id || Date.now()}`;
        video.value = {
          kind: 'image',
          cover: data.imageUrl,
          referrerPolicy: 'no-referrer',
          nickname: data.title || data.author || '',
          author: data.author ? '@' + data.author : '',
          description: data.description || '',
          badges: [{ text: 'HD image', clean: true }],
          downloadHref: '/api/image-proxy?url=' + encodeURIComponent(data.imageUrl) + '&name=' + encodeURIComponent(fileName),
          downloadName: fileName + '.jpg',
          downloadLabel: 'Download HD Image',
        };
      } else {
        const today = new Date();
        const dateStr = today.getFullYear() + '-'
          + String(today.getMonth() + 1).padStart(2, '0') + '-'
          + String(today.getDate()).padStart(2, '0');
        const fileName = `${platform.current}_${handle}_${dateStr}`;
        const proxied = '/api/image-proxy?url=' + encodeURIComponent(data.profile_pic_url) + '&name=' + encodeURIComponent(fileName);
        const labels = cfg.statLabels;
        const meta = [];
        if (data.followers && labels.followers) meta.push({ value: data.followers, label: labels.followers });
        if (data.following && labels.following) meta.push({ value: data.following, label: labels.following });
        if (data.posts && labels.posts) meta.push({ value: data.posts, label: labels.posts });

        profile.value = {
          avatar: proxied,
          fullName: data.full_name || 'No name',
          username: '@' + (data.username || handle),
          meta,
          handle,
        };

        if (platform.current === 'instagram') {
          posts.fetchPosts(handle);
          stories.fetchStories(handle);
          stories.fetchHighlights(handle);
        }
      }
    } catch (err) {
      ui.showError(err.message === 'User not found' ? 'User not found.' : (err.message || 'Failed to fetch.'));
    } finally {
      ui.loading = false;
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      query.value = text;
    } catch (_) { /* ignore */ }
  }

  return {
    query, profile, video,
    suggestUsers, suggestActiveIdx, suggestVisible, suggestSearched,
    onInput, hideSuggest, suggestKeyDown, pickSuggest,
    submit, paste, clearResults,
  };
});
