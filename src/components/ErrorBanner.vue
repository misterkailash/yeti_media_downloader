<script setup>
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
const { errorMessage } = storeToRefs(ui);
</script>

<template>
  <div class="error" :class="{ visible: !!errorMessage }">
    <p>{{ errorMessage || 'Something went wrong.' }}</p>
    <p class="sub">Make sure the username is valid and try again.</p>
  </div>
</template>
