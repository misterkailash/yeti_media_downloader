<script setup>
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
const { loading } = storeToRefs(ui);
</script>

<template>
  <div class="loader" :class="{ visible: loading }">
    <div class="spinner"></div>
    <p>fetching profile…</p>
  </div>
</template>
