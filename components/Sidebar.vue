<script setup>
import { storeToRefs } from 'pinia';
import logo from '~/assets/logo.png';

const ui = useUiStore();
const route = useRoute();
const { sidebarOpen } = storeToRefs(ui);

// "Save via Link" is active for the landing and every per-platform route —
// basically everything that isn't a dedicated static page.
const onMainView = computed(() => {
  const p = route.path;
  return p === '/' || !(p.startsWith('/sessions') || p.startsWith('/faq') || p.startsWith('/feedback') || p.startsWith('/privacy'));
});

// Auto-close the drawer when the route changes (mobile UX — sidebar opens
// over content; tapping a link should both navigate and close it).
watch(() => route.fullPath, () => ui.closeSidebar());
</script>

<template>
  <button class="menu-toggle" :class="{ open: sidebarOpen }" type="button" :aria-label="sidebarOpen ? 'Close menu' : 'Open menu'" @click="ui.toggleSidebar()">
    <svg v-if="!sidebarOpen" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/></svg>
    <svg v-else viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>
  </button>
  <div class="sidebar-overlay" :class="{ open: sidebarOpen }" @click="ui.closeSidebar()"></div>

  <aside class="sidebar" :class="{ open: sidebarOpen }">
    <NuxtLink to="/" class="sidebar-logo">
      <img :src="logo" alt="Yeti" class="logo-icon">
      <div class="logo-text">
        Yeti Media<br>Downloader
        <span>by KAI</span>
      </div>
    </NuxtLink>

    <nav class="sidebar-nav">
      <NuxtLink to="/" :class="{ active: onMainView }">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
        Save via Link
      </NuxtLink>
      <NuxtLink to="/sessions" active-class="active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 11h-6M19 8v6"/>
        </svg>
        Logged-in Sessions
      </NuxtLink>
    </nav>

    <a class="bmc-link" href="https://www.buymeacoffee.com/misterkai" target="_blank" rel="noopener">
      <img src="https://codehim.com/wp-content/uploads/2022/09/bmc-button-640x180.png" alt="Buy Me a Coffee">
    </a>

    <div class="sidebar-bottom">
      <NuxtLink to="/faq" active-class="active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        FAQ
      </NuxtLink>
      <NuxtLink to="/feedback" active-class="active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        Feedback
      </NuxtLink>
      <NuxtLink to="/privacy" active-class="active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Privacy Policy
      </NuxtLink>
    </div>
  </aside>
</template>
