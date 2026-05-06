<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';

const search = useSearchStore();
const { profile } = storeToRefs(search);

const qualityLabel = computed(() => {
  const w = profile.value?.picWidth;
  if (!w) return '';
  if (w >= 1080) return `HD · ${w}×${w}`;
  return `${w}×${w}`;
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
  <div class="result" :class="{ visible: !!profile }" v-if="profile">
    <a class="avatar-wrap" :href="profile.avatar" target="_blank" rel="noopener">
      <img :src="profile.avatar" alt="Profile picture">
      <span class="open-hint">click to open full size</span>
    </a>
    <div class="user-info">
      <div class="fullname">{{ profile.fullName }}</div>
      <div class="username">{{ profile.username }}</div>
      <div class="meta">
        <span v-for="(m, i) in profile.meta" :key="i">{{ m.value }} {{ m.label }}</span>
      </div>
      <div class="profile-actions">
        <a class="btn-save-hd" :href="profile.avatar" :download="profile.downloadName" @click="saveAvatar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Save profile picture</span>
        </a>
        <span v-if="qualityLabel" class="quality-badge">{{ qualityLabel }}</span>
      </div>
    </div>
  </div>
</template>
