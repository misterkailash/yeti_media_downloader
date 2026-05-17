<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const visible = ref(false);

function onScroll() {
  visible.value = window.scrollY > 300;
}
function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <button
    class="back-to-top"
    :class="{ visible }"
    aria-label="Back to top"
    @click="scrollTop"
  >
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 15l-6-6-6 6"/>
    </svg>
  </button>
</template>
