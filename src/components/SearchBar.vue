<script setup>
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSearchStore } from '../stores/search';
import { usePlatformStore } from '../stores/platform';

const search = useSearchStore();
const platform = usePlatformStore();
const { query, suggestUsers, suggestActiveIdx, suggestVisible, suggestSearched } = storeToRefs(search);
const { current } = storeToRefs(platform);

const inputRef = ref(null);

const placeholder = computed(() => platform.config(current.value).placeholder);
const hint = computed(() => platform.config(current.value).hint);

watch(query, (v) => search.onInput(v));

function onSubmit() {
  search.submit();
}
function onPaste() {
  search.paste();
  inputRef.value?.focus();
}
function onBlur() {
  setTimeout(() => search.hideSuggest(), 120);
}
function onFocus() {
  if (current.value === 'instagram' && (suggestUsers.value.length || suggestSearched.value)) {
    suggestVisible.value = true;
  }
}
</script>

<template>
  <div class="search-section">
    <form class="search-bar" autocomplete="off" @submit.prevent="onSubmit">
      <div class="icon">
        <svg viewBox="0 0 24 24">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <input
        ref="inputRef"
        type="text"
        v-model="query"
        @keydown="search.suggestKeyDown($event)"
        @blur="onBlur"
        @focus="onFocus"
        :placeholder="placeholder"
        required
      >
      <button type="button" class="paste-btn" @click="onPaste">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
        Paste
      </button>
      <button type="submit" class="fetch-btn">Fetch</button>
    </form>

    <div class="suggest-box" :class="{ visible: suggestVisible }">
      <div v-if="suggestSearched && !suggestUsers.length" class="suggest-item" style="cursor:default">
        <div class="s-meta">
          <span class="s-name" style="font-size:.82rem">No matches on Instagram</span>
        </div>
      </div>
      <div
        v-for="(u, i) in suggestUsers"
        :key="u.username"
        class="suggest-item"
        :class="{ active: i === suggestActiveIdx }"
        @mousedown.prevent="search.pickSuggest(i)"
      >
        <img
          :src="`/api/image-proxy?url=${encodeURIComponent(u.profile_pic_url)}`"
          alt=""
          loading="lazy"
          @error="$event.target.style.visibility = 'hidden'"
        >
        <div class="s-meta">
          <span class="s-user">
            {{ u.username }}
            <svg v-if="u.is_verified" class="s-verified" viewBox="0 0 24 24">
              <path d="M12 2l2.4 2.1 3.1-.5.6 3.1L21 9l-1.4 2.8L21 15l-3 1.3-.6 3.1-3.1-.5L12 22l-2.4-2.1-3.1.5-.6-3.1L3 15l1.4-2.8L3 9l3-1.3.6-3.1 3.1.5L12 2zm-1 13.4l5.3-5.3-1.4-1.4L11 12.6 8.1 9.7 6.7 11.1l4.3 4.3z"/>
            </svg>
          </span>
          <span class="s-name">{{ u.full_name || '' }}{{ u.is_private ? ' · Private' : '' }}</span>
        </div>
      </div>
    </div>

    <p class="hint">{{ hint }}</p>
  </div>
</template>
