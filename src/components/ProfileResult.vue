<script setup>
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';

const search = useSearchStore();
const { profile } = storeToRefs(search);
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
    </div>
  </div>
</template>
