<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
const { errorMessage } = storeToRefs(ui);

const isNotFound = computed(() => /not\s*found/i.test(errorMessage.value));
</script>

<template>
  <div class="error" :class="{ visible: !!errorMessage, 'not-found': isNotFound }">
    <svg v-if="isNotFound" class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="8.5" y1="8.5" x2="13.5" y2="13.5"/>
      <line x1="13.5" y1="8.5" x2="8.5" y2="13.5"/>
    </svg>
    <p>{{ errorMessage || 'Something went wrong.' }}</p>
    <p class="sub">
      {{ isNotFound
        ? 'Double-check the username — it may be misspelled, deactivated, or unavailable in your region.'
        : 'Make sure the username is valid and try again.' }}
    </p>
  </div>
</template>
