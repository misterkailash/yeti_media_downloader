<script setup>
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';
import logo from '../assets/logo.png';

const ui = useUiStore();
const { sidebarOpen, view } = storeToRefs(ui);
</script>

<template>
  <button class="menu-toggle" type="button" @click="ui.toggleSidebar()">
    <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/></svg>
  </button>
  <div class="sidebar-overlay" :class="{ open: sidebarOpen }" @click="ui.closeSidebar()"></div>

  <aside class="sidebar" :class="{ open: sidebarOpen }">
    <div class="sidebar-logo">
      <img :src="logo" alt="Yeti" class="logo-icon">
      <div class="logo-text">
        Yeti Media<br>Downloader
        <span>by Kailash</span>
      </div>
    </div>

    <nav class="sidebar-nav">
      <a style="cursor:pointer" :class="{ active: view === 'main' }" @click="ui.setView('main')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
        Save via Link
      </a>
      <a style="cursor:pointer" :class="{ active: view === 'sessions' }" @click="ui.setView('sessions')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 11h-6M19 8v6"/>
        </svg>
        Logged-in Sessions
      </a>
    </nav>

    <div class="sidebar-bottom">
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        Rate Us
      </a>
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Support
      </a>
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Privacy Policy
      </a>
    </div>
  </aside>
</template>
